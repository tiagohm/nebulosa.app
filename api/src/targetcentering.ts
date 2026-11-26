import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { angularDistance, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { RotatorCommander } from 'nebulosa/src/devices/commanders/rotator'
import type { Camera, Mount, MountTargetCoordinate, PierSide, Rotator } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type Angle, deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureTime, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import {
	type CenteringCorrection,
	type CenteringFrame,
	type CenteringMeasurement,
	type CenteringObserver,
	type CenteringOptions,
	type CenteringOrientation,
	type CenteringRotationCheck,
	type CenteringServices,
	type CenteringStep,
	type CenteringTarget,
	centerTarget,
	plannedRotation,
	positionAngleError,
} from 'nebulosa/src/observation/mount/centering'
import { CameraSessionRegistry } from './camerasessions'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, exposureProgressListener } from './captures'
import { type ClientResolver, type CommandErrorCode, type CommandRefusal, type CommandRequest, notFound, refusal, refusalResponse, resolveConnected } from './commands'
import type { DeviceRegistry } from './devices'
import type { GuidingRestoration, GuidingSessions, GuidingSuspension } from './guiding'
import type { ImageStore } from './images'
import type { MountCommands } from './mounts'
import { type OperationDevice, type OperationRegistry, type ToolInvocation, settledResult } from './operations'
import { type PlateSolvePreparation, type PlateSolveRequest, PlateSolvingError, type PlateSolvingService } from './platesolving'
import type { RotatorSenseStore, StoredRotatorSense } from './rotatorsense.store'
import type { SkyObserver } from './sky/ephemeris'

// Target Centering: brings a fixed J2000 target to the center of a camera, or measures how far it is, inside one
// mount.targetCentering operation. Center slews first, through the same refusals and the single correction of the goto
// route (MountCommands.goToWithin), but only when the mount stands farther than a correction may go; Verify Only
// never commands the mount. Then the toolkit's centerTarget exposes, solves, and corrects with the residual it measured,
// which never passes through a pointing model, so a model in force is applied once, by the first slew, and later changes of
// it cannot reach the session. Success is only ever a solution taken after the last motion, within the tolerance.
//
// The operation's root holds the camera and a child of it the mount, both until the end, so nothing comes between an
// exposure and its correction. Frames are auxiliary files deleted once solved, recorded as the latest frame of their camera
// (origin targetCentering), never saved as captures. Guiding that may pulse the mount is stopped first, in the operation and
// before the mount is taken, since it may hold the mount itself, and restored once the mount was released, with the calibration
// in use derived again for where the mount points (solved again only where it does not apply, see
// GuidingSessions.restoreAfterMotion); only what the session stopped is restored, and a failure there is told apart from the position, which stays verified. Guiding it
// does not stop refuses the start, and the mount is kept from being guided until the operation ends. The guiding that moves
// the mount is the guiding through the guide output the request names, the GUIDE_OUTPUT of the Equipment Setup, which drives
// its MOUNT whether it is the mount's own port or a camera's ST4 (which shares no device with the mount, so the arbiter alone
// would not tell); without one, no guiding moves the mount. A session belongs to the server: it survives tab reloads and workspace changes, and ends
// with the process; sessions live in memory, the latest of each camera. Angles are radians, durations seconds, and instants
// Unix milliseconds.
//
// A session may also ask for an orientation, the position angle of the image top. Verify Only measures it with any camera;
// Center turns the rotator of the Equipment Setup toward it inside the same loop, the operation holding the rotator with the
// mount, so the final frame proves both. The rotation sense the loop learns is kept in the operational database for the
// camera and the rotator (RotatorSenseStore) and read when a later session is admitted, whoever admits it; the rotator's
// angle is never synced. Rotator angles are mechanical degrees. A Center that verified an orientation also keeps the offset of
// the position angle for the rotator, modulo a half turn, so a later Center allowing the half turn turns the rotator while
// the mount slews (pre-rotation), and its first frame usually verifies both.

// What a session does:
// - center: slews to the target when the mount stands farther than a correction may go, then corrects until a solution
//   verifies it.
// - verifyOnly: measures the distance to a target; nothing commands the mount.
export type TargetCenteringMode = 'center' | 'verifyOnly'

// Fixed target of a session. J2000 means ICRS, and a time-dependent target has no place here.
export interface TargetCenteringTarget extends CenteringTarget {
	// Name meant for people.
	readonly label?: string
}

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type TargetCenteringCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/connections/:id/cameras/:deviceId/target-centering.
export interface TargetCenteringRequest extends CommandRequest {
	// Mount to center, by its exact connection and device ids.
	readonly mount: OperationDevice
	// Guide output that drives the mount (the GUIDE_OUTPUT of the Equipment Setup), whose guiding the session coordinates;
	// absent when the setup has none, and then no guiding moves the mount.
	readonly guideOutput?: OperationDevice
	// What to do.
	readonly mode: TargetCenteringMode
	// Target, copied whole, so nothing is read from a profile once the session runs.
	readonly target: TargetCenteringTarget
	// Camera settings of every frame.
	readonly capture: TargetCenteringCaptureSettings
	// Plate solver of every frame, resolved once when the session starts.
	readonly solving: PlateSolveRequest
	// Accepted great-circle distance between the solved center and the target, in radians; > 0.
	readonly tolerance: Angle
	// Corrections allowed, ≥ 0; ignored by verifyOnly, which makes none.
	readonly maximumCorrections: number
	// Exposures repeated at one position after a frame without a solution, ≥ 0, none of them moving the mount.
	readonly noSolutionRetries: number
	// Frames allowed, failed solves included, ≥ 1.
	readonly maximumFrames: number
	// Wait after each motion and before the next exposure, in seconds.
	readonly settleDelay: number
	// Largest correction a session makes by itself, in radians; a larger one ends it, and it is also how far a Center stands
	// from its target before it slews.
	readonly maximumCorrection: Angle
	// Whether a frame an assisted solve left without a solution is searched again over the whole sky, with the same solver settings.
	readonly blindRetry: boolean
	// What to do with guiding: stop it for the session and restore it after, or refuse to start while it may pulse the mount.
	// Verify Only never stops it, since it moves nothing.
	readonly guiding: 'coordinate' | 'requireIdle'
	// Orientation to reach (Center) or measure (Verify Only) besides the position: the position angle of the image top,
	// ICRS, from north through east, in radians, its tolerance in radians, and whether θ and θ + π frame the same field.
	// Absent centers the position only.
	readonly orientation?: CenteringOrientation
	// Rotator of the Equipment Setup that turns the camera, by its exact connection and device ids; needed by a Center with
	// an orientation, ignored by Verify Only, and refused without an orientation.
	readonly rotator?: OperationDevice
}

