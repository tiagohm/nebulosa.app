import { equatorialToHorizontal } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeNow } from 'nebulosa/src/astronomy/time/time'
import { MountCommander, type MountMoveDirection } from 'nebulosa/src/devices/commanders/mount'
import type { Client, Mount, MountTargetCoordinate, MountTargetCoordinateType, TrackMode } from 'nebulosa/src/devices/indi/device'
import { mountTargetEquatorial } from 'nebulosa/src/devices/indi/manager/mount'
import type { OperationContext, OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { deg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { type CommandErrorCode, type CommandRequest, disconnected, failureCode, findDevice, notFound, settle, startCommand, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import { DEFAULT_LEASE_OPTIONS, type LeasedMotion, LeasedMotions, type LeasedPhase, type LeasedSession, type LeasedStartResponse, type LeaseOptions, leasedFailureStatus } from './leases'
import type { OperationRegistry } from './operations'
import { EphemerisUnavailableError, HorizonsEphemerisError, type SkyObserver, type SkyPosition } from './sky/ephemeris'
import type { SkyLocator } from './sky/routes'
import type { SkyObjectRef } from './sky/types'

// Physical mount commands of the Sky workspace, the Capture nudge, and the Equipment Control page. Besides
// the slew to an object described below, a mount can be sent to, flipped to, or synced on a coordinate
// in any frame the toolkit resolves (a goto or flip is refused below the observer's horizon, like a slew),
// parked, unparked, sent home or made to search for it, have its tracking, tracking rate, home and park
// positions, site, and clock set. Motions run as operations through the shared command contract of
// commands.ts and are answered 202 with their operation id; settings are answered once applied.
//
// A slew to an object resolves the object at the server's real current time, never at a simulated
// instant, refuses targets below the observer's horizon, and runs
// through the toolkit's MountCommander, whose operation checks connection, capability, lease, driver
// alerts, timeout, and arrival, under the process-wide operation registry, so no other operation can
// hold the mount meanwhile. The HTTP response only says the command was accepted; the outcome is
// published later as an operation:updated event (kind mount.slew) from the real operation result. Every
// command addresses one device of one connection by its exact id.
//
// A nudge is manual motion authorized only while a tab keeps renewing it, run by the leased sessions of
// leases.ts as a mount.nudge operation that holds the mount from the start request until both axes were
// released and the mount was observed to stop; an expired lease stops the axes exactly as a release does,
// and a stop delivered before its start keeps the press from ever moving the mount. A diagonal starts one
// direction of each axis inside the same session and is rolled back as a whole when the second axis
// cannot start. The STOP of a nudge only ends its own session; it never cancels a slew or any other
// operation of the mount, which is what the emergency stop endpoint is for.

// Body of POST /api/connections/:id/mounts/:deviceId/slew.
export interface MountSlewRequest {
	// Object to point at.
	readonly target: SkyObjectRef
	// Observer whose horizon the target must be above; the mount points from the same site.
	readonly observer: SkyObserver
}

// Response of an accepted slew: the coordinate commanded and where it was for the observer.
export interface MountSlewResponse {
	// Id of the slew operation, repeated by its operation:updated events.
	readonly operationId: string
	// Instant the target was resolved at, Unix milliseconds (UTC); the server's current time.
	readonly time: number
	// Commanded right ascension in radians, true equator and equinox of date (JNOW).
	readonly rightAscension: number
	// Commanded declination in radians, equinox of date.
	readonly declination: number
	// Azimuth of the target from north through east in radians, at time.
	readonly azimuth: number
	// Refracted altitude of the target in radians at time; never negative.
	readonly altitude: number
}

// Logical direction of a nudge: a cardinal moves one axis, a diagonal one direction of each axis. Names
// follow the driver's motion vectors (north/south and west/east), not the orientation of any image.
export type MountNudgeDirection = 'N' | 'S' | 'E' | 'W' | 'NE' | 'NW' | 'SE' | 'SW'

// Life stage of a nudge session (see LeasedPhase); every axis of the direction is commanded before it moves.
export type MountNudgePhase = LeasedPhase

// Body of POST /api/connections/:id/mounts/:deviceId/nudge.
export interface MountNudgeRequest {
	// Identity of this press, generated by the tab and unique per press.
	readonly token: string
	// Direction to move in.
	readonly direction: MountNudgeDirection
}

// Body of POST /api/connections/:id/mounts/:deviceId/slew-rate.
export interface MountSlewRateRequest {
	// Name of one of the speed presets the mount reports (MountState slewRates).
	readonly name: string
}

// Coordinate of a mount target: a frame and its two components as text, sexagesimal or decimal, in
// degrees, except the right ascension of the JNOW and J2000 frames, read in hours. x is the longitude-like
// component (right ascension, azimuth, ecliptic or galactic longitude) and y the latitude-like one.
export interface MountCoordinate {
	// Frame the components are given in.
	readonly frame: MountTargetCoordinateType
	// Longitude-like component.
	readonly x: string
	// Latitude-like component.
	readonly y: string
}

// Body of POST /api/connections/:id/mounts/:deviceId/goto and .../flip.
export interface MountGoToRequest extends CommandRequest {
	// Coordinate to point at.
	readonly target: MountCoordinate
	// Observer whose horizon the target must be above; the mount points from the same site.
	readonly observer: SkyObserver
}

// Body of POST /api/connections/:id/mounts/:deviceId/sync.
export interface MountSyncRequest {
	// Coordinate the mount is pointing at, by the user's account.
	readonly target: MountCoordinate
}

// Body of POST /api/connections/:id/mounts/:deviceId/tracking.
export interface MountTrackingRequest {
	// Whether tracking is to be on.
	readonly enabled: boolean
}

// Body of POST /api/connections/:id/mounts/:deviceId/track-mode.
export interface MountTrackModeRequest {
	// One of the tracking rates the mount reports (MountState trackModes).
	readonly mode: TrackMode
}

// Body of POST /api/connections/:id/mounts/:deviceId/site.
export interface MountSiteRequest {
	// Site to send: latitude and longitude in degrees, elevation in meters.
	readonly site: SkyObserver
}

// Body of POST /api/connections/:id/mounts/:deviceId/time.
export interface MountTimeRequest {
	// UTC instant, Unix milliseconds.
	readonly utc: number
	// Offset of local time from UTC, in minutes.
	readonly offset: number
}

// Nudge session as published to clients.
export interface MountNudgeSession extends LeasedSession {
	// Direction moved in.
	readonly direction: MountNudgeDirection
	// Name of the speed preset selected when the session started; absent when the driver reports none.
	readonly slewRate?: string
}

// Response of an accepted nudge: the session as it stands after the start, and the lease timing the tab
// has to keep, in milliseconds.
export type MountNudgeStartResponse = LeasedStartResponse<MountNudgeSession>

// Notification published on every change of a nudge session, its end included.
export type MountNudgeEvent = { readonly type: 'mount:nudge'; readonly session: MountNudgeSession }

// Receiver of nudge events.
export type MountNudgeListener = (event: MountNudgeEvent) => void

// Lease timing of the nudge sessions, in milliseconds.
export type MountNudgeOptions = LeaseOptions

// Default lease timing of the nudge sessions (see DEFAULT_LEASE_OPTIONS).
export const DEFAULT_MOUNT_NUDGE_OPTIONS: MountNudgeOptions = DEFAULT_LEASE_OPTIONS

// Axis directions each logical direction commands, north/south first.
const NUDGE_AXES: Readonly<Record<MountNudgeDirection, readonly MountMoveDirection[]>> = {
	N: ['NORTH'],
	S: ['SOUTH'],
	E: ['EAST'],
	W: ['WEST'],
	NE: ['NORTH', 'EAST'],
	NW: ['NORTH', 'WEST'],
	SE: ['SOUTH', 'EAST'],
	SW: ['SOUTH', 'WEST'],
}

// Returns the toolkit form of a coordinate target.
function targetCoordinate({ frame, x, y }: MountCoordinate): MountTargetCoordinate {
	return { type: frame, [frame]: { x, y } }
}

// Geometric altitude, in radians, of a coordinate target for an observer now. The target is resolved to
// the equinox of date as the mount itself resolves it; NaN when a component cannot be parsed.
function targetAltitude(mount: Mount, target: MountTargetCoordinate, observer: SkyObserver) {
	const time = timeNow(true)
	const [rightAscension, declination] = mountTargetEquatorial(mount, target, time)
	return equatorialToHorizontal(rightAscension, declination, deg(observer.latitude), localSiderealTime(time, deg(observer.longitude)))[1]
}

// Returns why a mount cannot move in a direction, with the status to respond with, or undefined when it can.
function nudgeRefusal(mount: Mount, direction: MountNudgeDirection): readonly [string, number, CommandErrorCode] | undefined {
	if (!mount.connected) return ['The mount is disconnected', 409, 'disconnected']
	if (!mount.canMove) return ['The mount cannot move manually', 422, 'unsupported']
	for (const axis of NUDGE_AXES[direction]) if (!(axis === 'NORTH' || axis === 'SOUTH' ? mount.canMoveNS : mount.canMoveWE)) return [`The mount cannot move ${axis.toLowerCase()}`, 422, 'unsupported']
	if (mount.parked || mount.parking) return ['The mount is parked', 409, 'unsupported']
	return undefined
}

// Mount commands over the devices of every open connection.
export class MountCommands implements Disposable {
	// Commander driving the mounts and observing their state.
	readonly #commander: MountCommander
	// Nudge sessions of every mount.
	readonly #nudges: LeasedMotions<MountNudgeSession>

	// Creates the commands over the device registry. client resolves an open connection id to its client,
	// locate resolves sky objects, operations runs and publishes every mount operation, listener receives
	// every nudge event synchronously, and nudge sets the lease timing of the nudge sessions.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly locate: SkyLocator,
		readonly operations: OperationRegistry,
		readonly listener: MountNudgeListener,
		readonly nudge: MountNudgeOptions = DEFAULT_MOUNT_NUDGE_OPTIONS,
	) {
		this.#commander = new MountCommander(devices.mounts)
		this.#nudges = new LeasedMotions<MountNudgeSession>(operations, 'mount.nudge', 'mountNudge', { motion: 'nudge', device: 'mount' }, (session) => listener({ type: 'mount:nudge', session }), nudge)
	}

	// Returns the nudge sessions still running, in start order.
	nudges(): MountNudgeSession[] {
		return this.#nudges.sessions()
	}

	// Starts a nudge of a mount in a direction and resolves once every axis was commanded. Responds 202
	// with MountNudgeStartResponse, whose session is moving, or already ended when it was stopped while
	// starting; a repeated start of a running press answers the same session. Responds 404 for an unknown
	// mount; 409 when it is disconnected, parked, or busy, or when the press was already stopped; 422 when
	// it cannot move along an axis of the direction; and 502 when a motion command could not be sent.
	async startNudge(connectionId: string, deviceId: string, { token, direction }: MountNudgeRequest): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return notFound('Mount')

		const refuse = () => {
			const refusal = nudgeRefusal(mount, direction)
			return refusal && errorResponse(...refusal)
		}

		return await this.#nudges.start(mount, { token, connectionId, deviceId, direction, slewRate: mount.slewRate }, refuse, (context, motion) => this.#nudge(context, mount, direction, motion))
	}

	// Renews the lease of a running press. Responds 204, and 404 when the press is no longer running, so
	// the tab ends it.
	heartbeatNudge(token: string): Response {
		return this.#nudges.heartbeat(token)
	}

	// Ends a press and resolves once its mount stopped. Never refused: a press that already ended, or was
	// not started yet, is recorded as ended so it can no longer start. Responds 204, and 409 when the
	// mount could not be observed to stop.
	async stopNudge(token: string): Promise<Response> {
		return await this.#nudges.stop(token)
	}

	// Selects the speed preset of manual motion. Responds 204 once sent (the new preset arrives as a
	// mount:updated event), 404 for an unknown mount, 409 when it is disconnected or busy, such as during
	// a nudge, and 422 for a preset the mount does not report.
	async setSlewRate(connectionId: string, deviceId: string, { name }: MountSlewRateRequest): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return notFound('Mount')
		if (!mount.connected) return errorResponse('The mount is disconnected', 409, 'disconnected')
		if (!mount.slewRates.some((rate) => rate.name === name)) return errorResponse('Unknown slew rate', 422, 'invalidParameter')

		const result = await this.#commander.setSlewRate(this.operations.coordinator, mount, name)
		if (result.ok) return new Response(null, { status: 204 })
		return errorResponse(result.reason === 'busy' ? 'The mount is busy' : (result.error ?? `The slew rate was not changed (${result.reason})`), leasedFailureStatus(result.reason), failureCode(result.reason))
	}

	// Responds with the state of a mount, or 404 when the connection is not open or has no such mount.
	state(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const state = client && this.devices.mountState(client, deviceId)
		return state ? Response.json(state) : notFound('Mount')
	}

	// Slews a mount to an object resolved now. Responds 202 with MountSlewResponse once the command
	// started; 404 for an unknown mount or object, 409 when the mount is disconnected, parked, or busy,
	// 422 when it cannot go to a target or the target is below the horizon, 502 when Horizons rejects the
	// target, and 503 when no provider can compute it.
	async slew(connectionId: string, deviceId: string, { target, observer }: MountSlewRequest, signal?: AbortSignal): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return notFound('Mount')
		if (!mount.connected) return errorResponse('The mount is disconnected', 409, 'disconnected')
		if (!mount.canGoTo) return errorResponse('The mount cannot go to a target', 422, 'unsupported')
		if (mount.parked || mount.parking) return errorResponse('The mount is parked', 409, 'unsupported')
		if (this.operations.arbiter.availability(resourceKey(mount)) !== 'available') return errorResponse('The mount is busy', 409, 'busy')

		const time = Date.now()
		let position: SkyPosition | undefined

		try {
			position = await this.locate(target, { time, observer, mode: 'accurate', signal })
		} catch (error) {
			if (error instanceof EphemerisUnavailableError) return errorResponse(error.message, 503, 'serviceUnavailable')
			if (error instanceof HorizonsEphemerisError) return errorResponse(error.message, 502, 'serviceUnavailable')
			throw error
		}

		if (!position) return errorResponse('Object not found', 404, 'notFound')

		const { rightAscension, declination, azimuth, altitude } = position
		if (azimuth === undefined || altitude === undefined) return errorResponse('An observer is required', 422, 'invalidParameter')
		if (altitude < 0) return errorResponse('The target is below the horizon', 422, 'invalidParameter')

		const result = this.#commander.goTo(this.operations.coordinator, mount, { type: 'JNOW', JNOW: { x: rightAscension, y: declination } })
		const { operationId } = this.operations.track('mount.slew', [{ connectionId, deviceId: mount.id }], result)

		return Response.json({ operationId, time, rightAscension, declination, azimuth, altitude } satisfies MountSlewResponse, { status: 202 })
	}

	// Cancels the operation holding a mount and stops its motion, resolving once it has stopped. Responds
	// 204 when stopped, 404 for an unknown mount, and 409 when it could not be stopped.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const client = this.client(connectionId)
		const mount = client && this.devices.mount(client, deviceId)
		if (!mount) return notFound('Mount')

		await this.operations.coordinator.cancelByDevice(resourceKey(mount))
		const result = await this.#commander.stopMotion(mount)
		return result.ok ? new Response(null, { status: 204 }) : errorResponse(result.error ?? `The mount did not stop (${result.reason})`, 409, failureCode(result.reason))
	}

	// Starts a goto to a coordinate. Responds 202 with the operation id, or with why the mount cannot go
	// there: 404 unknown mount; 409 disconnected, parked, or busy; 422 when it cannot go to a target or the
	// target is below the observer's horizon or not a valid coordinate.
	goTo(connectionId: string, deviceId: string, request: MountGoToRequest): Response {
		return this.#slewTo('mount.goto', connectionId, deviceId, request)
	}

	// Starts a meridian flip to a coordinate; answered like goTo, with 422 when the mount cannot flip.
	flip(connectionId: string, deviceId: string, request: MountGoToRequest): Response {
		return this.#slewTo('mount.flip', connectionId, deviceId, request)
	}

	// Redefines where the mount points. Responds 204 once applied, 404 unknown mount, 409 disconnected or
	// busy, and 422 when the mount cannot sync or the target is not a valid coordinate.
	async sync(connectionId: string, deviceId: string, { target }: MountSyncRequest): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canSync) return unsupported('The mount cannot sync')

		const coordinate = targetCoordinate(target)
		if (!mountTargetEquatorial(mount, coordinate).every(Number.isFinite)) return errorResponse('The target is not a valid coordinate', 422, 'invalidParameter')

		return await settle(this.#commander.sync(this.operations.coordinator, mount, coordinate), 'The sync')
	}

	// Starts parking the mount. Responds 202 with the operation id; 404, 409 disconnected or busy, 422 when
	// the mount cannot park.
	park(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canPark) return unsupported('The mount cannot park')
		return startCommand(this.operations, 'mount.park', connectionId, mount, request, () => this.#commander.park(this.operations.coordinator, mount))
	}

	// Starts unparking the mount; answered like park.
	unpark(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canPark) return unsupported('The mount cannot unpark')
		return startCommand(this.operations, 'mount.unpark', connectionId, mount, request, () => this.#commander.unpark(this.operations.coordinator, mount))
	}

	// Starts a slew to the home position the mount knows. Responds 202 with the operation id; 404, 409
	// disconnected, parked, or busy, 422 when the mount has no home command.
	home(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canHome) return unsupported('The mount cannot go home')
		if (mount.parked || mount.parking) return errorResponse('The mount is parked', 409, 'unsupported')
		return startCommand(this.operations, 'mount.home', connectionId, mount, request, () => this.#commander.home(this.operations.coordinator, mount))
	}

	// Starts the search for the home position by the mount's sensors; answered like home.
	findHome(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canFindHome) return unsupported('The mount cannot search its home position')
		if (mount.parked || mount.parking) return errorResponse('The mount is parked', 409, 'unsupported')
		return startCommand(this.operations, 'mount.findHome', connectionId, mount, request, () => this.#commander.findHome(this.operations.coordinator, mount))
	}

	// Stores the current position as the home position. Responds 204 once applied; 404, 409 disconnected or
	// busy, 422 when the mount cannot.
	async setHome(connectionId: string, deviceId: string): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canSetHome) return unsupported('The mount cannot store its home position')
		return await settle(this.#commander.setHome(this.operations.coordinator, mount), 'Setting the home position')
	}

	// Stores the current position as the park position; answered like setHome.
	async setPark(connectionId: string, deviceId: string): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canSetPark) return unsupported('The mount cannot store its park position')
		return await settle(this.#commander.setPark(this.operations.coordinator, mount), 'Setting the park position')
	}

	// Switches tracking and responds 204 once the mount reports the requested state; 404, 409 disconnected,
	// parked, or busy, 422 when tracking cannot be switched, 504 when the mount did not report it in time.
	async setTracking(connectionId: string, deviceId: string, { enabled }: MountTrackingRequest): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.canTracking) return unsupported('The mount cannot switch tracking')
		if (enabled && (mount.parked || mount.parking)) return errorResponse('The mount is parked', 409, 'unsupported')
		return await settle(this.#commander.setTracking(this.operations.coordinator, mount, enabled), 'Switching tracking')
	}

	// Selects the tracking rate. Responds 204 once sent (the new rate arrives as a mount:updated event); 404,
	// 409 disconnected or busy, 422 for a rate the mount does not offer.
	async setTrackMode(connectionId: string, deviceId: string, { mode }: MountTrackModeRequest): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (!mount.trackModes.includes(mode)) return errorResponse('Unknown tracking rate', 422, 'invalidParameter')
		return await settle(this.#commander.setTrackMode(this.operations.coordinator, mount, mode), 'Selecting the tracking rate')
	}

	// Sends a site to the mount, which uses it for its own coordinate conversions. Responds 204 once sent;
	// 404, 409 disconnected or busy.
	async setSite(connectionId: string, deviceId: string, { site }: MountSiteRequest): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		const coordinate = { latitude: deg(site.latitude), longitude: deg(site.longitude), elevation: meter(site.elevation) }
		return await settle(this.#commander.setGeographicCoordinate(this.operations.coordinator, mount, coordinate), 'Sending the site')
	}

	// Sends a clock to the mount. Responds 204 once sent; 404, 409 disconnected or busy.
	async setTime(connectionId: string, deviceId: string, { utc, offset }: MountTimeRequest): Promise<Response> {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		return await settle(this.#commander.setTime(this.operations.coordinator, mount, { utc, offset }), 'Sending the time')
	}

	// Returns the connected mount with this id on an open connection, or the response refusing it.
	#connected(connectionId: string, deviceId: string): Mount | Response {
		const mount = findDevice(this.devices, this.client, connectionId, 'mount', deviceId)
		if (!mount) return notFound('Mount')
		if (!mount.connected) return disconnected('Mount')
		return mount
	}

	// Starts a goto or a flip to a coordinate, refusing a target below the observer's horizon.
	#slewTo(kind: 'mount.goto' | 'mount.flip', connectionId: string, deviceId: string, request: MountGoToRequest): Response {
		const mount = this.#connected(connectionId, deviceId)
		if (mount instanceof Response) return mount
		if (kind === 'mount.goto' ? !mount.canGoTo : !mount.canFlip) return unsupported(kind === 'mount.goto' ? 'The mount cannot go to a target' : 'The mount cannot flip')
		if (mount.parked || mount.parking) return errorResponse('The mount is parked', 409, 'unsupported')

		const coordinate = targetCoordinate(request.target)
		// Inverted so that an unparsable coordinate, whose altitude is NaN, is refused as well.
		if (!(targetAltitude(mount, coordinate, request.observer) >= 0)) return errorResponse('The target is below the horizon or is not a valid coordinate', 422, 'invalidParameter')

		const { coordinator } = this.operations
		return startCommand(this.operations, kind, connectionId, mount, request, () => (kind === 'mount.goto' ? this.#commander.goTo(coordinator, mount, coordinate) : this.#commander.flip(coordinator, mount, coordinate)))
	}

	// Runs the motion of a nudge: commands every axis of the direction through a nested manual motion, which
	// inherits the mount, and keeps it until the session is asked to end. A diagonal whose second axis cannot
	// start is stopped as a whole. The commander's cleanup releases the axes and waits for the mount.
	async #nudge(context: OperationContext, mount: Mount, direction: MountNudgeDirection, motion: LeasedMotion): Promise<OperationResult<void>> {
		const [first, second] = NUDGE_AXES[direction]
		const started = await this.#commander.startManualMove(context, mount, first)

		// A command that failed to send may still have reached the driver, so the end has to verify the stop.
		if (started.ok || started.reason === 'commandFailed') motion.commanded()
		if (!started.ok) return started

		const handle = started.value

		if (second !== undefined) {
			const joined = await handle.move(second, true)

			if (!joined.ok) {
				await handle.stop()
				return joined
			}
		}

		motion.moving()
		await motion.ending
		return await handle.stop()
	}

	// Stops observing the mounts and the nudge leases; their operations belong to the operation registry,
	// whose disposal cancels them, stopping every nudge.
	[Symbol.dispose]() {
		this.#nudges[Symbol.dispose]()
		this.#commander.dispose()
	}
}

