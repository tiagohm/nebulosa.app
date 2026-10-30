import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { geodeticLocation, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay, awaitCooperativeJob } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { medianOf } from 'nebulosa/src/math/numerical/statistics'
import { type Angle, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureTime, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import { type CenteringCaptureOptions, centeringCaptureRequest, exposureMidpoint, solveResult } from 'nebulosa/src/observation/mount/centering'
import { computePointingError } from 'nebulosa/src/observation/mount/pointing'
import { type PointingPlan, type PointingPlanPattern, planPointingWaypoints, type PointingWaypoint } from 'nebulosa/src/observation/mount/pointing.plan'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, exposureProgressListener } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, notFound, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { PointingModels } from './mountpointing'
import { apparentFromIcrs, type EquatorialPosition, type PointingSite } from './mountpointing.frames'
import type { PointingAcquisitionState, PointingModelFile, PointingMountIdentity, PointingOpticsFingerprint, PointingSampleRecord } from './mountpointing.store'
import type { OperationDevice, OperationRegistry } from './operations'
import type { PlateSolvePreparation, PlateSolveRequest, PlateSolverProvider, PlateSolvingService } from './platesolving'

// Acquisition of the samples of a mount pointing model, for one camera and one mount. A session walks the waypoints of a
// plan: it sends the mount to each one with an uncorrected GoTo, never a Sync, waits for it to settle, takes one temporary
// LIGHT frame, plate solves it, and saves the sample before moving on, so a sample is never lost to a crash. It reuses the
// commander of the mount commands under its own lease, since the commands of MountCommands would find the mount busy; that
// also keeps any active model out, because only those commands correct a GoTo. Frames are auxiliary files deleted with the
// session, recorded as the latest frame of their camera (origin mountPointing), never saved as captures, and a sample never
// depends on its image, which closes once a newer frame replaces it.
//
// Each stretch of work is one mount.pointingModel operation, holding both devices. Pause and Stop cancel it, so the
// exposure in progress is lost and the devices are free between stretches, and answer at once, because a camera may stay
// held for minutes while its frame arrives. A resume is a new operation that checks everything again. After an operation
// ended, a mount that is not quiescent leaves the session blocked, since nothing proves it stopped. A session belongs to the
// server: it survives tab reloads and workspace changes. Sessions live in memory, the latest of each camera; a restart
// leaves their model interrupted, and a new session can continue it. Angles are radians, durations seconds, and instants
// Unix milliseconds.

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type MountPointingCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Sky a session samples.
export interface MountPointingPlanRequest {
	// Pattern of the waypoints.
	readonly pattern: PointingPlanPattern
	// Number of waypoints asked for.
	readonly count: number
	// Lowest altitude of a waypoint, in radians.
	readonly minimumAltitude: Angle
	// Hour angle half width left free around the meridian, in radians.
	readonly meridianAvoidance: Angle
}

// Body of POST /api/connections/:id/cameras/:deviceId/mount-pointing.
export interface MountPointingRequest extends CommandRequest {
	// Mount to sample, by its exact connection and device ids.
	readonly mount: OperationDevice
	// Camera settings of every frame.
	readonly capture: MountPointingCaptureSettings
	// Plate solver of every frame, resolved when each stretch of work starts.
	readonly solving: PlateSolveRequest
	// Sky to sample; ignored when continuing a model, which keeps its plan.
	readonly plan: MountPointingPlanRequest
	// Wait after the mount stopped and before each exposure, in seconds.
	readonly settleDelay: number
	// Whether the tracking the session started is stopped when it ends; false leaves it on.
	readonly stopTracking: boolean
	// Whether the operator confirmed the mount is equatorial, for a mount that does not report its type.
	readonly equatorialConfirmed: boolean
	// Name of a new model.
	readonly label?: string
	// Model to continue instead of creating one, whose missing waypoints are sampled.
	readonly modelId?: string
}

// Body of POST /api/mount-pointing/plan.
export interface MountPointingPlanPreviewRequest {
	// Mount whose site the plan is made for.
	readonly mount: OperationDevice
	// Sky to sample.
	readonly plan: MountPointingPlanRequest
}

// What a session is doing:
// - preparing: an operation is taking the devices and starting the tracking.
// - running: the waypoints are being sampled, as step tells.
// - pausing: a pause was requested and the operation is ending.
// - paused: no operation runs and the devices are free; a resume starts another one.
// - stopping: a stop was requested and the operation is ending.
// - blocked: an operation ended with the mount not quiescent, so a resume is refused until it is stopped by other means.
// - completed: every waypoint was visited.
// - stopped: the session was stopped, keeping its samples.
export type MountPointingState = 'preparing' | 'running' | 'pausing' | 'paused' | 'stopping' | 'blocked' | 'completed' | 'stopped'

// Step of a waypoint while running.
export type MountPointingStep = 'checking' | 'slewing' | 'settling' | 'exposing' | 'solving'

