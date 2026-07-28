import { equatorialFromJ2000, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import { TIMEZONE, temporalAdd } from 'nebulosa/src/astronomy/time/temporal'
import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { GPS, Mount, MountTargetCoordinate, NameAndLabel, TrackMode } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, MountManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { Lx200ProtocolServer } from 'nebulosa/src/devices/protocols/lx200'
import type { Lx200ProtocolHandler, MoveDirection } from 'nebulosa/src/devices/protocols/lx200'
import { StellariumProtocolServer } from 'nebulosa/src/devices/protocols/stellarium'
import type { StellariumProtocolHandler } from 'nebulosa/src/devices/protocols/stellarium'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { OperationCoordinator } from 'src/api/operation'
import { makeTime } from 'src/api/util'
import { EventBus } from 'src/shared/bus'
import { coordinateInfo, DEFAULT_COORDINATE_INFO } from '#/mount'
import type { MountAdded, MountRemoteControlProtocol, MountRemoteControlStart, MountRemoteControlStatus, MountRemoved, MountUpdated } from '#/mount'
import type { OperationResult } from '#/orchestration'
import type { ConfirmationHandler } from './confirmation'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { MountCommander, MountMoveDirection } from './mount.commander'
import type { NotificationHandler } from './notification'
import { resourceKey } from './resource'

// Presentation events fanned out to WebSocket subscribers. They publish state and never take part in the
// correctness of a command: dropping one loses a UI update, not a movement.
export interface MountBusEvents {
	// A mount became known to its manager.
	readonly add: MountAdded
	// One mount property changed, carrying only the changed field and its INDI state.
	readonly update: MountUpdated
	// A mount disappeared from its manager.
	readonly remove: MountRemoved
}

// Process-wide fanout of mount presentation events.
export const mountBus = new EventBus<MountBusEvents>()

// Wraps an equinox-of-date coordinate in radians as the target shape every mount command takes.
function jnow(rightAscension: Angle, declination: Angle): MountTargetCoordinate<Angle> {
	return { type: 'JNOW', JNOW: { x: rightAscension, y: declination } }
}

// Publishes mount transport events and delegates every mutation to MountCommander.
export class MountHandler implements DeviceHandler<Mount> {
	// Registers the mount transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly mountManager: MountManager,
		readonly confirmation: ConfirmationHandler,
		readonly notification: NotificationHandler,
		readonly commander: MountCommander,
		readonly coordinator: OperationCoordinator,
	) {
		mountManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of mountManager.list()) {
				wsm.send<MountAdded>('mount:add', { device }, socket)
			}
		})

		mountBus.subscribe('add', (event) => wsm.send('mount:add', event))
		mountBus.subscribe('update', (event) => wsm.send('mount:update', event))
		mountBus.subscribe('remove', (event) => wsm.send('mount:remove', event))
	}

	// Publishes a newly discovered mount.
	added(device: Mount) {
		mountBus.emit('add', { device })
		console.info('mount added:', device.name, device.id)
	}

	// Publishes property changes; the commander observes the manager directly for command completion.
	updated(device: Mount, property: keyof Mount & string, state?: PropertyState) {
		mountBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	// Publishes removal.
	removed(device: Mount) {
		mountBus.emit('remove', { device })
		console.info('mount removed:', device.name, device.id)
	}

	// Lists mounts, optionally scoped to one INDI client.
	list(client?: string | IndiClient) {
		return Array.from(this.mountManager.list(client))
	}

	// Projects where the mount currently points into every supported frame.
	currentPosition(mount: Mount) {
		if (!mount) return DEFAULT_COORDINATE_INFO
		return coordinateInfo(makeTime('now', mount.geographicCoordinate), mount.geographicCoordinate.longitude, mount.equatorialCoordinate)
	}

	// Projects a requested target into every supported frame without commanding anything.
	targetPosition(mount: Mount, coordinate: MountTargetCoordinate<string | Angle>) {
		if (!mount) return DEFAULT_COORDINATE_INFO
		return coordinateInfo(makeTime('now', mount.geographicCoordinate), mount.geographicCoordinate.longitude, coordinate)
	}

	// Asks the user and then slews as a whole operation tree owning the mount.
	goTo(mount: Mount, req: MountTargetCoordinate) {
		this.#confirm(mount, `Are you sure you want to slew the mount '${mount.name}'?`, 'go to a target', () => this.commander.goTo(this.coordinator, mount, req))
	}

	// Asks the user and then flips as a whole operation tree owning the mount.
	flip(mount: Mount, req: MountTargetCoordinate) {
		this.#confirm(mount, `Are you sure you want to flip the mount '${mount.name}'?`, 'flip', () => this.commander.flip(this.coordinator, mount, req))
	}

	// Asks the user and then redefines the mount's pointing.
	sync(mount: Mount, req: MountTargetCoordinate) {
		this.#confirm(mount, `Are you sure you want to sync the mount '${mount.name}'?`, 'sync', () => this.commander.sync(this.coordinator, mount, req))
	}

	// Parks the mount; parking can take minutes, so it reports through mount events rather than the response.
	park(mount: Mount) {
		this.#detach(mount, 'park', () => this.commander.park(this.coordinator, mount))
	}

	// Unparks the mount.
	unpark(mount: Mount) {
		this.#detach(mount, 'unpark', () => this.commander.unpark(this.coordinator, mount))
	}

	// Moves the mount to its configured home position.
	home(mount: Mount) {
		this.#detach(mount, 'home', () => this.commander.home(this.coordinator, mount))
	}

	// Searches for the mechanical home position.
	findHome(mount: Mount) {
		this.#detach(mount, 'find home', () => this.commander.findHome(this.coordinator, mount))
	}

	// Enables or disables tracking, resolving only after the mount confirms the new state.
	tracking(mount: Mount, enabled: boolean) {
		return this.commander.setTracking(this.coordinator, mount, enabled)
	}

	// Selects the tracking rate.
	trackMode(mount: Mount, mode: TrackMode) {
		return this.commander.setTrackMode(this.coordinator, mount, mode)
	}

	// Selects the manual motion speed preset.
	slewRate(mount: Mount, rate: NameAndLabel | string) {
		return this.commander.setSlewRate(this.coordinator, mount, rate)
	}

	// Writes the observing site.
	location(mount: Mount, coordinate: GeographicCoordinate) {
		return this.commander.setGeographicCoordinate(this.coordinator, mount, coordinate)
	}

	// Writes the mount clock.
	time(mount: Mount, time: GPS['time']) {
		return this.commander.setTime(this.coordinator, mount, time)
	}

	// Starts or stops one axis of manual motion. The motion keeps owning the mount until it is stopped.
	move(mount: Mount, direction: MountMoveDirection, enabled: boolean) {
		return this.commander.manualMove(this.coordinator, mount, direction, enabled)
	}

	// Stops the mount: first by cancelling whatever operation owns it, so its own cleanup runs, and then
	// by the physical abort, which also covers motion nobody here started.
	//
	// No local index of operations is kept: the arbiter already knows the owner, and stopping by device
	// means stopping the whole tree, because a caller holding only a device id cannot name a scope and
	// stopping the mount of a TPPA run means stopping the TPPA run.
	async stop(mount: Mount) {
		await this.coordinator.cancelByResource(resourceKey(mount))
		return await this.commander.stopMotion(mount)
	}

	// Asks for confirmation before a movement and detaches the command that follows it.
	#confirm(mount: Mount, message: string, action: string, command: () => Promise<OperationResult<unknown>>) {
		void this.confirmation.ask({ key: `mount.${mount.id}.move`, message }).then((confirmed) => {
			if (confirmed) this.#detach(mount, action, command)
		})
	}

	// Runs a command whose physical completion outlasts the request that asked for it.
	//
	// The HTTP response is gone by the time the command settles, and a rejected command moves nothing, so
	// it emits no device update either: without a notification the user would see the action silently
	// discarded. Failures are therefore pushed over the WebSocket, which is the same path every other
	// asynchronous failure in the API already uses.
	#detach(mount: Mount, action: string, command: () => Promise<OperationResult<unknown>>) {
		void command().then((result) => {
			if (result.ok) return

			console.error('mount failed to %s:', action, mount.name, result.reason, result.error ?? '')
			this.notification.send({ title: 'MOUNT', description: `${mount.name} failed to ${action}: ${result.error ?? result.reason}`, color: 'danger' })
		})
	}
}

