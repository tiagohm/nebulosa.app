import { equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { timeNow } from 'nebulosa/src/astronomy/time/time'
import type { ManualMoveHandle } from 'nebulosa/src/devices/commanders/mount'
import type { Mount } from 'nebulosa/src/devices/indi/device'
import type { OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { ProtocolClient } from 'nebulosa/src/devices/protocols/client'
import { type MoveDirection, Lx200ProtocolServer } from 'nebulosa/src/devices/protocols/lx200'
import { StellariumProtocolServer } from 'nebulosa/src/devices/protocols/stellarium'
import { type Angle, normalizeAngle, toDeg } from 'nebulosa/src/math/units/angle'
import { type ClientResolver, connectedDevice, notFound } from './commands'
import type { ConnectionRegistryEvent } from './connection'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { MountAdmission, MountCommands } from './mounts'
import type { OperationRegistry } from './operations'

// Mount Remote Control: TCP listeners speaking the LX200 and Stellarium telescope protocols that expose one mount of
// one open connection to planetarium programs. A listener exists per (connection, mount, protocol), so a mount may
// have one of each protocol at once and several mounts may be exposed together; it is started and stopped only
// explicitly, never by a tab, a profile, or a route, and ends with its mount or connection. Every listener accepts
// several clients, listed by address and port and closed one at a time. Nothing here authenticates a client.
//
// Clients command the mount through the shared MountCommands and its commander, so a remote goto, sync, or manual
// motion is refused as busy whenever another operation holds the mount, and runs as an ordinary operation published
// as operation:updated. Positions are read from the mount (equinox of date) and converted to J2000 at the server's
// current time, the frame both protocols exchange. A goto is admitted or refused at once: LX200 answers it, while
// Stellarium has no reply and a refusal is only logged; once admitted it no longer depends on its client. The manual
// motion of an LX200 client belongs to it alone: its commands run in order, another client's motion is refused, and
// it stops when the client releases every axis, disconnects, the listener stops, or REMOTE_MOTION_WATCHDOG elapses.
// :Q# is the emergency stop of the mount. An LX200 client may set the site of the mount (latitude and longitude, such
// as the GPS position Stellarium Mobile sends), written at once through the commander and refused while the mount is
// busy; clock and slew-rate commands never change the mount.

// Protocol of a remote control listener.
export type MountRemoteProtocol = 'lx200' | 'stellarium'

// Every protocol a listener can speak.
export const MOUNT_REMOTE_PROTOCOLS: readonly MountRemoteProtocol[] = ['lx200', 'stellarium']

// Connected TCP client of a listener.
export interface MountRemoteClient {
	// Opaque id of the connection.
	readonly id: string
	// Remote IP address, without brackets for IPv6.
	readonly ip: string
	// Remote TCP port.
	readonly port: number
}

// Identity of a listener: the exact mount of an open connection and the protocol.
export interface MountRemoteKey {
	// Id of the open connection that provides the mount.
	readonly connectionId: string
	// Exact id of the mount.
	readonly deviceId: string
	// Protocol spoken.
	readonly protocol: MountRemoteProtocol
}

// Running listener as published to clients.
export interface MountRemoteServer extends MountRemoteKey {
	// Host the listener is bound to, as requested, such as 0.0.0.0 or 127.0.0.1.
	readonly host: string
	// TCP port the listener is bound to.
	readonly port: number
	// Connected clients, in connection order.
	readonly clients: readonly MountRemoteClient[]
	// Revision of the service at the last change of this listener.
	readonly revision: number
}

// Every running listener.
export interface MountRemoteSnapshot {
	// Id of this server process; revisions only compare within one epoch.
	readonly epoch: string
	// Revision of the service when the snapshot was taken; grows with every change.
	readonly revision: number
	// Running listeners, in start order.
	readonly servers: readonly MountRemoteServer[]
}

// Body of POST /api/connections/:id/mounts/:deviceId/remote-control/:protocol/start.
export interface MountRemoteStartRequest {
	// Interface to bind, such as 0.0.0.0 for every interface or 127.0.0.1 for this machine only.
	readonly host: string
	// TCP port to bind, 1..65535.
	readonly port: number
}

// Notification published when a listener starts, stops, or its clients change; server is absent once it stopped.
export type MountRemoteControlEvent = { readonly type: 'mountRemoteControl:updated'; readonly epoch: string; readonly revision: number; readonly key: MountRemoteKey; readonly server?: MountRemoteServer }

// Receiver of remote control events.
export type MountRemoteControlListener = (event: MountRemoteControlEvent) => void

// Stable code of a refused remote control request, besides notFound and disconnected:
// - conflict: the listener already runs with another binding.
// - addressInUse: the host and port are already bound by another listener or program.
// - bindFailed: the host and port cannot be bound for another reason, such as an unknown interface.
export type MountRemoteErrorCode = 'notFound' | 'disconnected' | 'conflict' | 'addressInUse' | 'bindFailed'

// Timing of the service, in milliseconds.
export interface MountRemoteControlOptions {
	// Longest a manual motion may run without being released.
	readonly motionWatchdog: number
	// Interval between the positions sent to Stellarium clients.
	readonly positionInterval: number
}

// Milliseconds a remote manual motion may run before it is stopped anyway: a client that started an axis and lost the
// release (a crash, a dropped packet the TCP stack has not reported yet) must not leave the mount moving. Thirty
// seconds is longer than any centering press and shorter than a slew into a hard limit.
export const REMOTE_MOTION_WATCHDOG = 30000

// Milliseconds between the positions sent to Stellarium clients; Stellarium redraws its reticle about once a second.
export const STELLARIUM_POSITION_INTERVAL = 1000

// Default timing of the service.
export const DEFAULT_MOUNT_REMOTE_CONTROL_OPTIONS: MountRemoteControlOptions = { motionWatchdog: REMOTE_MOTION_WATCHDOG, positionInterval: STELLARIUM_POSITION_INTERVAL }

// Milliseconds a site change waits for the other coordinate before it is written: LX200 sets the latitude and the
// longitude with two commands, sent together, and writing each alone would send the mount a site that mixes the new
// value with the old other one.
const SITE_WRITE_DELAY = 250

// Product name reported to LX200 clients.
const LX200_PRODUCT_NAME = 'Nebulosa'

// Manual motion of one client: the operation holding the mount and the handle commanding its axes.
interface RemoteMotion {
	// Commands the axes; absent until the motion started.
	handle?: ManualMoveHandle
	// Ends the motion: the axes are released and the operation waits for the mount to stop.
	readonly end: PromiseWithResolvers<void>
	// Result of the operation, settled once the mount stopped and was released.
	readonly result: Promise<OperationResult<void>>
}

// Connected client of a listener and what it commands.
interface RemoteClient {
	// Identity of the client.
	readonly client: ProtocolClient
	// Tail of its manual motion commands, which run one after the other.
	queue: Promise<void>
	// Its manual motion while the mount moves for it.
	motion?: RemoteMotion
	// Whether it disconnected; its queued commands are dropped.
	closed: boolean
}

// Running listener.
interface RemoteEntry extends MountRemoteKey {
	// Mount it exposes.
	readonly mount: Mount
	// Toolkit server speaking the protocol.
	readonly server: Lx200ProtocolServer | StellariumProtocolServer
	// Bound host and port.
	readonly host: string
	readonly port: number
	// Connected clients by id.
	readonly clients: Map<string, RemoteClient>
	// Revision of its last change.
	revision: number
	// Position sender of a Stellarium listener.
	timer?: ReturnType<typeof setInterval>
	// Site set by LX200 clients and not written to the mount yet, radians and meters.
	site?: GeographicCoordinate
	// Writes the pending site once both coordinates had time to arrive.
	siteTimer?: ReturnType<typeof setTimeout>
	// Last finite J2000 position read from the mount, radians; protocols need a value even while the mount reports none.
	position: [Angle, Angle]
	// Whether it was stopped; callbacks of its sockets arriving later are ignored.
	stopped: boolean
}

// Encodes a listener identity as a map key without collisions between ids containing separators.
function entryKey(connectionId: string, deviceId: string, protocol: MountRemoteProtocol) {
	return JSON.stringify([connectionId, deviceId, protocol])
}

// Returns whether a route segment names a protocol.
function isProtocol(value: string): value is MountRemoteProtocol {
	return (MOUNT_REMOTE_PROTOCOLS as readonly string[]).includes(value)
}

// Responds with a refused remote control request.
function remoteError(message: string, status: number, code: MountRemoteErrorCode): Response {
	return errorResponse(message, status, code)
}

// Logs a remote command the mount refused.
function logRefusal(protocol: MountRemoteProtocol, command: string, admission: MountAdmission) {
	if (!admission.ok) console.warn(`mount remote control: ${protocol} ${command} refused: ${admission.error}`)
}

// LX200 and Stellarium listeners of the mounts of the open connections.
export class MountRemoteControlService implements Disposable {
	// Running listeners by entryKey.
	readonly #entries = new Map<string, RemoteEntry>()
	// Id of this process run.
	readonly #epoch = crypto.randomUUID()
	// Revision of the last change.
	#revision = 0

	// Creates the service over the devices of every open connection; mounts runs the commands of the clients through
	// its shared commander, operations arbitrates the mounts, listener receives every event synchronously, and options
	// sets the motion watchdog and the Stellarium position interval.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly mounts: MountCommands,
		readonly operations: OperationRegistry,
		readonly listener: MountRemoteControlListener,
		readonly options: MountRemoteControlOptions = DEFAULT_MOUNT_REMOTE_CONTROL_OPTIONS,
	) {}

	// Returns every running listener.
	snapshot(): MountRemoteSnapshot {
		return { epoch: this.#epoch, revision: this.#revision, servers: Array.from(this.#entries.values(), (entry) => this.#server(entry)) }
	}

	// Starts the listener of a protocol for a connected mount and responds 200 with MountRemoteServer. A listener
	// already running with the same host and port answers itself; with another binding, 409 conflict. Responds 404 for
	// an unknown mount or protocol, 409 disconnected, 409 addressInUse when the port is taken, and 500 bindFailed when
	// the address cannot be bound; a failed start leaves every other listener running.
	start(connectionId: string, deviceId: string, protocol: string, { host, port }: MountRemoteStartRequest): Response {
		if (!isProtocol(protocol)) return notFound('Protocol')
		const mount = connectedDevice(this, connectionId, 'mount', deviceId, 'Mount')
		if (mount instanceof Response) return mount

		const key = entryKey(connectionId, deviceId, protocol)
		const running = this.#entries.get(key)

		if (running) {
			if (running.host === host && running.port === port) return Response.json(this.#server(running))
			return remoteError(`The ${protocol === 'lx200' ? 'LX200' : 'Stellarium'} server of this mount already runs on ${running.host}:${running.port}`, 409, 'conflict')
		}

		// The handlers of the server reach the entry once it exists; none runs before the server starts.
		const self = () => entry
		const entry: RemoteEntry = { connectionId, deviceId, protocol, mount, host, port, clients: new Map(), revision: 0, position: [0, 0], stopped: false, server: protocol === 'lx200' ? this.#lx200(mount, self) : this.#stellarium(self) }

		try {
			entry.server.start(host, port)
		} catch (error) {
			entry.stopped = true
			if (Error.isError(error) && 'code' in error && error.code === 'EADDRINUSE') return remoteError(`${host}:${port} is already in use`, 409, 'addressInUse')
			return remoteError(`${host}:${port} cannot be bound${Error.isError(error) ? `: ${error.message}` : ''}`, 500, 'bindFailed')
		}

		if (entry.server instanceof StellariumProtocolServer) {
			const server = entry.server
			entry.timer = setInterval(() => {
				if (server.clients().length > 0 && mount.connected) server.send(...this.#position(entry))
			}, this.options.positionInterval)
		}

		this.#entries.set(key, entry)
		this.#publish(entry)
		return Response.json(this.#server(entry))
	}

	// Stops a listener: closes its clients, stops their manual motions, and resolves once the mount stopped for them.
	// Gotos they started go on. Responds 204, also when it was not running, and 404 for an unknown protocol.
	async stop(connectionId: string, deviceId: string, protocol: string): Promise<Response> {
		if (!isProtocol(protocol)) return notFound('Protocol')
		const entry = this.#entries.get(entryKey(connectionId, deviceId, protocol))
		if (entry) await this.#stop(entry)
		return new Response(null, { status: 204 })
	}

	// Closes one client of a listener and stops its manual motion; the listener and its other clients go on. Responds
	// 204, also for a client that already left, and 404 when the listener is not running.
	disconnectClient(connectionId: string, deviceId: string, protocol: string, clientId: string): Response {
		const entry = isProtocol(protocol) ? this.#entries.get(entryKey(connectionId, deviceId, protocol)) : undefined
		if (!entry) return remoteError('The remote control server is not running', 404, 'notFound')
		entry.server.disconnectClient(clientId)
		return new Response(null, { status: 204 })
	}

	// Stops the listeners of a mount that disconnected or disappeared, or of every mount of a closed connection. A
	// listener is never started again by itself.
	deviceChanged(event: ConnectionRegistryEvent) {
		if (event.type === 'connection:close') {
			for (const entry of this.#entries.values()) if (entry.connectionId === event.id) void this.#stop(entry)
		} else if (event.type === 'device:removed' || (event.type === 'device:updated' && !event.connected)) {
			for (const entry of this.#entries.values()) if (entry.connectionId === event.connectionId && entry.deviceId === event.id) void this.#stop(entry)
		}
	}

	// Stops every listener and the manual motions of their clients.
	[Symbol.dispose]() {
		for (const entry of Array.from(this.#entries.values())) void this.#stop(entry)
	}

	// Removes a listener, closes its sockets, and waits for the manual motions of its clients to stop.
	async #stop(entry: RemoteEntry) {
		if (entry.stopped) return
		entry.stopped = true
		this.#entries.delete(entryKey(entry.connectionId, entry.deviceId, entry.protocol))
		clearInterval(entry.timer)
		// A site already answered as accepted is still written.
		if (entry.site) void this.#writeSite(entry)

		const motions: Promise<unknown>[] = []

		for (const remote of entry.clients.values()) {
			remote.closed = true
			const motion = remote.motion
			if (motion) {
				motion.end.resolve()
				motions.push(motion.result)
			}
		}

		entry.clients.clear()
		entry.server.stop()
		this.#publish(entry, true)
		await Promise.all(motions)
	}

	// Creates the LX200 server of a listener: positions and site from the mount, site setters admitted or refused at
	// once and written to the mount, clock setters refused, gotos and syncs admitted or refused at once, slew rates
	// ignored, and :Q# as the emergency stop.
	#lx200(mount: Mount, entry: () => RemoteEntry) {
		return new Lx200ProtocolServer({
			name: LX200_PRODUCT_NAME,
			readOnlyTime: true,
			handler: {
				clientOpen: (_, client) => this.#clientOpened(entry(), client),
				clientClose: (_, client) => this.#clientClosed(entry(), client),
				rightAscension: () => this.#position(entry())[0],
				declination: () => this.#position(entry())[1],
				longitude: () => mount.geographicCoordinate.longitude,
				latitude: () => mount.geographicCoordinate.latitude,
				setLatitude: (_, latitude) => this.#setSite(entry(), { latitude }),
				setLongitude: (_, longitude) => this.#setSite(entry(), { longitude }),
				dateTime: () => [mount.time.utc, mount.time.offset] as const,
				tracking: () => mount.tracking,
				parked: () => mount.parked,
				slewing: () => mount.slewing,
				// The presets of LX200 have no defined mapping to the presets a driver announces, and choosing one by its
				// name could select an unexpected speed, so the rate is left as the mount has it.
				slewRate: () => {},
				goto: (_, rightAscension, declination) => this.#goTo(entry(), rightAscension, declination),
				sync: (_, rightAscension, declination) => {
					if (entry().stopped) return false
					const admission = this.mounts.syncNow(mount, { type: 'J2000', J2000: { x: rightAscension, y: declination } })
					logRefusal('lx200', 'sync', admission)
					return admission.ok
				},
				move: (_, direction, enabled, client) => this.#move(entry(), client, direction, enabled),
				abort: () => {
					if (!entry().stopped) void this.#abort(mount)
				},
			},
		})
	}

	// Creates the Stellarium server of a listener; its gotos are admitted or refused at once, a refusal only logged.
	#stellarium(entry: () => RemoteEntry) {
		return new StellariumProtocolServer({
			handler: {
				clientOpen: (_, client) => this.#clientOpened(entry(), client),
				clientClose: (_, client) => this.#clientClosed(entry(), client),
				goto: (_, rightAscension, declination) => void this.#goTo(entry(), rightAscension, declination),
			},
		})
	}

	// Admits a change of the site of the mount sent by a client, latitude and longitude in radians (east positive), and
	// writes it after SITE_WRITE_DELAY merged with the other coordinate when that one arrives meanwhile. Refused while
	// the mount is disconnected or held by an operation, unless a change admitted before is still waiting. The elevation
	// is kept, since LX200 has none. Returns whether it was admitted.
	#setSite(entry: RemoteEntry, change: Partial<Pick<GeographicCoordinate, 'latitude' | 'longitude'>>) {
		const { mount } = entry

		if (entry.stopped || !mount.connected || (!entry.site && !this.operations.available(mount))) {
			console.warn('mount remote control: lx200 site refused: the mount is disconnected or busy')
			return false
		}

		const { latitude, longitude, elevation } = entry.site ?? mount.geographicCoordinate
		entry.site = { latitude, longitude, elevation, ...change }
		clearTimeout(entry.siteTimer)
		entry.siteTimer = setTimeout(() => void this.#writeSite(entry), SITE_WRITE_DELAY)
		return true
	}

	// Writes the pending site of a listener to its mount, logging a failure.
	async #writeSite(entry: RemoteEntry) {
		const site = entry.site
		clearTimeout(entry.siteTimer)
		entry.site = undefined
		entry.siteTimer = undefined
		if (!site) return

		const result = await this.mounts.commander.setGeographicCoordinate(this.operations.coordinator, entry.mount, site)
		if (!result.ok) console.warn('mount remote control: the site was not written', result.reason, result.error)
	}

	// Starts a goto to a J2000 target above the horizon of the site the mount reports. Returns whether it started.
	#goTo(entry: RemoteEntry, rightAscension: Angle, declination: Angle) {
		if (entry.stopped) return false
		const { mount } = entry

		if (!mount.hasGeographicCoordinate) {
			console.warn(`mount remote control: ${entry.protocol} goto refused: the mount has not reported its site`)
			return false
		}

		const { latitude, longitude, elevation } = mount.geographicCoordinate
		const observer = { latitude: toDeg(latitude), longitude: toDeg(longitude), elevation }
		const admission = this.mounts.goToNow(entry.connectionId, mount, { type: 'J2000', J2000: { x: rightAscension, y: declination } }, observer)
		logRefusal(entry.protocol, 'goto', admission)
		return admission.ok
	}

	// Returns the J2000 position of the mount now, in radians, right ascension normalized to [0, 2π), keeping the last
	// finite one while the mount reports none.
	#position(entry: RemoteEntry): [Angle, Angle] {
		const { rightAscension, declination } = entry.mount.equatorialCoordinate
		const [ra, dec] = equatorialToJ2000(rightAscension, declination, timeNow(true))
		if (Number.isFinite(ra) && Number.isFinite(dec)) entry.position = [normalizeAngle(ra), dec]
		return entry.position
	}

	// Cancels the operation holding a mount and stops its motion, as the stop endpoint does.
	async #abort(mount: Mount) {
		await this.operations.coordinator.cancelByDevice(resourceKey(mount))
		const result = await this.mounts.commander.stopMotion(mount)
		if (!result.ok) console.warn('mount remote control: the mount did not stop', result.reason, result.error)
	}

	// Records a connected client.
	#clientOpened(entry: RemoteEntry, client: ProtocolClient) {
		if (entry.stopped) return
		entry.clients.set(client.id, { client, queue: Promise.resolve(), closed: false })
		this.#publish(entry)
	}

	// Forgets a client that left and stops its manual motion.
	#clientClosed(entry: RemoteEntry, client: ProtocolClient) {
		const remote = entry.clients.get(client.id)
		if (entry.stopped || !remote) return
		entry.clients.delete(client.id)
		remote.closed = true
		remote.motion?.end.resolve()
		this.#publish(entry)
	}

	// Queues a manual motion command of a client, so a start and a stop sent together run in order.
	#move(entry: RemoteEntry, client: ProtocolClient, direction: MoveDirection, enabled: boolean) {
		const remote = entry.clients.get(client.id)
		if (entry.stopped || !remote) return
		remote.queue = remote.queue.then(() => this.#applyMove(entry, remote, direction, enabled)).catch((error: unknown) => console.error('mount remote control: manual motion failed', error))
	}

	// Starts or stops one axis of the manual motion of a client. A start is refused when the mount is held by anyone
	// else, its own motion included when it belongs to another client; a stop of an axis the client does not move does
	// nothing. Releasing the last axis ends the motion and resolves once the mount stopped.
	async #applyMove(entry: RemoteEntry, remote: RemoteClient, direction: MoveDirection, enabled: boolean) {
		if (remote.closed) return

		const motion = remote.motion

		if (!enabled) {
			if (!motion?.handle) return
			await motion.handle.move(direction, false)
			if (motion.handle.directions().length === 0) {
				motion.end.resolve()
				await motion.result
			}
			return
		}

		if (motion?.handle) {
			const moved = await motion.handle.move(direction, true)
			if (!moved.ok) console.warn(`mount remote control: ${direction.toLowerCase()} refused: ${moved.error ?? moved.reason}`)
			return
		}

		const { mount } = entry

		// An open motion of the mount belongs to someone else (a nudge, TPPA, DARV, or another client), and joining it
		// would let this client move or stop axes it does not own.
		if (this.mounts.commander.manualMoveOf(mount) || !this.operations.available(mount)) {
			console.warn(`mount remote control: ${direction.toLowerCase()} refused: the mount is busy`)
			return
		}

		await this.#startMotion(entry, remote, direction)
	}

	// Opens the manual motion of a client in a direction, under an operation of its own holding the mount until the
	// motion ends; the watchdog ends it if the client never releases it.
	async #startMotion(entry: RemoteEntry, remote: RemoteClient, direction: MoveDirection) {
		const { mount } = entry
		const key = resourceKey(mount)
		const end = Promise.withResolvers<void>()
		const ready = Promise.withResolvers<boolean>()
		const { commander } = this.mounts

		const operation = this.operations.coordinator.start<void>('mountRemoteMove', [{ key, device: mount }], async (context) => {
			context.signal.addEventListener('abort', () => end.resolve(), { once: true })
			const started = await commander.startManualMove(context, mount, direction)

			if (!started.ok) {
				ready.resolve(false)
				return started
			}

			motion.handle = started.value
			ready.resolve(true)
			await end.promise
			return await started.value.stop()
		})

		const motion: RemoteMotion = { end, result: operation.result }
		remote.motion = motion
		this.operations.track('mount.remoteMove', [{ connectionId: entry.connectionId, deviceId: entry.deviceId }], operation.result)

		const watchdog = setTimeout(() => {
			console.warn(`mount remote control: manual motion stopped after ${this.options.motionWatchdog} ms`)
			end.resolve()
		}, this.options.motionWatchdog)

		void operation.result.then((result) => {
			clearTimeout(watchdog)
			ready.resolve(false)
			if (remote.motion === motion) remote.motion = undefined
			if (!result.ok) console.warn('mount remote control: manual motion ended', result.reason, result.error)
		})

		// A client that left while the motion was starting ends it as soon as it has an axis to stop.
		if (remote.closed) end.resolve()
		if (!(await ready.promise)) await operation.result
	}

	// Publishes a change of a listener, or its removal.
	#publish(entry: RemoteEntry, removed = false) {
		entry.revision = ++this.#revision
		const { connectionId, deviceId, protocol } = entry
		this.listener({ type: 'mountRemoteControl:updated', epoch: this.#epoch, revision: entry.revision, key: { connectionId, deviceId, protocol }, server: removed ? undefined : this.#server(entry) })
	}

	// Returns a listener as published.
	#server(entry: RemoteEntry): MountRemoteServer {
		const { connectionId, deviceId, protocol, host, port, revision } = entry
		return { connectionId, deviceId, protocol, host, port, clients: Array.from(entry.clients.values(), ({ client }) => ({ id: client.id, ip: client.ip, port: client.port })), revision }
	}
}

// Routes of Mount Remote Control.
export function createMountRemoteControlRoutes(service: MountRemoteControlService) {
	return {
		'/api/mount-remote-control': {
			// Every running listener, of every mount.
			GET: () => Response.json(service.snapshot()),
		},
		'/api/connections/:id/mounts/:deviceId/remote-control/:protocol/start': {
			// Starts a listener of a protocol for a mount; its changes arrive as mountRemoteControl:updated events.
			POST: async (req) => service.start(req.params.id, req.params.deviceId, req.params.protocol, (await req.json()) as MountRemoteStartRequest),
		},
		'/api/connections/:id/mounts/:deviceId/remote-control/:protocol/stop': {
			// Stops a listener and closes its clients; idempotent.
			POST: (req) => service.stop(req.params.id, req.params.deviceId, req.params.protocol),
		},
		'/api/connections/:id/mounts/:deviceId/remote-control/:protocol/clients/:clientId': {
			// Closes one client of a listener.
			DELETE: (req) => service.disconnectClient(req.params.id, req.params.deviceId, req.params.protocol, req.params.clientId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