// Session record published to clients.
export interface MountPointingSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Model receiving the samples.
	readonly modelId: string
	// Id of the latest operation holding the camera and the mount.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Mount being sampled.
	readonly mount: OperationDevice
	// Name of the mount.
	readonly mountName: string
	// Request the session runs with.
	readonly request: Omit<MountPointingRequest, 'token'>
	// Plate solver of every frame.
	readonly provider: PlateSolverProvider
	// What the session is doing.
	readonly state: MountPointingState
	// Step of the waypoint, while running.
	readonly step?: MountPointingStep
	// Position in the plan of the waypoint being sampled.
	readonly waypoint?: number
	// Waypoints of the plan.
	readonly plannedCount: number
	// Waypoints with an accepted sample.
	readonly acceptedCount: number
	// Attempts rejected.
	readonly rejectedCount: number
	// Waypoints given up on.
	readonly skippedCount: number
	// Frames taken so far.
	readonly frameCount: number
	// Whether the session started the tracking of a mount that was not tracking; absent when it was already on.
	readonly trackingStarted?: boolean
	// Whether the tracking the session started was stopped again when it ended; absent before it ended, when it started
	// none, or when the request asked to leave it on.
	readonly trackingStopped?: boolean
	// Progress of the frame being exposed, as the driver reports it (times in microseconds, progress in percent);
	// absent outside an exposure and before the driver reported any.
	readonly exposure?: CameraCaptureTime
	// Problems meant for people, latest last.
	readonly warnings: readonly string[]
	// Why the latest operation failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure meant for people.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC); absent while it can still resume.
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Snapshot of GET /api/mount-pointing/sessions: the latest session of every camera.
export interface MountPointingSnapshot {
	readonly sessions: readonly MountPointingSessionSummary[]
}

// Response of an accepted start or resume.
export interface MountPointingStartResponse {
	// Id of the session.
	readonly sessionId: string
	// Model receiving the samples.
	readonly modelId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
}

// Notification published whenever a session changes.
export type MountPointingEvent = { readonly type: 'mountPointing:updated'; readonly session: MountPointingSessionSummary }

// Receiver of session events.
export type MountPointingListener = (event: MountPointingEvent) => void

// Longest wait for one GoTo, in milliseconds. A driver that never reports the slew fails here instead of at the
// commander's default of 10 minutes.
const SLEW_TIMEOUT = 300000

// Longest wait for one solve, queue included, in seconds; the provider's own timeout normally ends it first.
const SOLVE_TIMEOUT = 600

// Watchdog after an aborted solve before it is reported unresponsive, in seconds.
const SOLVE_ABORT_GRACE = 10

// Exposures of a waypoint before it is given up on. Only a frame is repeated: a slew of nearly nothing might never show.
const SOLVE_ATTEMPTS = 2

// Waypoints given up on in a row before the operation fails, instead of slewing on blindly.
const MAXIMUM_CONSECUTIVE_FAILURES = 5

// Largest distance between a command and its solution, in radians; matches the sample separation the toolkit's fit
// accepts. Farther than this the frame is more likely a wrong solution than a pointing error.
const MAXIMUM_SEPARATION = 5 * DEG2RAD

// Largest relative difference of the scale of a solution from the median of a session; provisional.
const MAXIMUM_SCALE_DIFFERENCE = 0.05

// Accepted solutions needed before their median scale judges another.
const MINIMUM_SCALE_SAMPLES = 3

// Distance from the celestial poles left without waypoints, in radians, where the error in right ascension is unstable.
const POLE_AVOIDANCE = 10 * DEG2RAD

// Largest change of the site between stretches of work, in radians; a mount reporting another site invalidates samples.
const SITE_TOLERANCE = 0.001 * DEG2RAD

// Warnings kept per session.
const MAXIMUM_WARNINGS = 20

// A session while its service knows it.
interface Session {
	summary: MountPointingSessionSummary
	// Camera of the session, resolved again by a resume.
	camera: Camera
	// Mount of the session, resolved again by a resume.
	mount: Mount
	// Provider settings of the current stretch of work.
	preparation: PlateSolvePreparation
	// Site of the samples.
	readonly site: PointingSite
	// Waypoints of the plan.
	readonly waypoints: readonly PointingWaypoint[]
	// Waypoints already sampled or given up on.
	readonly visited: Set<number>
	// Attempts of each waypoint so far, kept across stretches so an id never repeats.
	readonly attempts: Map<number, number>
	// Scales of the accepted solutions, in radians per pixel.
	readonly scales: number[]
	// Waypoints given up on in a row.
	failures: number
	// What the operator asked for the operation being cancelled.
	intent?: 'pause' | 'stop'
	// Operation holding the devices, while one runs.
	handle?: OperationHandle<void>
}

// Returns the site a mount reports, with the elevation in meters.
function siteOf({ geographicCoordinate: { latitude, longitude, elevation } }: Mount): PointingSite {
	return { latitude, longitude, elevation: toMeter(elevation) }
}

// Returns whether two sites are the same.
function sameSite(a: PointingSite, b: PointingSite) {
	return Math.abs(a.latitude - b.latitude) < SITE_TOLERANCE && Math.abs(a.longitude - b.longitude) < SITE_TOLERANCE
}