// Exposes mounts to external planetarium software over the Stellarium and LX200 protocols.
//
// Every mutation goes through MountCommander, so a remote client competes for the mount under the same
// ownership rules as the UI: it cannot slew a mount an operation is already using.
export class MountRemoteControlHandler {
	private readonly stellarium = new Map<Mount, StellariumProtocolServer>()
	private readonly lx200 = new Map<Mount, Lx200ProtocolServer>()

	// Creates the protocol adapter over coordinated mount commands.
	constructor(
		readonly mountManager: MountManager,
		readonly commander: MountCommander,
		readonly coordinator: OperationCoordinator,
	) {}

	// Stellarium remote control handler. Stellarium must be configured to send JNOW because its wire
	// protocol carries no coordinate epoch, so converting an unlabelled target here would be ambiguous.
	private readonly stellariumHandler: StellariumProtocolHandler = {
		goto: (server, rightAscension, declination) => {
			this.#detach('go to a target', this.get(server), (mount) => this.commander.goTo(this.coordinator, mount, jnow(rightAscension, declination)))
		},
	}

	private readonly lx200Handler: Lx200ProtocolHandler = {
		goto: (server, rightAscension, declination) => {
			;[rightAscension, declination] = equatorialFromJ2000(rightAscension, declination)
			this.#detach('go to a target', this.get(server), (mount) => this.commander.goTo(this.coordinator, mount, jnow(rightAscension, declination)))
		},
		sync: (server: Lx200ProtocolServer, rightAscension: Angle, declination: Angle) => {
			;[rightAscension, declination] = equatorialFromJ2000(rightAscension, declination)
			this.#detach('sync', this.get(server), (mount) => this.commander.sync(this.coordinator, mount, jnow(rightAscension, declination)))
		},
		rightAscension: (server: Lx200ProtocolServer) => {
			const mount = this.get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return equatorialToJ2000(rightAscension, declination)[0]
		},
		declination: (server: Lx200ProtocolServer) => {
			const mount = this.get(server)
			const { rightAscension, declination } = mount.equatorialCoordinate
			return equatorialToJ2000(rightAscension, declination)[1]
		},
		longitude: (server: Lx200ProtocolServer, longitude?: Angle) => {
			const device = this.get(server)
			if (longitude !== undefined) this.#detach('change the location', device, (mount) => this.commander.setGeographicCoordinate(this.coordinator, mount, { ...mount.geographicCoordinate, longitude }))
			return normalizePI(device.geographicCoordinate.longitude)
		},
		latitude: (server: Lx200ProtocolServer, latitude?: Angle) => {
			const device = this.get(server)
			if (latitude !== undefined) this.#detach('change the location', device, (mount) => this.commander.setGeographicCoordinate(this.coordinator, mount, { ...mount.geographicCoordinate, latitude }))
			return normalizePI(device.geographicCoordinate.latitude)
		},
		dateTime: (server: Lx200ProtocolServer) => [temporalAdd(Date.now(), TIMEZONE, 'm'), TIMEZONE] as const,
		tracking: (server: Lx200ProtocolServer) => this.get(server).tracking,
		parked: (server: Lx200ProtocolServer) => this.get(server).parked,
		slewing: (server: Lx200ProtocolServer) => this.get(server).slewing,
		slewRate: (server: Lx200ProtocolServer, rate: 'CENTER' | 'GUIDE' | 'FIND' | 'MAX') => {
			const device = this.get(server)
			const rates = device.slewRates

			if (rates.length > 0) {
				const index = rates.length === 1 ? 0 : rate === 'GUIDE' ? 0 : rate === 'MAX' ? rates.length - 1 : rate === 'CENTER' ? 1 : Math.max(1, rates.length - 2)
				this.#detach('change the slew rate', device, (mount) => this.commander.setSlewRate(this.coordinator, mount, rates[Math.max(index, 0)]))
			}
		},
		move: (server: Lx200ProtocolServer, direction: MoveDirection, enabled: boolean) => {
			this.#detach('move manually', this.get(server), (mount) => this.commander.manualMove(this.coordinator, mount, direction, enabled))
		},
		// A jog lives between the press and the release of a key, so a connection that drops in between
		// leaves an axis moving and its operation holding the mount for a halt that will never arrive.
		// Whatever motion is open is stopped: only one exists per mount, the client that started it is
		// gone, and stopping a mount is never the dangerous direction to be wrong in.
		disconnect: (server: Lx200ProtocolServer) => {
			const device = this.find(server)
			if (device === undefined) return
			const active = this.commander.manualMoveOf(device)
			if (active !== undefined) this.#detach('stop the manual move', device, () => active.stop())
		},
		// Abort is the protocol's safety command, so it stops whatever owns the mount instead of competing
		// with it for ownership.
		abort: (server: Lx200ProtocolServer) => {
			const device = this.get(server)
			this.#detach('stop', device, async (mount) => {
				await this.coordinator.cancelByResource(resourceKey(mount))
				return await this.commander.stopMotion(mount)
			})
		},
	}

	// Runs a coordinated command for a protocol callback, which is synchronous and has no way to report a
	// failure back to the remote client.
	#detach(action: string, mount: Mount, command: (mount: Mount) => Promise<OperationResult<unknown>>) {
		void command(mount).then((result) => {
			if (!result.ok) console.error('mount failed to %s:', action, mount.name, result.reason, result.error ?? '')
		})
	}

	start(mount: Mount, req: MountRemoteControlStart) {
		if (req.protocol === 'stellarium') {
			if (!this.stellarium.has(mount)) {
				const server = new StellariumProtocolServer({ handler: this.stellariumHandler })

				if (server.start(req.host, req.port)) {
					this.stellarium.set(mount, server)
				}
			}
		} else if (req.protocol === 'lx200') {
			if (!this.lx200.has(mount)) {
				const server = new Lx200ProtocolServer({ handler: this.lx200Handler, name: 'Nebulosa', version: '0.2.0' })

				if (server.start(req.host, req.port)) {
					this.lx200.set(mount, server)
				}
			}
		}
	}

	stop(mount: Mount, protocol: MountRemoteControlProtocol) {
		if (protocol === 'stellarium') {
			const server = this.stellarium.get(mount)

			if (server) {
				server.stop()
				this.stellarium.delete(mount)
			}
		} else if (protocol === 'lx200') {
			const server = this.lx200.get(mount)

			if (server) {
				server.stop()
				this.lx200.delete(mount)
			}
		}
	}

	status(mount: Mount): MountRemoteControlStatus {
		const a = this.lx200.get(mount)
		const b = this.stellarium.get(mount)
		return { lx200: !!a && { host: a.hostname!, port: a.port }, stellarium: !!b && { host: b.hostname!, port: b.port } }
	}

	private get(server: Lx200ProtocolServer | StellariumProtocolServer) {
		const mount = this.find(server)
		if (mount === undefined) throw new Error('mount not found!')
		return mount
	}

	// Resolves the mount a protocol server was started for, or nothing when the server is already gone.
	// Lifecycle callbacks such as disconnect can run while the server is being torn down, and they have no
	// caller left to receive an exception.
	private find(server: Lx200ProtocolServer | StellariumProtocolServer) {
		if (server instanceof Lx200ProtocolServer) {
			for (const [m, s] of this.lx200) if (s === server) return m
		} else {
			for (const [m, s] of this.stellarium) if (s === server) return m
		}

		return undefined
	}
}