// What a session is doing:
// - preparing: the operation is taking the devices.
// - running: it is working, as step tells.
// - stopping: a stop was requested and the operation is ending.
// - blocked: the operation ended with the mount not confirmed stopped; its stop only dismisses it.
// - completed: it ended with a measurement of the final position; positionVerified tells whether it lies within tolerance.
// - failed: it ended without a position within tolerance, reason and error telling why.
// - cancelled: it was stopped, from here or by a stop of its devices.
export type TargetCenteringState = 'preparing' | 'running' | 'stopping' | 'blocked' | 'completed' | 'failed' | 'cancelled'

// Step of a running session.
export type TargetCenteringStep = 'stoppingGuiding' | 'slewing' | CenteringStep | 'restoringGuiding'

// What became of a frame: solved, a search that ended without a solution, a solution that could not be accepted, a solve that
// ran out of time, or a solver that failed.
export type TargetCenteringOutcome = 'solved' | 'noSolution' | 'invalid' | 'timeout' | 'failed'

// Why a session refused to move the mount, for a client to branch on:
// - correctionRefused: the model in force cannot speak for the target.
// - belowHorizon: the destination is below the horizon of the site the mount reports.
// - tooLarge: the correction is over the maximum.
// - pierSide: the mount changed pier side during the session.
// - parked: the mount was parked during the session.
// - unsupported: the mount cannot go to a target.
// - rotatorUnreachable: the orientation, and its half-turn twin when allowed, lies outside the limits of the rotator.
export type TargetCenteringRefusal = 'correctionRefused' | 'belowHorizon' | 'tooLarge' | 'pierSide' | 'parked' | 'unsupported' | 'rotatorUnreachable'

// Where the rotation sense of a session came from: the database, learned by this session where none was known, or learned
// again because the stored one was contradicted.
export type TargetCenteringSenseSource = 'stored' | 'learned' | 'relearned'

// What became of guiding: nothing to restore, or the outcome of restoring what the session stopped.
export type TargetCenteringGuidingRestoration = 'notNeeded' | GuidingRestoration

// One capture-and-solve iteration of a session.
export interface TargetCenteringAttempt {
	// Iteration, from 1.
	readonly attempt: number
	// Identity of the frame in the capture frame registry; absent until it was recorded.
	readonly frameId?: string
	// Document of the frame, open only while it is the latest of its camera or leased.
	readonly imageId?: string
	// Middle of the exposure, Unix milliseconds.
	readonly observedAt?: number
	// What became of the frame; absent until its solve ended.
	readonly outcome?: TargetCenteringOutcome
	// Why a frame has no solution, meant for people.
	readonly error?: string
	// Solved center, ICRS, in radians.
	readonly solved?: { readonly rightAscension: Angle; readonly declination: Angle }
	// Great-circle distance between the solved center and the target, in radians.
	readonly separation?: Angle
	// Eastward offset of the solved center from the target on the plane tangent at the target, in radians.
	readonly dx?: number
	// Northward offset of the solved center from the target on the plane tangent at the target, in radians.
	readonly dy?: number
	// Destination of the correction that followed, J2000, in radians.
	readonly correction?: { readonly rightAscension: Angle; readonly declination: Angle }
	// Mechanical angle of the rotator during the exposure, in degrees; absent without a rotator.
	readonly rotatorAngle?: number
	// Position angle of the image top at the target's pixel, ICRS, in radians; absent without an orientation.
	readonly positionAngle?: Angle
	// Requested minus measured position angle, in radians, wrapped as the orientation asks; absent without an orientation.
	readonly positionAngleError?: Angle
	// Rotation that followed, between mechanical angles in degrees.
	readonly rotation?: { readonly from: number; readonly to: number }
}

// Session record published to clients. It carries no WCS; the complete record does.
export interface TargetCenteringSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Mount being centered.
	readonly mount: OperationDevice
	// Name of the mount.
	readonly mountName: string
	// Request the session runs with.
	readonly request: Omit<TargetCenteringRequest, 'token'>
	// What the session is doing.
	readonly state: TargetCenteringState
	// Step while running.
	readonly step?: TargetCenteringStep
	// Iterations so far, latest last; at most the frames of the request.
	readonly attempts: readonly TargetCenteringAttempt[]
	// Pointing model that corrected the first slew, when one did.
	readonly model?: { readonly modelId: string; readonly revisionId: string }
	// Whether the session started, or began to start, the tracking of a mount that was not tracking; absent when it was
	// already on.
	readonly trackingStarted?: boolean
	// Whether the tracking the session started was stopped because the session did not succeed; absent otherwise.
	readonly trackingStopped?: boolean
	// Progress of the frame being exposed, as the driver reports it (times in microseconds, progress in percent).
	readonly exposure?: CameraCaptureTime
	// Whether a solution taken after the last motion lies within tolerance; only this proves a position.
	readonly positionVerified: boolean
	// Whether the same solution has the orientation within its tolerance; false without an orientation.
	readonly orientationVerified: boolean
	// Whether the session leaves everything ready to go on acquiring: a verified position, a verified orientation when one was
	// asked, and guiding as it found it.
	readonly readyForImaging: boolean
	// What became of guiding; notNeeded until a session stopped some.
	readonly guidingRestoration: TargetCenteringGuidingRestoration
	// Distance of the latest solution from the target, in radians; absent before one.
	readonly finalSeparation?: Angle
	// Requested minus measured position angle of the latest solution, in radians; absent without an orientation or before one.
	readonly finalPositionAngleError?: Angle
	// Name of the rotator the session turns; absent without one.
	readonly rotatorName?: string
	// Rotation made before the first frame from the stored sense and offset, between mechanical angles in degrees; absent
	// without one.
	readonly preRotation?: { readonly from: number; readonly to: number }
	// Rotation sense in force, and where it came from; absent while none is known.
	readonly sense?: 1 | -1
	readonly senseSource?: TargetCenteringSenseSource
	// Problems meant for people, latest last.
	readonly warnings: readonly string[]
	// Why a motion was refused.
	readonly refusal?: TargetCenteringRefusal
	// Why the session did not complete.
	readonly reason?: OperationFailureReason
	// Detail of the failure meant for people.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC); absent while it runs or stays blocked.
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Complete record of GET /api/target-centering/:sessionId.
export interface TargetCenteringSession extends TargetCenteringSessionSummary {
	// Solution of each solved attempt, by attempt.
	readonly solutions: Readonly<Record<number, PlateSolution>>
}