// Routes of the mount commands and nudge sessions.
export function createMountRoutes(mounts: MountCommands) {
	return {
		'/api/connections/:id/mounts/:deviceId': {
			// Pointing and motion state of a mount; 404 when the connection is not open or has no such mount.
			GET: (req) => mounts.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/slew': {
			// Slews a mount to an object resolved at the current time; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.slew(req.params.id, req.params.deviceId, (await req.json()) as MountSlewRequest, req.signal),
		},
		'/api/connections/:id/mounts/:deviceId/stop': {
			// Cancels the operation of a mount and stops its motion.
			POST: (req) => mounts.stop(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/slew-rate': {
			// Selects the speed preset of manual motion; the new preset arrives as a mount:updated event.
			POST: async (req) => mounts.setSlewRate(req.params.id, req.params.deviceId, (await req.json()) as MountSlewRateRequest),
		},
		'/api/connections/:id/mounts/:deviceId/nudge': {
			// Starts a nudge held by a lease; its changes arrive as mount:nudge and operation:updated events.
			POST: async (req) => mounts.startNudge(req.params.id, req.params.deviceId, (await req.json()) as MountNudgeRequest),
		},
		'/api/connections/:id/mounts/:deviceId/goto': {
			// Starts a goto to a coordinate; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.goTo(req.params.id, req.params.deviceId, (await req.json()) as MountGoToRequest),
		},
		'/api/connections/:id/mounts/:deviceId/flip': {
			// Starts a meridian flip to a coordinate; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.flip(req.params.id, req.params.deviceId, (await req.json()) as MountGoToRequest),
		},
		'/api/connections/:id/mounts/:deviceId/sync': {
			// Redefines where the mount points.
			POST: async (req) => mounts.sync(req.params.id, req.params.deviceId, (await req.json()) as MountSyncRequest),
		},
		'/api/connections/:id/mounts/:deviceId/park': {
			// Starts parking; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.park(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/mounts/:deviceId/unpark': {
			// Starts unparking; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.unpark(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/mounts/:deviceId/home': {
			// Starts a slew to the home position; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.home(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/mounts/:deviceId/find-home': {
			// Starts the search for the home position; the outcome arrives as operation:updated events.
			POST: async (req) => mounts.findHome(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/mounts/:deviceId/set-home': {
			// Stores the current position as the home position.
			POST: (req) => mounts.setHome(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/set-park': {
			// Stores the current position as the park position.
			POST: (req) => mounts.setPark(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/mounts/:deviceId/tracking': {
			// Switches tracking, answered once the mount reports it.
			POST: async (req) => mounts.setTracking(req.params.id, req.params.deviceId, (await req.json()) as MountTrackingRequest),
		},
		'/api/connections/:id/mounts/:deviceId/track-mode': {
			// Selects the tracking rate; the new rate arrives as a mount:updated event.
			POST: async (req) => mounts.setTrackMode(req.params.id, req.params.deviceId, (await req.json()) as MountTrackModeRequest),
		},
		'/api/connections/:id/mounts/:deviceId/site': {
			// Sends a site to the mount.
			POST: async (req) => mounts.setSite(req.params.id, req.params.deviceId, (await req.json()) as MountSiteRequest),
		},
		'/api/connections/:id/mounts/:deviceId/time': {
			// Sends a clock to the mount.
			POST: async (req) => mounts.setTime(req.params.id, req.params.deviceId, (await req.json()) as MountTimeRequest),
		},
		'/api/mounts/nudges': {
			// The nudge sessions still running, started by any tab.
			GET: () => Response.json(mounts.nudges()),
		},
		'/api/mounts/nudges/:token/heartbeat': {
			// Renews the lease of a running nudge.
			POST: (req) => mounts.heartbeatNudge(req.params.token),
		},
		'/api/mounts/nudges/:token/stop': {
			// Ends a nudge, or records a press that has not started yet as ended; idempotent.
			POST: (req) => mounts.stopNudge(req.params.token),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