// Returns the identity of a mount.
function identityOf(mount: Mount, connectionId: string): PointingMountIdentity {
	return { hardwareId: resourceKey(mount), connectionId, deviceId: mount.id, name: mount.name, driver: { executable: mount.driver.executable, version: mount.driver.version } }
}

// Reason a connected mount cannot be sampled, or undefined when it can.
function mountRefusal(mount: Mount, equatorialConfirmed: boolean) {
	if (mount.mountType === 'ALTAZ') return `${mount.name} is not an equatorial mount`
	if (mount.mountType === 'UNKNOWN' && !equatorialConfirmed) return `${mount.name} does not report its type; confirm that it is equatorial`
	if (!mount.canGoTo) return `${mount.name} cannot go to a target`
	if (!mount.canAbort) return `${mount.name} cannot abort a motion`
	const { latitude, longitude } = mount.geographicCoordinate
	if (latitude === 0 && longitude === 0) return `${mount.name} reports no site`
	if (mount.parked || mount.parking) return `${mount.name} is parked`
	if (!mount.tracking && !mount.canTracking) return `${mount.name} is not tracking and cannot start tracking`
	return undefined
}

// Returns the plan of a request at a latitude, leaving the poles out.
export function pointingPlan({ pattern, count, minimumAltitude, meridianAvoidance }: MountPointingPlanRequest, latitude: Angle): PointingPlan {
	return planPointingWaypoints({ pattern, count, latitude, minimumAltitude, meridianAvoidance, limits: { declination: [-Math.PI / 2 + POLE_AVOIDANCE, Math.PI / 2 - POLE_AVOIDANCE] } })
}

// Returns the optical evidence of a model from its accepted samples.
function measuredOptics(model: Readonly<PointingModelFile>): PointingOpticsFingerprint {
	const accepted = model.samples.filter((sample) => sample.status === 'accepted')
	const scales = accepted.flatMap((sample) => (sample.scale === undefined ? [] : [sample.scale * model.optics.binning]))
	const orientations = accepted.flatMap((sample) => (sample.orientation === undefined ? [] : [normalizeAngle(sample.orientation * 2) / 2]))
	const parity = accepted.find((sample) => sample.parity !== undefined)?.parity
	return { ...model.optics, ...(scales.length > 0 && { scale: medianOf(scales.toSorted((a, b) => a - b)) }), ...(orientations.length > 0 && { orientation: medianOf(orientations.toSorted((a, b) => a - b)) }), ...(parity && { parity }) }
}

// Returns the warnings with one more, keeping the latest MAXIMUM_WARNINGS.
function appendWarning(warnings: readonly string[], warning: string) {
	return [...warnings, warning].slice(-MAXIMUM_WARNINGS)
}