// Snapshot of GET /api/target-centering: the latest session of every camera.
export interface TargetCenteringSnapshot {
	readonly sessions: readonly TargetCenteringSessionSummary[]
}

// Response of an accepted start.
export interface TargetCenteringStartResponse {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
}

// Notification published whenever a session changes.
export type TargetCenteringEvent = { readonly type: 'targetCentering:updated'; readonly session: TargetCenteringSessionSummary }

// Receiver of session events.
export type TargetCenteringListener = (event: TargetCenteringEvent) => void

// Longest wait for the first slew, in milliseconds. A driver that never reports the slew fails here instead of at the
// commander's default of 10 minutes.
const SLEW_TIMEOUT = 300000

// Longest wait for a correction, in milliseconds; provisional. The commander ends a slew only after seeing it, and a motion
// of arcseconds might never show, so this one must not hold the session for minutes.
const CORRECTION_TIMEOUT = 60000

// Longest wait for one solve, queue included, in seconds; the solver's own timeout normally ends it first.
const SOLVE_TIMEOUT = 600

// Watchdog after an aborted solve before it is reported unresponsive, in seconds.
const SOLVE_ABORT_GRACE = 10

// Corrections in a row that did not get closer before a session gives up, instead of spending its frames; provisional.
const STALL_LIMIT = 2

// Warnings kept per session.
const MAXIMUM_WARNINGS = 20

// What the last frame of a session verified, a frame taken after the last motion: the position, and the orientation when one
// was asked (false otherwise).
interface TargetCenteringVerification {
	readonly position: boolean
	readonly orientation: boolean
}

// Nothing verified.
const NOTHING_VERIFIED: TargetCenteringVerification = { position: false, orientation: false }

// Outcome of a motion a session does not make.
const NOTHING_DONE: OperationResult<void> = successfulOperationResult(undefined)

// Bounds of plannedRotation's probe, never used by a pre-rotation, which always has a sense: its defaults, in degrees.
const PRE_ROTATION_PROBE = { minimum: 2, maximum: 10 } as const

// Smallest orientation tolerance a Center turning a rotator accepts, in degrees: about the precision of the position
// angle of a plate solution of few stars.
const MINIMUM_ORIENTATION_TOLERANCE = 0.05

// Margin added to half a step of the rotator for the smallest orientation tolerance it can hold, in degrees.
const ROTATOR_STEP_MARGIN = 0.01

// Returns what the measurement of an attempt verifies against the tolerances of a request.
function verificationOf({ tolerance, orientation }: Pick<TargetCenteringRequest, 'tolerance' | 'orientation'>, { separation, positionAngleError }: Pick<TargetCenteringAttempt, 'separation' | 'positionAngleError'>): TargetCenteringVerification {
	return { position: separation !== undefined && separation <= tolerance, orientation: orientation !== undefined && positionAngleError !== undefined && Math.abs(positionAngleError) <= orientation.tolerance }
}

// A session while its service knows it.
interface Session {
	summary: TargetCenteringSessionSummary
	// Camera of the session.
	readonly camera: Camera
	// Mount of the session.
	readonly mount: Mount
	// Rotator the session turns; absent without one.
	readonly rotator?: Rotator
	// Rotation sense the database held for the camera and the rotator when the session was admitted.
	readonly storedSense?: StoredRotatorSense
	// Provider settings resolved when the session started.
	readonly preparation: PlateSolvePreparation
	// Site the mount reported when the session started, whose horizon every motion is checked against.
	readonly observer: SkyObserver
	// Solution of each solved attempt.
	readonly solutions: Map<number, PlateSolution>
	// Whether the session sent the mount to its target, which then makes the target a better hint than the header.
	commanded: boolean
	// Pier side the mount stood on when the session stopped slewing; NEITHER says nothing.
	pierSide: PierSide
	// Keeps guiding from starting while the mount is the session's.
	guidingHold?: Disposable
	// Sessions of guiding to stop before taking the mount.
	readonly guidingRuns: readonly string[]
	// Guiding the session stopped, to restore.
	readonly suspensions: GuidingSuspension[]
	// Ends the restoration of guiding when the session is stopped during it.
	restoring?: AbortController
	// What the operator asked for the operation being cancelled.
	intent?: 'stop'
	// Operation holding the devices, while one runs.
	handle?: OperationHandle<TargetCenteringVerification>
	// Reservation the session runs inside, when a caller composing tools admitted it.
	readonly invocation?: ToolInvocation
	// Resolved with the final summary once the session ended.
	readonly ended: PromiseWithResolvers<TargetCenteringSessionSummary>
	// Resolved with the summary once the session ended or was blocked, whichever comes first.
	readonly settled: PromiseWithResolvers<TargetCenteringSessionSummary>
}

// Session admitted inside the process: its identity and its end.
export interface TargetCenteringAdmitted {
	readonly ok: true
	// Id of the session, repeated by its targetCentering:updated events.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
	// Whether the token had already started the session, which this request did not start again.
	readonly repeated: boolean
	// Final summary once the session ended, after guiding was restored: completed (positionVerified and readyForImaging say
	// what it reached), failed, or cancelled. A blocked session ends only once it is dismissed. Never rejects.
	readonly ended: Promise<TargetCenteringSessionSummary>
	// Summary once the session ended, as ended, or was blocked, its mount not confirmed stopped: a caller composing tools waits
	// on it, since a blocked session ends only once the operator dismissed it. Never rejects.
	readonly settled: Promise<TargetCenteringSessionSummary>
}

// Outcome of asking for a session inside the process: the session admitted, or why it was refused (guidingActive when
// guiding corrects the mount and the request does not coordinate with it).
export type TargetCenteringAdmission = TargetCenteringAdmitted | CommandRefusal<CommandErrorCode | 'guidingActive'>

// Guiding, as far as a session depends on it.
export type TargetCenteringGuiding = Pick<GuidingSessions, 'runsOn' | 'hold' | 'suspendForMotion' | 'restoreAfterMotion'>

// Returns the site a mount reports, as an observer: degrees, longitude east positive, and meters.
function observerOf({ geographicCoordinate: { latitude, longitude, elevation } }: Mount): SkyObserver {
	return { latitude: toDeg(latitude), longitude: toDeg(longitude), elevation: toMeter(elevation) }
}