// Builds mount HTTP routes over coordinated mount commands.
export function mount(mountHandler: MountHandler, mountRemoteControlHandler: MountRemoteControlHandler) {
	const { mountManager } = mountHandler

	// Resolves the mount named by route params and optional client query.
	function mountFromParams(req: Bun.BunRequest) {
		return mountManager.get(query(req).client, req.params.id)!
	}

	return {
		'/mounts': { GET: (req) => response(mountHandler.list(query(req).client)) },
		'/mounts/:id': { GET: (req) => response(mountFromParams(req)) },
		'/mounts/:id/goto': { POST: async (req) => response(mountHandler.goTo(mountFromParams(req), await req.json())) },
		'/mounts/:id/flip': { POST: async (req) => response(mountHandler.flip(mountFromParams(req), await req.json())) },
		'/mounts/:id/sync': { POST: async (req) => response(mountHandler.sync(mountFromParams(req), await req.json())) },
		'/mounts/:id/park': { POST: (req) => response(mountHandler.park(mountFromParams(req))) },
		'/mounts/:id/unpark': { POST: (req) => response(mountHandler.unpark(mountFromParams(req))) },
		'/mounts/:id/home': { POST: (req) => response(mountHandler.home(mountFromParams(req))) },
		'/mounts/:id/findhome': { POST: (req) => response(mountHandler.findHome(mountFromParams(req))) },
		'/mounts/:id/tracking': { POST: async (req) => response<OperationResult<void>>(await mountHandler.tracking(mountFromParams(req), await req.json())) },
		'/mounts/:id/trackmode': { POST: async (req) => response<OperationResult<void>>(await mountHandler.trackMode(mountFromParams(req), await req.json())) },
		'/mounts/:id/slewrate': { POST: async (req) => response<OperationResult<void>>(await mountHandler.slewRate(mountFromParams(req), await req.json())) },
		'/mounts/:id/position/current': { POST: (req) => response(mountHandler.currentPosition(mountFromParams(req))) },
		'/mounts/:id/position/target': { POST: async (req) => response(mountHandler.targetPosition(mountFromParams(req), await req.json())) },
		'/mounts/:id/movenorth': { POST: async (req) => response<OperationResult<void>>(await mountHandler.move(mountFromParams(req), 'NORTH', await req.json())) },
		'/mounts/:id/movesouth': { POST: async (req) => response<OperationResult<void>>(await mountHandler.move(mountFromParams(req), 'SOUTH', await req.json())) },
		'/mounts/:id/moveeast': { POST: async (req) => response<OperationResult<void>>(await mountHandler.move(mountFromParams(req), 'EAST', await req.json())) },
		'/mounts/:id/movewest': { POST: async (req) => response<OperationResult<void>>(await mountHandler.move(mountFromParams(req), 'WEST', await req.json())) },
		'/mounts/:id/location': { POST: async (req) => response<OperationResult<void>>(await mountHandler.location(mountFromParams(req), await req.json())) },
		'/mounts/:id/time': { POST: async (req) => response<OperationResult<void>>(await mountHandler.time(mountFromParams(req), await req.json())) },
		'/mounts/:id/stop': { POST: async (req) => response<OperationResult<void>>(await mountHandler.stop(mountFromParams(req))) },
		'/mounts/:id/remotecontrol/start': { POST: async (req) => response(mountRemoteControlHandler.start(mountFromParams(req), await req.json())) },
		'/mounts/:id/remotecontrol/stop': { POST: async (req) => response(mountRemoteControlHandler.stop(mountFromParams(req), await req.json())) },
		'/mounts/:id/remotecontrol': { GET: (req) => response(mountRemoteControlHandler.status(mountFromParams(req))) },
	} as const satisfies Endpoints
}