// Acquisition sessions of the cameras of every open connection.
export class MountPointingSessions {
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session of each operation a command token started, so a repeated start or resume answers it.
	readonly #byOperation = new Map<string, Session>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// stretch of work, commander moves the mounts (the one of the mount commands), capturer takes the frames (the one of
	// the capture service), images receives the frames, frames records them as the latest frame of their camera and
	// closes them, plateSolving solves them, models keeps the samples, and listener receives every session change
	// synchronously. auxiliaryDir is the parent of the temporary directory of each stretch of work.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly commander: MountCommander,
		readonly capturer: CameraCapturer,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly plateSolving: Pick<PlateSolvingService, 'prepare' | 'solve'>,
		readonly models: PointingModels,
		readonly listener: MountPointingListener,
		readonly auxiliaryDir: string = tmpdir(),
	) {
		models.protectWith((modelId) => this.#holds(modelId))
	}

	// Returns whether a session that has not ended owns a model.
	#holds(modelId: string) {
		for (const { summary } of this.#sessions.values()) if (summary.modelId === modelId && summary.endedAt === undefined) return true
		return false
	}

	// Returns the latest session of every camera.
	snapshot(): MountPointingSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with a session, or 404 when it is not the latest of its camera. Its samples are those of its model.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json(session.summary) : notFound('Session')
	}

	// Responds with the plan a request would sample, which commands nothing. Responds 404 for an unknown mount, 409 when it
	// is disconnected, and 422 when it reports no site.
	preview({ mount: device, plan }: MountPointingPlanPreviewRequest): Response {
		const mount = connectedDevice(this, device.connectionId, 'mount', device.deviceId, 'Mount')
		if (mount instanceof Response) return mount
		const { latitude, longitude } = mount.geographicCoordinate
		if (latitude === 0 && longitude === 0) return unsupported(`${mount.name} reports no site`)
		return Response.json(pointingPlan(plan, latitude))
	}

	// Starts a session. Responds 202 with MountPointingStartResponse once accepted (a repeated token answers its first
	// session); its progress and outcome arrive as mountPointing:updated and operation:updated events. Responds 404 for an
	// unknown camera, mount, or model; 409 when either device is disconnected or held, when the camera has a session that
	// did not end, or when a model to continue belongs to another mount or site; and 422 when the plate solver is not
	// configured, the mount cannot be sampled, or the sky allows no waypoint.
	async start(connectionId: string, deviceId: string, request: MountPointingRequest): Promise<Response> {
		const repeated = this.#repeated(request.token)
		if (repeated) return this.#accepted(repeated)

		// The provider settings are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.plateSolving.prepare(request.solving)
		if (!preparation) return unsupported('The plate solver is not configured; set it up in Settings → External Tools')

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (mount instanceof Response) return mount
		const refused = mountRefusal(mount, request.equatorialConfirmed)
		if (refused) return unsupported(refused)
		if (!this.operations.available(camera) || !this.operations.available(mount)) return busy()

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous && previous.summary.endedAt === undefined) return errorResponse('The camera has a pointing session that did not end', 409, 'busy')

		const site = siteOf(mount)
		const continued = request.modelId === undefined ? undefined : await this.models.store.get(request.modelId)
		if (request.modelId !== undefined && !continued) return notFound('Model')
		if (continued && this.#holds(continued.modelId)) return errorResponse('The model is in use', 409, 'busy')
		if (continued && continued.mount.hardwareId !== resourceKey(mount)) return errorResponse('The model belongs to another mount', 409, 'incompatible')
		if (continued && !sameSite(continued.site, site)) return errorResponse('The model was measured at another site', 409, 'incompatible')

		const plan = continued ? undefined : pointingPlan(request.plan, site.latitude)
		if (plan?.waypoints.length === 0) return unsupported('The allowed sky holds no waypoint')

		const startedAt = Date.now()
		const sessionId = crypto.randomUUID()
		const model = continued ?? (await this.#createModel(request, plan!, sessionId, camera, mount, site, startedAt))

		// Creating the model gave way to other requests, so what was checked is checked again.
		const raced = this.#repeated(request.token)

		if (raced || !this.operations.available(camera) || !this.operations.available(mount)) {
			if (!continued) await this.models.store.delete(model.modelId)
			return raced ? this.#accepted(raced) : busy()
		}

		const { token, ...settings } = request
		const visited = new Set(model.samples.filter((sample) => sample.status === 'accepted').map((sample) => sample.waypoint))
		const attempts = new Map<number, number>()
		for (const sample of model.samples) attempts.set(sample.waypoint, Math.max(attempts.get(sample.waypoint) ?? 0, sample.attempt))

		const session: Session = {
			summary: {
				sessionId,
				modelId: model.modelId,
				operationId: '',
				camera: { connectionId, deviceId },
				cameraName: camera.name,
				mount: request.mount,
				mountName: mount.name,
				request: settings,
				provider: request.solving.provider,
				state: 'preparing',
				plannedCount: model.plan.waypoints.length,
				acceptedCount: visited.size,
				rejectedCount: 0,
				skippedCount: 0,
				frameCount: 0,
				warnings: [],
				startedAt,
				revision: 0,
			},
			camera,
			mount,
			preparation,
			site,
			waypoints: model.plan.waypoints,
			visited,
			attempts,
			scales: model.samples.flatMap((sample) => (sample.status === 'accepted' && sample.scale !== undefined ? [sample.scale] : [])),
			failures: 0,
		}

		if (previous) this.#byOperation.delete(previous.summary.operationId)
		this.#sessions.set(key, session)
		this.#begin(session, token)
		void this.#saveAcquisition(session, 'running')
		return this.#accepted(session)
	}

	// Resumes a paused session in a new operation, after checking everything again. Responds 202 with
	// MountPointingStartResponse (a repeated token answers its first resume); 404 for an unknown or ended session; 409 when
	// it is not paused, a device is disconnected or held, or the mount or its site changed; and 422 when the plate solver is
	// not configured or the mount cannot be sampled any more.
	async resume(sessionId: string, { token }: CommandRequest): Promise<Response> {
		const repeated = this.#repeated(token)
		if (repeated) return this.#accepted(repeated)

		const session = this.#find(sessionId)
		if (!session || session.summary.endedAt !== undefined) return notFound('Session')
		if (session.summary.state === 'blocked') return errorResponse('The mount could not be confirmed stopped; stop it and the session', 409, 'blocked')
		if (session.summary.state !== 'paused') return errorResponse('The session is not paused', 409, 'busy')

		const { camera: cameraDevice, mount: mountDevice, request } = session.summary
		const preparation = await this.plateSolving.prepare(request.solving)
		if (!preparation) return unsupported('The plate solver is not configured; set it up in Settings → External Tools')

		const camera = connectedDevice(this, cameraDevice.connectionId, 'camera', cameraDevice.deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, mountDevice.connectionId, 'mount', mountDevice.deviceId, 'Mount')
		if (mount instanceof Response) return mount
		const refused = mountRefusal(mount, request.equatorialConfirmed)
		if (refused) return unsupported(refused)
		if (resourceKey(mount) !== resourceKey(session.mount)) return errorResponse('The mount changed', 409, 'incompatible')
		if (!sameSite(siteOf(mount), session.site)) return errorResponse('The mount reports another site', 409, 'incompatible')
		if (!this.operations.available(camera) || !this.operations.available(mount)) return busy()
		if (session.summary.state !== 'paused') return errorResponse('The session is not paused', 409, 'busy')

		session.camera = camera
		session.mount = mount
		session.preparation = preparation
		session.failures = 0
		this.#begin(session, token)
		void this.#saveAcquisition(session, 'running')
		return this.#accepted(session)
	}

	// Pauses a session: the motion, exposure, or solve in progress is cancelled and the devices are released. Answers at
	// once; the end arrives as an event, since a camera may stay held until its frame arrives. Responds 202, 404 for an
	// unknown or ended session, and 409 when no work runs.
	pause(sessionId: string): Response {
		const session = this.#find(sessionId)
		if (!session || session.summary.endedAt !== undefined) return notFound('Session')
		const { state } = session.summary
		if (state !== 'running' && state !== 'preparing') return errorResponse('The session is not running', 409, 'busy')

		session.intent = 'pause'
		this.#update(session, { state: 'pausing', step: undefined, exposure: undefined })
		void session.handle?.cancel('aborted')
		return new Response(null, { status: 202 })
	}

	// Stops a session for good, keeping its samples. Answers at once; the end arrives as an event. Responds 202, and 404 for
	// an unknown or ended session.
	stop(sessionId: string): Response {
		const session = this.#find(sessionId)
		if (!session || session.summary.endedAt !== undefined) return notFound('Session')

		const { state } = session.summary

		if (state === 'paused' || state === 'blocked') {
			void this.#finish(session, 'stopped')
			return new Response(null, { status: 202 })
		}

		session.intent = 'stop'
		this.#update(session, { state: 'stopping', step: undefined, exposure: undefined })
		void session.handle?.cancel('aborted')
		return new Response(null, { status: 202 })
	}

	// Creates the model of a new session.
	#createModel(request: MountPointingRequest, plan: PointingPlan, sessionId: string, camera: Camera, mount: Mount, site: PointingSite, createdAt: number) {
		const { capture, label } = request
		const { pattern, minimumAltitude, meridianAvoidance } = request.plan
		const subframe = capture.subframe ? { subframe: { x: capture.x, y: capture.y, width: capture.width, height: capture.height } } : {}

		return this.models.store.create({
			modelId: crypto.randomUUID(),
			label: label?.trim() || `${mount.name} ${new Date(createdAt).toISOString().slice(0, 16).replace('T', ' ')}`,
			mount: identityOf(mount, request.mount.connectionId),
			site,
			optics: { cameraId: camera.id, cameraName: camera.name, binning: capture.binX, ...subframe },
			origin: 'session',
			createdAt,
			plan: { pattern, minimumAltitude, meridianAvoidance, waypoints: plan.waypoints },
			acquisition: { sessionId, state: 'running' },
			samples: [],
			revisions: [],
		})
	}

	// Starts the operation of a stretch of work.
	#begin(session: Session, token: string) {
		const { camera, mount } = session.summary

		const record = this.operations.run('mount.pointingModel', [camera, mount], token, () => {
			const handle = this.#run(session)
			session.handle = handle
			return handle.result
		})

		this.#byOperation.set(record.operationId, session)
		this.#update(session, { operationId: record.operationId, state: 'preparing', reason: undefined, error: undefined })
		void session.handle!.result.then((result) => this.#operationEnded(session, result))
	}

	// Runs a stretch of work holding the camera and the mount.
	#run(session: Session): OperationHandle<void> {
		const { camera, mount } = session
		const resources: ResourceRequest[] = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(mount), device: mount },
		]

		return this.operations.coordinator.start<void>('mountPointingSession', resources, async (context) => {
			const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-pointing-'))

			try {
				// A slew, like every sample, is measured against the sky the mount tracks.
				if (!mount.tracking) {
					const started = await this.commander.setTracking(context, mount, true)
					if (!started.ok) return started
					this.#update(session, { trackingStarted: true })
				}

				for (const waypoint of session.waypoints) {
					if (session.visited.has(waypoint.index)) continue
					const measured = await this.#sample(session, context, waypoint, directory)
					if (!measured.ok) return measured
				}

				return successfulOperationResult(undefined)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}

	// Samples one waypoint: slews, settles, and exposes until a frame solves or its attempts run out. Resolves failed only
	// for what ends the operation: a cancellation, a failed slew or capture, or too many waypoints given up on in a row.
	async #sample(session: Session, context: OperationContext, waypoint: PointingWaypoint, directory: string): Promise<OperationResult<void>> {
		const { mount, site } = session
		this.#update(session, { state: 'running', waypoint: waypoint.index, step: 'checking' })

		// The waypoint is fixed on the local sky, so it stays clear of the horizon; what can change is the mount.
		if (!mount.connected) return failedOperationResult('unexpectedState', `${mount.name} disconnected`)
		if (mount.parked || mount.parking) return failedOperationResult('unexpectedState', `${mount.name} was parked`)

		const commandedAt = Date.now()
		const time = timeUnix(commandedAt / 1000, true)
		const lst = localSiderealTime(time, geodeticLocation(site.longitude, site.latitude, 0))
		const command: EquatorialPosition = { rightAscension: normalizeAngle(lst - waypoint.hourAngle), declination: waypoint.declination }

		this.#update(session, { step: 'slewing' })
		const slewed = await this.commander.goTo(context, mount, { type: 'JNOW', JNOW: { x: command.rightAscension, y: command.declination } }, { time, tolerance: 0, timeout: SLEW_TIMEOUT })
		if (!slewed.ok) return slewed

		this.#update(session, { step: 'settling' })
		const settled = await abortableDelay(session.summary.request.settleDelay * 1000, context.signal)
		if (!settled.ok) return settled

		for (let attempt = 1; attempt <= SOLVE_ATTEMPTS; attempt++) {
			const solved = await this.#exposeAndSolve(session, context, command, directory)
			if (!solved.ok) return solved

			if (solved.value) {
				const { solution, observedAt } = solved.value
				return await this.#record(session, waypoint, commandedAt, command, { rightAscension: slewed.value.rightAscension, declination: slewed.value.declination }, slewed.value.pierSide, solution, observedAt)
			}
		}

		return await this.#giveUp(session, waypoint, commandedAt, command, slewed.value.pierSide, 'No plate solution')
	}

	// Takes one frame at a waypoint and solves it. Resolves the solution and the middle of the exposure, undefined when the
	// frame did not solve, or the failure that ends the operation.
	async #exposeAndSolve(session: Session, context: OperationContext, command: EquatorialPosition, directory: string): Promise<OperationResult<{ readonly solution: PlateSolution; readonly observedAt: number } | undefined>> {
		const { camera, mount } = session
		const number = session.summary.frameCount + 1
		const path = join(directory, `pointing-${number}.fit`)
		const capture: CenteringCaptureOptions = { ...session.summary.request.capture, exposureTimeUnit: 'second', frameType: 'LIGHT', compressed: false }
		const request = centeringCaptureRequest(capture, path, mount)

		this.#update(session, { step: 'exposing', frameCount: number })

		const listener = exposureProgressListener((exposure) => this.#update(session, { exposure }))
		const captured = await this.capturer.start(context, camera, request, { clock: SYSTEM_CAMERA_CAPTURE_CLOCK, listener }).result
		if (!captured.ok) return captured

		const [frame] = captured.value.frames
		if (!frame) return failedOperationResult('unexpectedState', 'The capture produced no frame')

		const observedAt = exposureMidpoint(frame, request)
		this.#update(session, { step: 'solving', exposure: undefined })

		const outcome = await awaitCooperativeJob((signal) => this.#solve(session, number, path, observedAt, command, signal), { signal: context.signal, timeout: SOLVE_TIMEOUT * 1000, abortGrace: SOLVE_ABORT_GRACE * 1000, delay: abortableDelay })
		await rm(path, { force: true })

		if (outcome.kind === 'rejected') return successfulOperationResult(undefined)

		const solved = solveResult(outcome, context.signal, SOLVE_TIMEOUT)
		if (!solved.ok) return solved
		return successfulOperationResult(solved.value && { solution: solved.value, observedAt })
	}

	// Decodes a frame into the image store, records it as the latest frame of the camera, and solves it around the command,
	// whose J2000 place is a better hint than the snooped header. Resolves the solution, or undefined when the search found
	// none; a failure other than a cancellation is a warning and rejects, which counts the frame as unsolved.
	async #solve(session: Session, number: number, path: string, time: number, command: EquatorialPosition, signal: AbortSignal): Promise<PlateSolution | undefined> {
		const { camera, cameraName, sessionId, request } = session.summary
		const { preparation } = session

		try {
			const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
			const frameId = captureFrameId(sessionId, number)
			const info = await this.images.openCapture(bytes, basename(path), { ...camera, frameId, time })
			const { width, height, channels, cfa, acquisition } = info
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const record: CaptureFrame = { imageId: info.id, sessionId, ...camera, generation: number, time, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
			this.frames.previewed(info, record, cameraName, 'mountPointing')

			const [rightAscension, declination] = equatorialToJ2000(command.rightAscension, command.declination, timeUnix(time / 1000, true))
			const hints = request.solving.strategy === 'assisted' ? { ...preparation.request.hints, rightAscension: normalizeAngle(rightAscension), declination } : preparation.request.hints
			const hinted = { ...preparation, request: { ...preparation.request, ...(hints && { hints }) } }

			// The frame may have taken long enough to decode for the session to be cancelled meanwhile.
			signal.throwIfAborted()
			const result = await this.plateSolving.solve(info.id, hinted, signal, { kind: 'mountPointing', sessionId, ...camera, frameId })
			if (!result.solution) this.#warn(session, `Frame ${number} did not solve.`)
			return result.solution
		} catch (error) {
			if (!signal.aborted) this.#warn(session, `Frame ${number} could not be solved: ${Error.isError(error) ? error.message : String(error)}`)
			throw error
		}
	}

	// Judges a solution and saves its sample before anything moves again. A solution that is rejected still counts as a
	// visit: the frame was sharp enough to solve, so exposing it again would answer the same.
	async #record(session: Session, waypoint: PointingWaypoint, commandedAt: number, command: EquatorialPosition, reported: EquatorialPosition, pierSide: Mount['pierSide'], solution: PlateSolution, time: number): Promise<OperationResult<void>> {
		const { rightAscension, declination, scale, orientation, parity } = solution
		const solvedIcrs: EquatorialPosition = { rightAscension, declination }
		const solved = apparentFromIcrs(solvedIcrs, time, session.site)
		const reason = this.#rejection(session, command, solved, scale)
		const attempt = (session.attempts.get(waypoint.index) ?? 0) + 1
		const { sessionId } = session.summary

		const sample: PointingSampleRecord = {
			id: `${sessionId}:${waypoint.index}:${attempt}`,
			waypoint: waypoint.index,
			attempt,
			sessionId,
			role: waypoint.role,
			status: reason ? 'rejected' : 'accepted',
			...(reason && { reason }),
			time,
			commandedAt,
			command,
			reported,
			solvedIcrs,
			solved,
			pierSide,
			scale,
			orientation,
			parity,
		}

		const saved = await this.#save(session, sample)
		if (!saved.ok) return saved

		session.attempts.set(waypoint.index, attempt)
		session.visited.add(waypoint.index)

		if (reason) {
			this.#warn(session, `Waypoint ${waypoint.index + 1}: ${reason}.`)
			return this.#failed(session, { rejectedCount: session.summary.rejectedCount + 1, skippedCount: session.summary.skippedCount + 1 })
		}

		session.scales.push(scale)
		session.failures = 0
		this.#update(session, { acceptedCount: session.summary.acceptedCount + 1 })
		return successfulOperationResult(undefined)
	}

	// Saves that a waypoint gave no solution and goes on, unless too many did in a row.
	async #giveUp(session: Session, waypoint: PointingWaypoint, commandedAt: number, command: EquatorialPosition, pierSide: Mount['pierSide'], reason: string): Promise<OperationResult<void>> {
		const attempt = (session.attempts.get(waypoint.index) ?? 0) + 1
		const { sessionId } = session.summary
		const sample: PointingSampleRecord = { id: `${sessionId}:${waypoint.index}:${attempt}`, waypoint: waypoint.index, attempt, sessionId, role: waypoint.role, status: 'rejected', reason, time: Date.now(), commandedAt, command, pierSide }

		const saved = await this.#save(session, sample)
		if (!saved.ok) return saved

		session.attempts.set(waypoint.index, attempt)
		session.visited.add(waypoint.index)
		this.#warn(session, `Waypoint ${waypoint.index + 1} was skipped: ${reason}.`)
		return this.#failed(session, { rejectedCount: session.summary.rejectedCount + 1, skippedCount: session.summary.skippedCount + 1 })
	}

	// Counts a waypoint given up on, failing the operation after too many in a row.
	#failed(session: Session, counters: Pick<MountPointingSessionSummary, 'rejectedCount' | 'skippedCount'>): OperationResult<void> {
		this.#update(session, counters)
		if (++session.failures < MAXIMUM_CONSECUTIVE_FAILURES) return successfulOperationResult(undefined)
		return failedOperationResult('commandFailed', `${MAXIMUM_CONSECUTIVE_FAILURES} waypoints in a row gave no sample`)
	}

	// Returns why a solution cannot be a sample, or undefined when it can.
	#rejection(session: Session, command: EquatorialPosition, solved: EquatorialPosition, scale: number) {
		const { angularSeparation } = computePointingError(command.rightAscension, command.declination, solved.rightAscension, solved.declination)
		if (!(angularSeparation <= MAXIMUM_SEPARATION)) return 'The solution is too far from the command'

		if (session.scales.length >= MINIMUM_SCALE_SAMPLES) {
			const median = medianOf(session.scales.toSorted((a, b) => a - b))
			if (!(Math.abs(scale / median - 1) <= MAXIMUM_SCALE_DIFFERENCE)) return 'The image scale differs from the session'
		}

		return undefined
	}

	// Appends a sample to the model. A sample that cannot be saved ends the operation: moving on would lose it.
	async #save(session: Session, sample: PointingSampleRecord): Promise<OperationResult<void>> {
		try {
			const saved = await this.models.store.update(session.summary.modelId, (model) => ({ ...model, samples: [...model.samples, sample] }))
			if (saved.status !== 'saved') return failedOperationResult('unexpectedState', 'The model of the session is gone')
			this.models.published(saved.model)
			return successfulOperationResult(undefined)
		} catch (error) {
			return failedOperationResult('unexpectedState', `The sample could not be saved: ${Error.isError(error) ? error.message : String(error)}`)
		}
	}

	// Saves the state of the acquisition of a session. A failure is a warning: the samples are saved already.
	async #saveAcquisition(session: Session, state: PointingAcquisitionState) {
		const { modelId, sessionId } = session.summary

		try {
			const saved = await this.models.store.update(modelId, (model) => ({ ...model, optics: measuredOptics(model), acquisition: { sessionId, state } }))
			if (saved.status === 'saved') this.models.published(saved.model)
			return saved.status === 'saved' ? saved.model : undefined
		} catch (error) {
			this.#warn(session, `The state of the model could not be saved: ${Error.isError(error) ? error.message : String(error)}`)
			return undefined
		}
	}

	// Records the end of an operation. Nothing proves a stop but the mount itself, so a cancelled or failed operation that
	// left the mount moving blocks the session; otherwise the intent of the operator tells where it goes, and a cancel from
	// outside or a failure pauses it with the reason, keeping every sample.
	async #operationEnded(session: Session, result: OperationResult<void>) {
		const { intent, mount } = session
		session.intent = undefined
		session.handle = undefined

		if (result.ok) return await this.#finish(session, 'completed')

		if (mount.connected && !isDeviceQuiescent(mount)) {
			await this.#saveAcquisition(session, 'paused')
			return this.#update(session, { state: 'blocked', step: undefined, exposure: undefined, reason: result.reason, error: `${mount.name} could not be confirmed stopped` })
		}

		if (intent === 'stop') return await this.#finish(session, 'stopped')

		const failure = intent === 'pause' ? {} : { reason: result.reason, ...(result.error !== undefined && { error: result.error }) }
		const warnings = intent === 'pause' ? session.summary.warnings : appendWarning(session.summary.warnings, result.reason === 'aborted' ? 'The session was stopped from outside and paused.' : `The session paused: ${result.error ?? result.reason}.`)
		await this.#saveAcquisition(session, 'paused')
		return this.#update(session, { state: 'paused', step: undefined, exposure: undefined, warnings, ...failure })
	}

	// Ends a session, keeping its samples: stops the tracking it started unless the request leaves it on, and fits a run with
	// enough samples. The operation released the mount, so that stop takes it again for itself; another operation that took
	// it first, or a disconnection, leaves the mount as the session left it.
	async #finish(session: Session, state: Extract<MountPointingState, 'completed' | 'stopped'>) {
		const { mount } = session

		if (session.summary.trackingStarted && session.summary.request.stopTracking) {
			const stopped = !mount.tracking || (mount.connected && this.operations.available(mount) && (await this.commander.setTracking(this.operations.coordinator, mount, false)).ok)
			if (stopped) this.#update(session, { trackingStopped: true })
			else this.#update(session, { trackingStopped: false, warnings: appendWarning(session.summary.warnings, `The tracking of ${mount.name} that the session started was left on.`) })
		}

		const model = await this.#saveAcquisition(session, state)
		this.#update(session, { state, step: undefined, waypoint: undefined, exposure: undefined, endedAt: Date.now() })
		if (model) this.models.fitAfterRun(model)
	}

	// Returns the session of a token already used.
	#repeated(token: string) {
		const known = this.operations.started(token)
		return known && this.#byOperation.get(known.operationId)
	}

	// Responds that a session was accepted.
	#accepted({ summary: { sessionId, modelId, operationId } }: Session) {
		return Response.json({ sessionId, modelId, operationId } satisfies MountPointingStartResponse, { status: 202 })
	}

	// Records a warning of a session.
	#warn(session: Session, warning: string) {
		this.#update(session, { warnings: appendWarning(session.summary.warnings, warning) })
	}

	// Returns the latest session with this id.
	#find(sessionId: string): Session | undefined {
		for (const session of this.#sessions.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Publishes a changed session with the next revision; a session replaced by a newer one of its camera changes silently.
	#update(session: Session, patch: Partial<MountPointingSessionSummary>) {
		session.summary = { ...session.summary, ...patch, revision: session.summary.revision + 1 }
		if (Array.from(this.#sessions.values()).includes(session)) this.listener({ type: 'mountPointing:updated', session: session.summary })
	}
}

// Routes of the acquisition sessions.
export function createMountPointingRoutes(sessions: MountPointingSessions) {
	return {
		'/api/mount-pointing/sessions': {
			// The latest pointing session of every camera, started by any tab.
			GET: () => Response.json(sessions.snapshot()),
		},
		'/api/mount-pointing/sessions/:sessionId': {
			// A pointing session.
			GET: (req) => sessions.session(req.params.sessionId),
		},
		'/api/mount-pointing/sessions/:sessionId/pause': {
			// Pauses a pointing session, releasing its devices.
			POST: (req) => sessions.pause(req.params.sessionId),
		},
		'/api/mount-pointing/sessions/:sessionId/resume': {
			// Resumes a paused pointing session in a new operation.
			POST: async (req) => sessions.resume(req.params.sessionId, (await req.json()) as CommandRequest),
		},
		'/api/mount-pointing/sessions/:sessionId/stop': {
			// Ends a pointing session, keeping its samples.
			POST: (req) => sessions.stop(req.params.sessionId),
		},
		'/api/mount-pointing/plan': {
			// The waypoints a session would visit, which commands nothing.
			POST: async (req) => sessions.preview((await req.json()) as MountPointingPlanPreviewRequest),
		},
		'/api/connections/:id/cameras/:deviceId/mount-pointing': {
			// Starts a pointing session with this camera; its progress and outcome arrive as events.
			POST: async (req) => sessions.start(req.params.id, req.params.deviceId, (await req.json()) as MountPointingRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