// Reason a connected mount cannot serve a mode, or undefined when it can. Verify Only commands nothing, so it needs nothing.
function mountRefusal(mount: Mount, mode: TargetCenteringMode) {
	if (mode === 'verifyOnly') return undefined
	if (!mount.canGoTo) return `${mount.name} cannot go to a target`
	if (!mount.canAbort) return `${mount.name} cannot abort a motion`
	const { latitude, longitude } = mount.geographicCoordinate
	if (latitude === 0 && longitude === 0) return `${mount.name} reports no site`
	if (mount.parked || mount.parking) return `${mount.name} is parked`
	if (!mount.tracking && !mount.canTracking) return `${mount.name} is not tracking and cannot start tracking`
	return undefined
}

// Returns the coordinate of a J2000 position as a mount target.
function j2000Target(rightAscension: Angle, declination: Angle): MountTargetCoordinate<number> {
	return { type: 'J2000', J2000: { x: rightAscension, y: declination } }
}

// Returns a refusal of the mount commands as one of a session.
function refusalOf(code: CommandErrorCode): TargetCenteringRefusal {
	if (code === 'correctionRefused') return 'correctionRefused'
	return code === 'invalidParameter' ? 'belowHorizon' : 'unsupported'
}

// Returns what a thrown solve says about its frame.
function outcomeOf(error: unknown): TargetCenteringOutcome {
	if (!(error instanceof PlateSolvingError)) return 'failed'
	if (error.code === 'invalidSolution') return 'invalid'
	return error.code === 'timeout' ? 'timeout' : 'failed'
}

// Returns warnings with one more, keeping the latest ones.
function appendWarning(warnings: readonly string[], warning: string) {
	return [...warnings, warning].slice(-MAXIMUM_WARNINGS)
}

// Target Centering sessions of the cameras of the open connections.
export class TargetCenteringSessions {
	// Latest session of each camera, and the session each start token started.
	readonly #sessions: CameraSessionRegistry<TargetCenteringSessionSummary, Session>

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every session,
	// mounts sends the first slew and judges each motion, commander runs the corrections and the tracking (the one of the mount
	// commands), capturer takes the frames (the one of the capture service), images receives the frames, frames records them as
	// the latest frame of their camera and closes them, plateSolving solves them, guiding tells whether the mount is being
	// guided, and listener receives every session change synchronously. auxiliaryDir is the parent of the temporary directory
	// of each session. rotatorCommander turns the rotators (the one of the rotator commands), without which no orientation is
	// centered, and senses keeps the rotation senses the sessions learn, without which every session probes again.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly mounts: Pick<MountCommands, 'goToWithin' | 'refusal'>,
		readonly commander: MountCommander,
		readonly capturer: CameraCapturer,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly plateSolving: Pick<PlateSolvingService, 'prepare' | 'solve'>,
		readonly guiding: TargetCenteringGuiding,
		readonly listener: TargetCenteringListener,
		readonly auxiliaryDir: string = tmpdir(),
		readonly rotatorCommander?: RotatorCommander,
		readonly senses?: RotatorSenseStore,
	) {
		this.#sessions = new CameraSessionRegistry(operations, (session) => listener({ type: 'targetCentering:updated', session }))
	}

	// Returns the latest session of every camera.
	snapshot(): TargetCenteringSnapshot {
		return { sessions: this.#sessions.summaries() }
	}

	// Returns the solution of each solved attempt of a session, by attempt, for a caller inside the process that compares
	// them, such as the Meridian Flip Executor; undefined when the session is not the latest of its camera.
	solutionsOf(sessionId: string): ReadonlyMap<number, PlateSolution> | undefined {
		return this.#sessions.find(sessionId)?.solutions
	}

	// Responds with the complete record of a session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json({ ...session.summary, solutions: Object.fromEntries(session.solutions) } satisfies TargetCenteringSession) : notFound('Session')
	}

	// Starts a session. Responds 202 with TargetCenteringStartResponse once accepted (a repeated token answers its first
	// session); its progress and outcome arrive as targetCentering:updated and operation:updated events. Responds 404 for an
	// unknown camera or mount; 409 when either device is disconnected or held, the camera has a session that did not end, or
	// guiding may pulse the mount; and 422 when the mount cannot serve the mode or the
	// target is below the horizon of the site the mount reports.
	async start(connectionId: string, deviceId: string, request: TargetCenteringRequest): Promise<Response> {
		const admitted = await this.admit(connectionId, deviceId, request)
		return admitted.ok ? Response.json({ sessionId: admitted.sessionId, operationId: admitted.operationId } satisfies TargetCenteringStartResponse, { status: 202 }) : refusalResponse(admitted)
	}

	// Admits a session, under the reservation of invocation when given (which must then hold the camera and the mount), and
	// returns its identity and end, or why it was refused, as start answers it. A repeated token answers the session it
	// started, while it is remembered. The session stops and restores the guiding of the mount itself, as from a tab.
	async admit(connectionId: string, deviceId: string, request: TargetCenteringRequest, invocation?: ToolInvocation): Promise<TargetCenteringAdmission> {
		const repeated = this.#sessions.repeated(request.token)
		if (repeated) return admitted(repeated, true)

		// The settings of the solver are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.plateSolving.prepare(request.solving)

		const raced = this.#sessions.repeated(request.token)
		if (raced) return admitted(raced, true)

		const resolvedCamera = resolveConnected(this, connectionId, 'camera', deviceId, 'Camera')
		if (!resolvedCamera.ok) return resolvedCamera
		const resolvedMount = resolveConnected(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (!resolvedMount.ok) return resolvedMount
		const camera = resolvedCamera.device
		const mount = resolvedMount.device

		const { mode, target } = request
		const refused = mountRefusal(mount, mode)
		if (refused) return refusal(refused, 422, 'unsupported')

		const rotated = this.#rotatorOf(request, mount)
		if (rotated !== undefined && !('name' in rotated)) return rotated
		const rotator = rotated

		const observer = observerOf(mount)

		if (mode !== 'verifyOnly') {
			const below = this.mounts.refusal(mount, j2000Target(target.rightAscension, target.declination), observer)
			if (below) return refusal(...below)
		}

		// A run stopped by the session frees the mount, so a mount held by guiding alone is free enough here; anything else that
		// took it meanwhile fails the session, which restores guiding all the same.
		const runs = request.guideOutput ? this.guiding.runsOn(request.guideOutput) : []
		const stoppable = mode !== 'verifyOnly' && request.guiding === 'coordinate' && runs.every(({ state }) => state === 'guiding' || state === 'lostLock')
		if (runs.length > 0 && !stoppable) return refusal(mode === 'verifyOnly' ? 'Guiding is correcting the mount; stop it before measuring' : 'Guiding is correcting the mount, or is paused or calibrating; stop it before centering', 409, 'guidingActive')
		// A mount guiding holds is taken once the session stopped guiding; inside a reservation, it must still be reserved by it.
		const mountFree = runs.length === 0 ? this.operations.admits(mount, invocation) : !invocation || this.operations.reserves(mount, invocation)
		if (!this.operations.admits(camera, invocation) || !mountFree || (rotator && !this.operations.admits(rotator, invocation))) return refusal('The device is busy', 409, 'busy')

		const key = resourceKey(camera)
		const previous = this.#sessions.of(key)
		if (previous && previous.summary.endedAt === undefined) return refusal('The camera has a centering session that did not end', 409, 'busy')

		const { token, ...settings } = request
		const storedSense = rotator && this.#storedSense(camera, rotator)
		const session: Session = {
			summary: {
				sessionId: Bun.randomUUIDv7(),
				operationId: '',
				camera: { connectionId, deviceId },
				cameraName: camera.name,
				mount: request.mount,
				mountName: mount.name,
				request: settings,
				state: 'preparing',
				attempts: [],
				positionVerified: false,
				orientationVerified: false,
				readyForImaging: false,
				...(rotator && { rotatorName: rotator.name }),
				...(storedSense && { sense: storedSense.sense, senseSource: 'stored' as const }),
				guidingRestoration: 'notNeeded',
				warnings: mode === 'verifyOnly' && !mount.tracking ? [`${mount.name} is not tracking, so the frames may trail.`] : [],
				startedAt: Date.now(),
				revision: 0,
			},
			camera,
			mount,
			...(rotator && { rotator }),
			...(storedSense && { storedSense }),
			preparation,
			observer,
			solutions: new Map(),
			commanded: false,
			pierSide: mount.pierSide,
			guidingHold: request.guideOutput && this.guiding.hold(request.guideOutput, 'Target Centering'),
			guidingRuns: runs.map(({ sessionId }) => sessionId),
			suspensions: [],
			invocation,
			ended: Promise.withResolvers(),
			settled: Promise.withResolvers(),
		}

		const record = this.operations.run('mount.targetCentering', request.rotator && rotator ? [session.summary.camera, session.summary.mount, request.rotator] : [session.summary.camera, session.summary.mount], token, () => {
			const handle = this.#run(session)
			session.handle = handle
			return handle.result
		})

		this.#sessions.adopt(key, session, record.operationId)
		void settledResult(session.handle!.result).then((result) => this.#operationEnded(session, result))
		return admitted(session, false)
	}

	// Returns the rotator a request turns, undefined when it turns none, or why it is refused: a rotator without an
	// orientation, a Center with an orientation and no rotator, a rotator unknown, disconnected or moving, an alt-az mount
	// (whose field turns continuously), an orientation tolerance below what the rotator resolves (max(0.05°, half its step
	// plus 0.01°)), or no commander to turn it. Verify Only turns nothing and needs none.
	#rotatorOf({ mode, orientation, rotator: device }: TargetCenteringRequest, mount: Mount): Rotator | CommandRefusal | undefined {
		if (device && !orientation) return refusal('A rotator turns the camera only toward a requested orientation', 422, 'unsupported')
		if (!orientation || mode === 'verifyOnly') return undefined
		if (!device) return refusal('Centering an orientation needs the rotator of the Equipment Setup; Verify Only measures it without one', 422, 'unsupported')
		const resolved = resolveConnected(this, device.connectionId, 'rotator', device.deviceId, 'Rotator')
		if (!resolved.ok) return resolved
		const rotator = resolved.device
		if (rotator.moving) return refusal(`${rotator.name} is moving`, 409, 'busy')
		if (mount.mountType === 'ALTAZ') return refusal(`${mount.name} is an alt-az mount, whose field turns all the time; a rotator cannot hold an orientation on it`, 422, 'unsupported')
		const resolution = Math.max(MINIMUM_ORIENTATION_TOLERANCE, (rotator.angle.step > 0 ? rotator.angle.step / 2 : 0) + ROTATOR_STEP_MARGIN)
		if (!(toDeg(orientation.tolerance) >= resolution)) return refusal(`The orientation tolerance is below what ${rotator.name} can resolve, ${resolution.toFixed(2)}°`, 422, 'invalidParameter')
		if (!this.rotatorCommander) return refusal('No rotator can be turned here', 422, 'unsupported')
		return rotator
	}

	// Returns the rotation sense stored for a camera and a rotator; undefined when none is, or the database cannot be read.
	#storedSense(camera: Camera, rotator: Rotator) {
		try {
			return this.senses?.get('positionAngle', camera, rotator)
		} catch (error) {
			console.error('the rotation sense could not be read:', error)
			return undefined
		}
	}

	// Stops a session. Answers at once, because a camera may stay held for minutes while its frame arrives; the end arrives as an
	// event. A blocked session is dismissed. Responds 202, also when it already ended, and 404 for an unknown session.
	stop(sessionId: string): Response {
		return this.interrupt(sessionId) ? new Response(null, { status: 202 }) : notFound('Session')
	}

	// Stops a session as the stop route does, without waiting for its end, which ended resolves. Returns whether the session
	// is known, the latest of its camera, whether or not it still ran.
	interrupt(sessionId: string): boolean {
		const session = this.#sessions.find(sessionId)
		if (!session) return false

		if (session.summary.state === 'blocked') this.#finish(session, 'cancelled', NOTHING_VERIFIED)
		else if (session.summary.endedAt === undefined) {
			session.intent = 'stop'
			this.#sessions.update(session, { state: 'stopping', step: undefined, exposure: undefined })
			void session.handle?.cancel('aborted')
			session.restoring?.abort()
		}

		return true
	}

	// Runs a session: the root holds the camera and stops guiding, and its child then holds the mount, and the rotator when it
	// turns one, for all the work. Resolves what was verified; a Verify Only that measured out of tolerance succeeds with it.
	#run(session: Session): OperationHandle<TargetCenteringVerification> {
		const { camera, mount, rotator } = session
		const motion = rotator ? [mount, rotator] : [mount]

		return this.operations.scope(session.invocation).start<TargetCenteringVerification>('targetCenteringSession', [{ key: resourceKey(camera), device: camera }], async (root) => {
			const stopped = await this.#stopGuiding(session)
			if (!stopped.ok) return stopped
			return await root.start<TargetCenteringVerification>(
				'targetCenteringMotion',
				motion.map((device) => ({ key: resourceKey(device), device })),
				(context) => this.#work(session, context),
			).result
		})
	}

	// Stops the guiding the session found, keeping what it stopped so it is restored whatever comes next.
	async #stopGuiding(session: Session): Promise<OperationResult<void>> {
		for (const sessionId of session.guidingRuns) {
			this.#sessions.update(session, { state: 'running', step: 'stoppingGuiding' })
			const stopped = await this.guiding.suspendForMotion(sessionId)
			if (!stopped.ok) return stopped
			session.suspensions.push(stopped.value)
		}

		return successfulOperationResult(undefined)
	}

	// Restores the guiding a session stopped, once the mount was released, and resolves the worst of what became of it.
	async #restoreGuiding(session: Session) {
		if (session.suspensions.length === 0) return

		const restoring = new AbortController()
		session.restoring = restoring
		this.#sessions.update(session, { state: session.intent === 'stop' ? 'stopping' : 'running', step: 'restoringGuiding', exposure: undefined })

		const outcomes: GuidingRestoration[] = []
		for (const suspension of session.suspensions) outcomes.push(await this.guiding.restoreAfterMotion(suspension, restoring.signal))

		session.restoring = undefined
		const guidingRestoration = outcomes.find((outcome) => outcome === 'failed') ?? outcomes.find((outcome) => outcome === 'externallyChanged') ?? 'restored'
		this.#sessions.update(session, { guidingRestoration })
		if (guidingRestoration === 'failed') this.#warn(session, 'Guiding could not be restored; start it again in Images → Guiding.')
		else if (guidingRestoration === 'externallyChanged') this.#warn(session, 'Guiding was changed during the session, so it was left as it is.')
	}

	// Does the work of a session holding both devices, in a temporary directory removed at the end.
	async #work(session: Session, context: OperationContext): Promise<OperationResult<TargetCenteringVerification>> {
		const { mount, camera } = session
		const { mode, target } = session.summary.request
		const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-centering-'))

		try {
			if (mode !== 'verifyOnly' && !mount.tracking) {
				// Recorded before the command: a start stopped or timed out halfway may have left the mount tracking.
				this.#sessions.update(session, { trackingStarted: true })
				const started = await this.commander.setTracking(context, mount, true)
				if (!started.ok) return started
			}

			// The rotator turns while the mount slews; both end before the first exposure, the first failure ending the session.
			const preRotation = this.#preRotation(session)
			const slews = this.#slews(session)
			if (preRotation) this.#sessions.update(session, { state: 'running', step: slews ? 'slewing' : 'rotating', preRotation })
			const [slewed, turned] = await Promise.all([slews ? this.#slew(session, context) : NOTHING_DONE, preRotation ? this.rotatorCommander!.moveTo(context, session.rotator!, preRotation.to) : NOTHING_DONE])
			if (!slewed.ok) return slewed
			if (!turned.ok) return turned

			const services: CenteringServices = {
				mountCommander: this.commander,
				...(session.rotator && this.rotatorCommander && { rotatorCommander: this.rotatorCommander }),
				cameraCapturer: this.capturer,
				solver: (frame: CenteringFrame, signal: AbortSignal) => this.#solve(session, frame, signal),
				auxiliaryPath: (attempt: number) => join(directory, `centering-${attempt}.fit`),
				clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay },
				observer: this.#observer(session),
			}
			const centered = await centerTarget(context, mount, camera, target, this.#options(session), services)

			if (centered.ok) {
				if (session.summary.request.orientation) this.#keepOffset(session)
				return successfulOperationResult({ position: true, orientation: session.summary.request.orientation !== undefined })
			}

			// A solve that ran out of time ends the loop before its measurement.
			if (centered.reason === 'timeout') this.#updateAttempt(session, session.summary.attempts.length, { outcome: 'timeout', error: centered.error })

			// Out of tolerance is what a measurement may find, not a failure of it; nothing moved since it was taken.
			const last = session.summary.attempts.at(-1)
			if (mode === 'verifyOnly' && centered.reason === 'unexpectedState' && last?.separation !== undefined) return successfulOperationResult(verificationOf(session.summary.request, last))

			return centered
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	// Returns the rotation a Center makes before its first frame, or undefined when it makes none: only with an orientation
	// that allows the half turn (the offset of the pier side after the slew is not known, and a half turn is what tells the
	// sides apart), a rotator, a stored sense and offset, and a predicted error over the tolerance that a reachable angle
	// corrects (plannedRotation). The position angle now is predicted as sense times the mechanical angle plus the offset.
	#preRotation({ summary: { request }, rotator, storedSense }: Session): { readonly from: number; readonly to: number } | undefined {
		const { orientation, mode } = request
		if (mode !== 'center' || !orientation?.halfTurn || !rotator || !this.rotatorCommander || storedSense?.offset === undefined) return undefined
		const from = rotator.angle.value
		const predicted = deg(storedSense.sense * from + storedSense.offset)
		const error = positionAngleError(orientation.positionAngle, predicted, true)
		if (!(Math.abs(error) > orientation.tolerance)) return undefined
		const to = plannedRotation(rotator, from, toDeg(error), true, storedSense.sense, PRE_ROTATION_PROBE)
		return to === undefined ? undefined : { from, to }
	}

	// Keeps the offset of the position angle a verified Center measured on its last frame, PA minus sense times the mechanical
	// angle, for the next pre-rotation; a database that cannot be written leaves a warning.
	#keepOffset(session: Session) {
		const { camera, rotator, summary } = session
		const last = summary.attempts.at(-1)
		if (!rotator || !this.senses || summary.sense === undefined || last?.positionAngle === undefined || last.rotatorAngle === undefined) return

		try {
			this.senses.offsetMeasured(camera, rotator, toDeg(last.positionAngle) - summary.sense * last.rotatorAngle, Date.now())
		} catch (error) {
			this.#warn(session, `The orientation offset of ${rotator.name} was not saved, so the next session does not turn it during the slew: ${Error.isError(error) ? error.message : String(error)}`)
		}
	}

	// Returns whether a session starts with a slew. A Center skips it when the mount says it stands within what a correction
	// may reach; what it says is only a reason not to slew, since the position is measured next.
	#slews({ mount, summary: { request } }: Session) {
		if (request.mode === 'verifyOnly') return false
		if (!mount.hasEquatorialCoordinate) return true

		const { rightAscension, declination } = mount.equatorialCoordinate
		const [reportedRightAscension, reportedDeclination] = equatorialToJ2000(rightAscension, declination, timeUnix(Date.now() / 1000))
		return angularDistance(reportedRightAscension, reportedDeclination, request.target.rightAscension, request.target.declination) > request.maximumCorrection
	}

	// Sends the mount to the target of a session and waits for it to settle. Resolves failed for a refusal, which moved nothing.
	async #slew(session: Session, context: OperationContext): Promise<OperationResult<void>> {
		const { mount, observer } = session
		const { rightAscension, declination } = session.summary.request.target

		this.#sessions.update(session, { state: 'running', step: 'slewing' })

		const sent = await this.mounts.goToWithin(context, mount, j2000Target(rightAscension, declination), observer, { timeout: SLEW_TIMEOUT })

		if (sent.status === 'refused') {
			this.#sessions.update(session, { refusal: refusalOf(sent.code) })
			return failedOperationResult('commandFailed', sent.error)
		}

		if (sent.correction) this.#sessions.update(session, { model: sent.correction })
		if (!sent.result.ok) return sent.result

		session.commanded = true
		session.pierSide = mount.pierSide
		this.#sessions.update(session, { step: 'settling' })
		return await abortableDelay(session.summary.request.settleDelay * 1000, context.signal)
	}

	// Returns the options of the toolkit's loop for a session. The corrections go to a position measured from the sky, so a model
	// in force is out of their way.
	#options({ summary: { request }, rotator, storedSense }: Session): CenteringOptions {
		const { tolerance, mode, maximumCorrections, noSolutionRetries, maximumFrames, settleDelay, capture } = request

		return {
			tolerance,
			maximumAttempts: maximumFrames,
			maximumCorrections: mode === 'verifyOnly' ? 0 : maximumCorrections,
			maximumUnsolved: noSolutionRetries + 1,
			stallLimit: STALL_LIMIT,
			settle: settleDelay,
			syncMount: false,
			capture: { ...capture, exposureTimeUnit: 'second', frameType: 'LIGHT', compressed: false },
			solveTimeout: SOLVE_TIMEOUT,
			abortGrace: SOLVE_ABORT_GRACE,
			slew: { timeout: CORRECTION_TIMEOUT },
			...(request.orientation && { orientation: request.orientation }),
			...(rotator && { rotation: { rotator, ...(storedSense && { sense: { value: storedSense.sense, ...(storedSense.parity && { parity: storedSense.parity }) } }) } }),
		}
	}

	// Returns the observer of a session's loop.
	#observer(session: Session): CenteringObserver {
		return {
			step: (step, attempt) => {
				if (step === 'exposing') this.#sessions.update(session, { state: 'running', step, attempts: [...session.summary.attempts, { attempt }] })
				else this.#sessions.update(session, { step, exposure: undefined })
			},
			measured: (measurement) => this.#measured(session, measurement),
			captureListener: exposureProgressListener((exposure) => this.#sessions.update(session, { exposure })),
			beforeCorrection: (correction) => this.#beforeCorrection(session, correction),
			rotationChecked: (check) => this.#rotationChecked(session, check),
			rotationUnreachable: () => this.#sessions.update(session, { refusal: 'rotatorUnreachable' }),
		}
	}

	// Keeps the sense a response check found: saved when learned, its use recorded when confirmed. A database that cannot be
	// written leaves a warning; the session goes on with the sense it learned.
	#rotationChecked(session: Session, { sense, parity, gain, source }: CenteringRotationCheck) {
		const { camera, rotator } = session
		if (source !== 'confirmed') this.#sessions.update(session, { sense, senseSource: source })
		if (!rotator || !this.senses) return

		try {
			if (source === 'confirmed') this.senses.confirmed('positionAngle', camera, rotator, Date.now())
			else this.senses.learned('positionAngle', camera, rotator, sense, parity, gain, Date.now())
		} catch (error) {
			if (source !== 'confirmed') this.#warn(session, `The rotation sense of ${rotator.name} was not saved, so the next session probes it again: ${Error.isError(error) ? error.message : String(error)}`)
		}
	}

	// Records what a frame measured.
	#measured(session: Session, { attempt, solution, separation, dx, dy, rotatorAngle, positionAngle, positionAngleError }: CenteringMeasurement) {
		if (!solution) {
			const known = session.summary.attempts.find((each) => each.attempt === attempt)
			if (known?.outcome === undefined) this.#updateAttempt(session, attempt, { outcome: 'noSolution', ...(rotatorAngle !== undefined && { rotatorAngle }) })
			return
		}

		session.solutions.set(attempt, solution)
		const orientation = positionAngle !== undefined && positionAngleError !== undefined && { positionAngle, positionAngleError }
		this.#updateAttempt(session, attempt, { outcome: 'solved', solved: { rightAscension: solution.rightAscension, declination: solution.declination }, separation, dx, dy, ...(rotatorAngle !== undefined && { rotatorAngle }), ...orientation })
		this.#sessions.update(session, { finalSeparation: separation, ...(positionAngleError !== undefined && { finalPositionAngleError: positionAngleError }) })
	}

	// Decides whether a correction may go, and records it when it does. Returns why it may not.
	#beforeCorrection(session: Session, { attempt, separation, mount: destination, rotator: rotation }: CenteringCorrection) {
		const { mount, observer } = session
		const { maximumCorrection } = session.summary.request

		const refuse = (refusal: TargetCenteringRefusal, error: string) => {
			this.#sessions.update(session, { refusal })
			return error
		}

		if (mount.parked || mount.parking) return refuse('parked', `${mount.name} was parked`)
		if (mount.pierSide !== session.pierSide && mount.pierSide !== 'NEITHER' && session.pierSide !== 'NEITHER') return refuse('pierSide', `${mount.name} changed pier side during the session`)

		if (destination) {
			if (separation > maximumCorrection) return refuse('tooLarge', `The correction of ${(toArcsec(separation) / 60).toFixed(1)}′ is over the maximum of ${(toArcsec(maximumCorrection) / 60).toFixed(1)}′; center again to slew there`)
			const refused = this.mounts.refusal(mount, j2000Target(destination.rightAscension, destination.declination), observer)
			if (refused) return refuse(refusalOf(refused[2]), refused[0])
		}

		this.#updateAttempt(session, attempt, { ...(destination && { correction: { rightAscension: destination.rightAscension, declination: destination.declination } }), ...(rotation && { rotation: { from: rotation.from, to: rotation.to } }) })
		return undefined
	}

	// Decodes a frame into the image store, records it as the latest frame of the camera, and solves it. Resolves the solution, or
	// undefined when the search found none; a failure other than a cancellation rejects, which counts the frame as unsolved.
	async #solve(session: Session, { path, observedAt }: CenteringFrame, signal: AbortSignal): Promise<PlateSolution | undefined> {
		const { camera, cameraName, sessionId, request } = session.summary
		const attempt = session.summary.attempts.length

		try {
			const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
			const frameId = captureFrameId(sessionId, attempt)
			const info = await this.images.openCapture(bytes, basename(path), { ...camera, frameId, time: observedAt })
			const { width, height, channels, cfa, acquisition } = info
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const record: CaptureFrame = { imageId: info.id, sessionId, ...camera, generation: attempt, time: observedAt, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
			this.frames.previewed(info, record, cameraName, 'targetCentering')
			this.#updateAttempt(session, attempt, { frameId, imageId: info.id, observedAt })

			// The frame may have taken long enough to decode for the session to be cancelled meanwhile.
			signal.throwIfAborted()

			const preparation = this.#hinted(session)
			const origin = { kind: 'targetCentering', sessionId, ...camera, frameId } as const
			const result = await this.plateSolving.solve(info.id, preparation, signal, origin)
			if (result.solution || !request.blindRetry || request.solving.strategy !== 'assisted') return result.solution

			signal.throwIfAborted()

			const blind = { ...session.preparation, request: { ...session.preparation.request, strategy: 'blind' as const } }
			return (await this.plateSolving.solve(info.id, blind, signal, origin)).solution
		} catch (error) {
			if (!signal.aborted) {
				const message = Error.isError(error) ? error.message : String(error)
				this.#updateAttempt(session, attempt, { outcome: outcomeOf(error), error: message })
				this.#warn(session, `Frame ${attempt} could not be solved: ${message}`)
			}

			throw error
		}
	}

	// Returns the solver settings of a frame: an assisted search around the target once the mount was sent there; before that the
	// header of the frame hints it, because the position of a mount is never a hint.
	#hinted({ commanded, preparation, summary: { request } }: Session): PlateSolvePreparation {
		if (!commanded || request.solving.strategy !== 'assisted') return preparation
		const { rightAscension, declination } = request.target
		return { ...preparation, request: { ...preparation.request, hints: { ...preparation.request.hints, rightAscension, declination } } }
	}

	// Ends a session once its operation ended. The tracking a session started stays on only for a position it reached, and a mount
	// that cannot be confirmed stopped keeps the session blocked.
	async #operationEnded(session: Session, result: OperationResult<TargetCenteringVerification>) {
		const { mount } = session
		session.handle = undefined
		session.guidingHold?.[Symbol.dispose]()
		session.guidingHold = undefined

		if (!result.ok && mount.connected && !isDeviceQuiescent(mount)) {
			const guidingRestoration = session.suspensions.length > 0 ? 'failed' : 'notNeeded'
			this.#sessions.update(session, { state: 'blocked', step: undefined, exposure: undefined, guidingRestoration, reason: result.reason, error: `${mount.name} could not be confirmed stopped` })
			session.settled.resolve(session.summary)
			return
		}

		await this.#restoreGuiding(session)

		if (result.ok) return this.#finish(session, 'completed', result.value)

		const failure = { reason: result.reason, ...(result.error !== undefined && { error: result.error }) }

		if (session.summary.trackingStarted) {
			const stopped = !mount.tracking || (mount.connected && this.operations.admits(mount, session.invocation) && (await this.commander.setTracking(this.operations.scope(session.invocation), mount, false)).ok)
			if (stopped) this.#sessions.update(session, { trackingStopped: true })
			else this.#warn(session, `The tracking of ${mount.name} that the session started was left on.`)
		}

		return this.#finish(session, session.intent === 'stop' || result.reason === 'aborted' ? 'cancelled' : 'failed', NOTHING_VERIFIED, failure)
	}

	// Ends a session in a state, with what its last frame verified.
	#finish(session: Session, state: Extract<TargetCenteringState, 'completed' | 'failed' | 'cancelled'>, verified: TargetCenteringVerification, failure?: Pick<TargetCenteringSessionSummary, 'reason' | 'error'>) {
		const { guidingRestoration, request } = session.summary
		const readyForImaging = verified.position && (request.orientation === undefined || verified.orientation) && (guidingRestoration === 'notNeeded' || guidingRestoration === 'restored')
		this.#sessions.update(session, { state, step: undefined, exposure: undefined, positionVerified: verified.position, orientationVerified: verified.orientation, readyForImaging, endedAt: Date.now(), ...failure })
		session.ended.resolve(session.summary)
		session.settled.resolve(session.summary)
	}

	// Records a warning of a session.
	#warn(session: Session, warning: string) {
		this.#sessions.update(session, { warnings: appendWarning(session.summary.warnings, warning) })
	}

	// Replaces fields of one attempt of a session.
	#updateAttempt(session: Session, attempt: number, patch: Partial<TargetCenteringAttempt>) {
		this.#sessions.update(session, { attempts: session.summary.attempts.map((each) => (each.attempt === attempt ? { ...each, ...patch } : each)) })
	}
}

// Returns the admission of a session: its ids, whether a repeated token answered it, its end, and its end or block.
function admitted({ summary: { sessionId, operationId }, ended, settled }: Session, repeated: boolean): TargetCenteringAdmitted {
	return { ok: true, sessionId, operationId, repeated, ended: ended.promise, settled: settled.promise }
}

// Routes of the Target Centering sessions.
export function createTargetCenteringRoutes(sessions: TargetCenteringSessions) {
	return {
		'/api/target-centering': {
			// The latest centering session of every camera, started by any tab.
			GET: () => Response.json(sessions.snapshot()),
		},
		'/api/target-centering/:sessionId': {
			// The complete record of a centering session.
			GET: (req) => sessions.session(req.params.sessionId),
		},
		'/api/target-centering/:sessionId/stop': {
			// Stops a centering session, or dismisses a blocked one.
			POST: (req) => sessions.stop(req.params.sessionId),
		},
		'/api/connections/:id/cameras/:deviceId/target-centering': {
			// Starts a centering session with this camera; its progress and outcome arrive as events.
			POST: async (req) => sessions.start(req.params.id, req.params.deviceId, (await req.json()) as TargetCenteringRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
