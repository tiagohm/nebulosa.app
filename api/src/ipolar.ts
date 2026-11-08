import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { DEFAULT_REFRACTION_PARAMETERS } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { meter, toMeter } from 'nebulosa/src/math/units/distance'
import { DEFAULT_IPOLAR_CONVERGENCE, type IPolarAcceptedMeasurement, type IPolarConvergence, IPOLAR_CONVERGENCE_START, type IPolarMeasurement, type IPolarRejection } from 'nebulosa/src/observation/alignment/ipolar'
import type { IPolarObserver, IPolarProjection } from 'nebulosa/src/observation/alignment/ipolar.geometry'
// oxfmt-ignore
import { type IPolarCalibrationRun, type IPolarEvent as IPolarRunnerEvent, type IPolarMode, ipolarMountRefusal, type IPolarRunnerFrame, type IPolarServices, runIPolarCalibration, runIPolarRefinement } from 'nebulosa/src/observation/alignment/ipolar.runner'
import type { PolarAlignmentDirection } from 'nebulosa/src/observation/alignment/polaralignment'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureTime, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import type { CenteringCaptureOptions } from 'nebulosa/src/observation/mount/centering'
import { assessDarkForFrame, DarkCalibrator, type DarkEvidence, type DarkRejection } from './calibrationdark'
import type { CalibrationLibrary } from './calibrationlibrary'
import { inspectHeader } from './calibrationlibrary.sources'
import { CameraSessionRegistry } from './camerasessions'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, exposureProgressListener } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import { type OperationDevice, type OperationRegistry, settledResult } from './operations'
import type { PlateSolvePixels, PlateSolvePreparation, PlateSolveRequest, PlateSolverProvider, PlateSolvingService } from './platesolving'
import { POINTING_KEYWORDS } from './platesolving.hints'

// iPolar service: runs the toolkit's camera-based polar alignment (calibration of the mechanical RA axis from two
// solved frames, then refinement while the operator adjusts the mount base) for one camera inside a single operation
// of the process-wide registry. The operation holds the camera from the first frame until the session ends, and the
// mount of the request, when one is given, for as long, so no GoTo, nudge, or capture can move the geometry between
// the calibration frames or the refinement frames; it never holds a guide output, since the alignment sends no pulse.
// In manual mode the operator turns the RA axis and confirms it through the rotation route, and the mount, optional, is
// only watched; in automatic mode the runner turns the mount of the setup with bounded timed motions, whose clearance is
// the operator's. The toolkit owns the geometry, the quality gates, the motions, and the convergence; nothing
// is fitted here. The site and atmosphere come from the request (the profile's active observing site), never from the
// driver; a mount reporting another site only adds a warning. Frames are auxiliary LIGHT FITS files in a temporary
// directory, decoded into the image store and recorded as the latest frame of the camera (origin ipolar) before they
// are solved with the plate solving service, whose provider is resolved once when the session starts. The overlay of
// the latest accepted measurement is bound to the document of its frame. A session belongs to the server: it survives
// reloads and tab changes and ends only by its finish or stop route, an Equipment Control stop of its devices, or a
// disconnection. When it ends, the slew-rate preset an automatic rotation replaced is restored if the mount is free; the
// tracking is never changed. Angles are radians, durations seconds, instants Unix milliseconds; records live in memory,
// the latest per camera.

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type IPolarCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Observing site of a session, a snapshot of the profile's active observing site.
export interface IPolarSite {
	// Name shown to people.
	readonly name: string
	// Geodetic latitude, in radians, north positive.
	readonly latitude: number
	// Geodetic longitude, in radians, east positive.
	readonly longitude: number
	// Height above the WGS84 ellipsoid, in meters.
	readonly elevation: number
}

// Body of POST /api/connections/:id/cameras/:deviceId/ipolar.
export interface IPolarRequest extends CommandRequest {
	// How the RA axis is rotated between the calibration frames.
	readonly mode: IPolarMode
	// Mount the camera rides on, the setup's mount, by its exact connection and device ids: required in automatic mode,
	// optional in manual mode, where it is only watched and held.
	readonly mount?: OperationDevice
	// Site of the alignment.
	readonly site: IPolarSite
	// Whether the rays and the target pole use the default atmosphere; false is the geometric pole.
	readonly refraction: boolean
	// Camera settings of every frame.
	readonly capture: IPolarCaptureSettings
	// Plate solver of every frame, resolved once when the session starts.
	readonly solving: PlateSolveRequest
	// Direction of the automatic RA motions.
	readonly direction: PolarAlignmentDirection
	// Name of the slew-rate preset of the automatic motions; one the mount announces. Absent in manual mode.
	readonly slewRate?: string
	// RA rotation the automatic motions aim at, in radians.
	readonly rotation: number
	// Wait after the rotation and before the second exposure, in seconds.
	readonly settleDelay: number
	// Wait before each refinement exposure, in seconds.
	readonly refinementDelay: number
	// Total polar error a converging measurement stays within, in radians: a requested target, not an accuracy.
	readonly completionThreshold: number
	// Master dark of the Calibration Library subtracted from every frame before it is solved; absent subtracts none.
	readonly dark?: IPolarDarkRequest
}

// Master dark an operator pinned for a session: the frames are solved less it, and the frame itself is still the one shown.
export interface IPolarDarkRequest {
	// Id of the master.
	readonly masterId: number
	// SHA-256 of the master as the operator chose it; a master that changed since is never used.
	readonly digest: string
	// What a frame the dark cannot be applied to does: solved without it, with a warning (continue), or end the session
	// (stop).
	readonly onUnavailable: 'continue' | 'stop'
}

// How the pinned dark went for one frame:
// - pending: the frame is being calibrated.
// - applied: the frame was solved less the dark.
// - notApplied: the dark does not apply to the frame (code says why, from the frame's own header), or is no longer in the
//   library; the frame was solved without it, or the session stopped.
// - failed: the subtraction failed; the frame was solved without it, or the session stopped.
export type IPolarDarkState = 'pending' | 'applied' | 'notApplied' | 'failed'

// Why the pinned dark was not applied to a frame: a refusal of the strict check (calibrationdark.ts), a master no longer
// in the library or changed (unavailable), or a failed subtraction (calibrationFailed).
export type IPolarDarkCode = DarkRejection | 'unavailable' | 'calibrationFailed'

// How the pinned dark went for one frame of a session.
export interface IPolarDarkStatus {
	// Frame number within the session.
	readonly frame: number
	readonly state: IPolarDarkState
	// Id of the master.
	readonly masterId: number
	// Why it was not applied.
	readonly code?: IPolarDarkCode
	// Why, for people.
	readonly reason?: string
	// What could not be checked when it was applied; the camera always, since nothing identifies a physical camera.
	readonly unverified?: readonly DarkEvidence[]
}

// What a session is doing:
// - preparing: the session is acquiring the devices and applying the slew rate.
// - capturing: the camera takes a frame.
// - solving: the frame is being solved and judged.
// - waitingForRotation: manual mode; the operator is asked to turn the RA axis and confirm.
// - rotating: automatic mode; the mount turns in RA, then settles.
// - readyToRefine: the calibration was accepted; the refinement has not started.
// - refining: refinement frames are taken and measured while the operator adjusts the mount base.
// - refinementPaused: the refinement is paused; the devices stay held.
// - stopping: a finish or a stop was requested and the session is ending.
// - completed: the operator finished the session after the calibration.
// - failed: the session ended because of an error, given in reason and error.
// - cancelled: the session was stopped.
export type IPolarState = 'preparing' | 'capturing' | 'solving' | 'waitingForRotation' | 'rotating' | 'readyToRefine' | 'refining' | 'refinementPaused' | 'stopping' | 'completed' | 'failed' | 'cancelled'

// Stable codes of the error responses of the iPolar routes:
// - notFound: no such camera, mount, or running session.
// - busy: a device is held by another operation.
// - disconnected: a device is not connected.
// - unsupported: the plate solver is not configured, or the automatic rotation cannot run (no mount, or a mount that cannot
//   move in RA).
// - notInStage: the session is not in the stage the command needs.
export type IPolarErrorCode = 'notFound' | 'busy' | 'disconnected' | 'unsupported' | 'notInStage'

// A calibration frame of the session.
export interface IPolarPose {
	// Pose: 1 is the reference frame, 2 the frame after the RA rotation.
	readonly pose: 1 | 2
	// Frame number within the session, from 1.
	readonly frame: number
	// ICRS right ascension of the solved center, in radians.
	readonly rightAscension: number
	// ICRS declination of the solved center, in radians.
	readonly declination: number
	// Midpoint of the exposure, Unix milliseconds (UTC).
	readonly time: number
	// Id of the capture document of the frame; open while it is the latest frame of its camera or leased.
	readonly imageId?: string
}

// A second-pose candidate that did not calibrate.
export interface IPolarAttempt {
	// Frame number within the session, from 1.
	readonly frame: number
	// Why it did not.
	readonly reason: IPolarRejection
	// Rotation fitted from the reference frame, in radians, when reached.
	readonly rotation?: number
	// Whether another candidate was tried.
	readonly retry: boolean
}

// Diagnostics of the accepted calibration.
export interface IPolarCalibrationSummary {
	// Frame number of the second pose.
	readonly frame: number
	// RA rotation fitted between the poses, in radians.
	readonly rotation: number
	// Whether the rotation lies in the preferred range.
	readonly preferred: boolean
	// Largest angular residual of the fit, in radians.
	readonly residual: number
	// Conditioning of the fit, in [0, 1].
	readonly conditioning: number
	// Angle between the mechanical axis and the target pole when calibrated, in radians.
	readonly axisOffset: number
	// Interval between the poses, in seconds.
	readonly interval: number
	// Whether a mount reported its declination and pier side throughout; false when the RA-only motion rests on the
	// operator's word.
	readonly verified: boolean
}

// The latest accepted measurement of the polar error.
export interface IPolarMeasurementSummary {
	// Frame number of the solve it belongs to.
	readonly frame: number
	// Id of the capture document of that frame.
	readonly imageId?: string
	// Midpoint of the exposure, Unix milliseconds (UTC).
	readonly time: number
	// Great-circle angle between the mechanical axis and the target pole, in radians.
	readonly totalError: number
	// On-sky component towards local east, in radians: positive when the axis lies east of the pole, in either hemisphere.
	readonly azimuthError: number
	// On-sky component towards the zenith, in radians: positive when the axis lies above the pole.
	readonly altitudeError: number
	// Largest angular residual of the frame's attitude fit, in radians.
	readonly residual: number
}

// The latest frame that gave no measurement.
export interface IPolarRejectionSummary {
	// Frame number within the session.
	readonly frame: number
	// Why: a quality gate of the toolkit, or unsolved for a frame without a plate solution.
	readonly reason: IPolarRejection | 'unsolved'
	// Midpoint of the exposure, Unix milliseconds (UTC).
	readonly time: number
}

// Correction guide of the latest accepted measurement over its frame, in FITS 1-based pixels.
export interface IPolarOverlay {
	// Id of the capture document of the frame the markers belong to.
	readonly imageId?: string
	// Frame number within the session.
	readonly frame: number
	// The mechanical RA axis.
	readonly axis: IPolarProjection
	// The target celestial pole.
	readonly pole: IPolarProjection
}

// Session record published to clients, without its poses, attempts, and overlay.
export interface IPolarSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the camera and the mount.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Mount held and watched, absent for a camera alone.
	readonly mount?: OperationDevice
	// Name of the mount.
	readonly mountName?: string
	// Request the session runs with.
	readonly request: Omit<IPolarRequest, 'token'>
	// Plate solver of every frame.
	readonly provider: PlateSolverProvider
	// What the session is doing.
	readonly state: IPolarState
	// Frames taken so far.
	readonly frameCount: number
	// Second-pose candidates tried so far, the accepted one included.
	readonly attemptCount: number
	// The accepted calibration.
	readonly calibration?: IPolarCalibrationSummary
	// Latest accepted measurement.
	readonly measurement?: IPolarMeasurementSummary
	// Whether the latest measurement belongs to the latest frame solved; false once a later frame was rejected or did not
	// solve, so the measurement is stale.
	readonly current: boolean
	// Latest frame that gave no measurement.
	readonly rejection?: IPolarRejectionSummary
	// Consecutive fresh measurements within the threshold, and whether they reached the required count.
	readonly convergence: Pick<IPolarConvergence, 'streak' | 'converged'>
	// Refinement frames measured.
	readonly refinementCount: number
	// How the pinned dark went for the latest frame; absent without a dark or before the first frame.
	readonly dark?: IPolarDarkStatus
	// Slew-rate preset the mount used before an automatic rotation changed it; absent when it reported none.
	readonly previousSlewRate?: string
	// Whether the previous preset was restored when the session ended; absent before it ended or when there was nothing to
	// restore.
	readonly slewRateRestored?: boolean
	// Progress of the frame being exposed, as the driver reports it; absent outside an exposure.
	readonly exposure?: CameraCaptureTime
	// Problems meant for people, latest last, such as frames that did not solve.
	readonly warnings: readonly string[]
	// Why the session failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure meant for people.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Complete session record.
export interface IPolarSession extends IPolarSessionSummary {
	// Calibration frames accepted, in order.
	readonly poses: readonly IPolarPose[]
	// Second-pose candidates that did not calibrate, latest MAXIMUM_ATTEMPTS.
	readonly attempts: readonly IPolarAttempt[]
	// Correction guide of the latest accepted measurement.
	readonly overlay?: IPolarOverlay
	// How the pinned dark went for each frame, latest MAXIMUM_WARNINGS; empty without a dark.
	readonly darkFrames: readonly IPolarDarkStatus[]
}

// Calls of the Calibration Library a session makes: the pinned master, checked again for every frame, and the lease that
// keeps it from being deleted while the session may read it.
export type IPolarDarkLibrary = Pick<CalibrationLibrary, 'pinnedMaster' | 'lease'>

// Snapshot of GET /api/ipolar: the latest session of every camera.
export interface IPolarSnapshot {
	readonly sessions: readonly IPolarSessionSummary[]
}

// Response of an accepted session.
export interface IPolarStartResponse {
	// Id of the session, repeated by its ipolar:updated events.
	readonly sessionId: string
	// Id of the operation holding the devices.
	readonly operationId: string
}

// Notification published whenever a session changes.
export type IPolarEvent = { readonly type: 'ipolar:updated'; readonly session: IPolarSessionSummary }

// Receiver of iPolar events.
export type IPolarListener = (event: IPolarEvent) => void

// Longest wait for one solve, queue included, in seconds; the provider's own timeout normally ends it first.
const SOLVE_TIMEOUT = 600

// Watchdog after an aborted solve before it is reported unresponsive, in seconds.
const SOLVE_ABORT_GRACE = 10

// First automatic RA motion, in seconds, before the rotation rate of the preset is known.
const INITIAL_MOTION = 1

// Longest single automatic RA motion, in seconds.
const MAXIMUM_MOTION = 30

// Longest total automatic RA motion of a calibration, in seconds.
const MAXIMUM_TOTAL_MOTION = 180

// Second-pose candidates allowed before the calibration fails.
const MAXIMUM_ATTEMPTS = 8

// Largest change of the mount's reported declination tolerated during a session, in radians (0.5°).
const MAXIMUM_DECLINATION_CHANGE = 0.5 * DEG2RAD

// Consecutive refinement frames without solution tolerated before the session fails.
const MAXIMUM_REFINEMENT_FAILURES = 3

// Consecutive measurements within the threshold that make the alignment converged.
const COMPLETION_COUNT = 3

// Distance between the site of the request and the one the mount reports beyond which a warning is added, in radians of
// latitude or longitude (0.1°) and meters of elevation.
const SITE_MISMATCH_ANGLE = 0.1 * DEG2RAD
const SITE_MISMATCH_ELEVATION = 500

// Warnings and rejected candidates kept per session.
const MAXIMUM_WARNINGS = 20

// A session while its service knows it.
interface Session {
	summary: IPolarSessionSummary
	readonly poses: IPolarPose[]
	readonly attempts: IPolarAttempt[]
	overlay?: IPolarOverlay
	// Mount of the session, for the restoration of its slew rate.
	readonly mount?: Mount
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<void>
	// Refinement in progress, cancelled by a pause.
	refinement?: OperationHandle<void>
	// Settles with true when the refinement is started, false when the session is stopped first.
	resume?: PromiseWithResolvers<boolean>
	// Manual mode: settles with true when the operator confirms the RA rotation, false when the session is stopped first.
	rotation?: PromiseWithResolvers<boolean>
	// Whether the session ends because the operator finished it.
	finishing?: boolean
	// Frame being taken: its number and the document it was decoded into.
	frame?: { readonly number: number; readonly pose?: 1 | 2; readonly time: number; imageId?: string; observedAt?: number }
	// Accepted calibration, the input of every refinement.
	calibration?: IPolarCalibrationRun
	// Latest accepted measurement and the convergence, the state a resumed refinement continues from.
	previous?: IPolarAcceptedMeasurement
	convergence: IPolarConvergence
	// Pinned dark: its lease, released once, and the worker that subtracts it; absent without a dark.
	readonly dark?: { readonly request: IPolarDarkRequest; readonly release: () => void; readonly calibrator: DarkCalibrator }
	// How the dark went for each frame, latest MAXIMUM_WARNINGS.
	readonly darkFrames: IPolarDarkStatus[]
	// Why the session itself ended it (a dark it could not apply under the stop policy), shown instead of the cancellation.
	failure?: { readonly reason: OperationFailureReason; readonly error: string }
}

// iPolar sessions of the cameras of every open connection.
export class IPolarSessions {
	// Latest session of each camera, and the session each start token started.
	readonly #sessions: CameraSessionRegistry<IPolarSessionSummary, Session>

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// session, commander rotates the mounts in automatic mode (the one of the mount commands), capturer takes the frames
	// (the one of the capture service), images receives the frames, frames records them as the latest frame of their
	// camera and closes them, plateSolving solves them, library gives the master dark a session pinned, and listener
	// receives every session change synchronously. auxiliaryDir is the parent of the temporary directory of each session.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly commander: MountCommander,
		readonly capturer: CameraCapturer,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly plateSolving: Pick<PlateSolvingService, 'prepare' | 'solve'>,
		readonly library: IPolarDarkLibrary,
		readonly listener: IPolarListener,
		readonly auxiliaryDir: string = tmpdir(),
	) {
		this.#sessions = new CameraSessionRegistry(operations, (session) => listener({ type: 'ipolar:updated', session }))
	}

	// Returns the latest session of every camera.
	snapshot(): IPolarSnapshot {
		return { sessions: this.#sessions.summaries() }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json(this.#complete(session)) : errorResponse('iPolar session not found', 404, 'notFound' satisfies IPolarErrorCode)
	}

	// Starts a session. Responds 202 with IPolarStartResponse once accepted (a repeated token answers its first session);
	// its progress and outcome arrive as ipolar:updated and operation:updated events. Responds 404 for an unknown camera
	// or mount, 409 when either is disconnected or held by another operation, and 422 when the plate solver is not
	// configured or, in automatic mode, there is no mount or the mount cannot turn in RA at the preset (not equatorial, no
	// west-east motion or abort, no such preset, or parked). A mount in manual mode is never refused for what it cannot do,
	// since it is only watched.
	async start(connectionId: string, deviceId: string, request: IPolarRequest): Promise<Response> {
		const repeated = this.#sessions.repeated(request.token)
		if (repeated) return accepted(repeated)

		// The provider settings are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.plateSolving.prepare(request.solving)
		if (!preparation) return unsupported('The plate solver is not configured; set it up in Settings → External Tools')

		// The pinned dark is checked before anything starts; every frame checks it again against its own header.
		if (request.dark) {
			const master = await this.library.pinnedMaster({ masterId: request.dark.masterId, digest: request.dark.digest })
			if (!master || master.kind !== 'dark') return unsupported(`The pinned dark #${request.dark.masterId} is no longer in the Calibration Library, or it changed`)
		}

		// The same request, sent twice, may have started its session while this one was prepared.
		const raced = this.#sessions.repeated(request.token)
		if (raced) return accepted(raced)

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = request.mount && connectedDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (mount instanceof Response) return mount

		if (request.mode === 'automatic') {
			if (!mount) return unsupported('The automatic rotation needs the mount of the equipment setup')
			const refused = ipolarMountRefusal(mount, request.slewRate ?? '')
			if (refused) return unsupported(refused)
		}

		if (!this.operations.available(camera) || (mount && !this.operations.available(mount))) return busy()

		const { token, ...settings } = request
		const cameraDevice = { connectionId, deviceId }
		const warnings = mount && request.mode === 'automatic' ? siteMismatch(mount, request.site) : []
		const session: Session = {
			summary: {
				sessionId: Bun.randomUUIDv7(),
				operationId: '',
				camera: cameraDevice,
				cameraName: camera.name,
				...(mount && request.mount && { mount: request.mount, mountName: mount.name }),
				request: settings,
				provider: request.solving.provider,
				state: 'preparing',
				frameCount: 0,
				attemptCount: 0,
				current: false,
				convergence: { streak: 0, converged: false },
				refinementCount: 0,
				warnings,
				startedAt: Date.now(),
				revision: 0,
			},
			poses: [],
			attempts: [],
			mount,
			convergence: IPOLAR_CONVERGENCE_START,
			// The lease keeps the master from being deleted for the whole session; #ended releases it.
			...(request.dark && { dark: { request: request.dark, release: this.library.lease([{ masterId: request.dark.masterId }]), calibrator: new DarkCalibrator() } }),
			darkFrames: [],
		}

		const devices = mount && request.mount ? [cameraDevice, request.mount] : [cameraDevice]
		const record = this.operations.run('camera.ipolar', devices, token, () => {
			const handle = this.#run(session, camera, mount, preparation)
			session.handle = handle
			return handle.result
		})

		this.#sessions.adopt(resourceKey(camera), session, record.operationId)

		void settledResult(session.handle!.result).then((result) => this.#ended(session, result))
		return accepted(session)
	}

	// Stops a session: the motion, exposure, solve, or wait in progress is cancelled (the mount is stopped) and nothing more
	// is commanded. Resolves once the operation released the devices. Responds 204, and 404 when the session is unknown or
	// already ended.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#running(sessionId)
		if (!session?.handle) return notRunning()

		if (session.summary.state !== 'stopping') this.#sessions.update(session, { state: 'stopping' })
		await session.handle.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Finishes a session after its calibration, recording it as completed with its latest measurement and convergence.
	// Resolves once the operation released the devices. Responds 204, 404 when the session is unknown or ended, and 409
	// when it has no accepted calibration yet.
	async finish(sessionId: string): Promise<Response> {
		const session = this.#running(sessionId)
		if (!session?.handle) return notRunning()
		if (!session.calibration) return notInStage('The iPolar session has no calibration to finish with')

		session.finishing = true
		if (session.summary.state !== 'stopping') this.#sessions.update(session, { state: 'stopping' })
		await session.handle.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Tells a manual session that the operator turned the RA axis, so the second pose is taken; it never moves anything.
	// Responds 204, 404 when the session is unknown or ended, and 409 when it is not waiting for the rotation.
	confirmRotation(sessionId: string): Response {
		const session = this.#running(sessionId)
		if (!session) return notRunning()
		if (!session.rotation) return notInStage('The iPolar session is not waiting for the RA rotation')

		session.rotation.resolve(true)
		return new Response(null, { status: 204 })
	}

	// Starts or resumes the refinement of a calibrated session. Responds 204, 404 when the session is unknown or ended,
	// and 409 when it is not waiting for the refinement.
	startRefinement(sessionId: string): Response {
		const session = this.#running(sessionId)
		if (!session) return notRunning()
		if (!session.resume) return notInStage('The iPolar session is not waiting for the refinement')

		session.resume.resolve(true)
		return new Response(null, { status: 204 })
	}

	// Pauses the refinement of a session; the frame in progress is cancelled and the devices stay held. Resolves once it
	// stopped. Responds 204, 404 when the session is unknown or ended, and 409 when it is not refining.
	async stopRefinement(sessionId: string): Promise<Response> {
		const session = this.#running(sessionId)
		if (!session) return notRunning()
		if (!session.refinement) return notInStage('The iPolar session is not refining')

		await session.refinement.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Returns the latest session of its camera with this id while it has not ended.
	#running(sessionId: string) {
		const session = this.#sessions.find(sessionId)
		return session && session.summary.endedAt === undefined ? session : undefined
	}

	// Starts the operation of a session holding its camera and mount, and runs the calibration and the refinement inside
	// it.
	#run(session: Session, camera: Camera, mount: Mount | undefined, preparation: PlateSolvePreparation): OperationHandle<void> {
		const resources: ResourceRequest[] = [{ key: resourceKey(camera), device: camera }]
		if (mount) resources.push({ key: resourceKey(mount), device: mount })

		return this.operations.coordinator.start<void>('ipolarSession', resources, async (context) => {
			const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-ipolar-'))

			try {
				const { request } = session.summary
				const automatic = request.mode === 'automatic'
				const { latitude, longitude, elevation } = request.site
				const observer: IPolarObserver = { location: geodeticLocation(longitude, latitude, meter(elevation)), refraction: request.refraction ? DEFAULT_REFRACTION_PARAMETERS : false }
				const capture: CenteringCaptureOptions = { ...request.capture, exposureTimeUnit: 'second', frameType: 'LIGHT', compressed: false }
				const services: IPolarServices = {
					...(automatic && { mountCommander: this.commander }),
					cameraCapturer: this.capturer,
					captureListener: exposureProgressListener((exposure) => this.#sessions.update(session, { exposure })),
					solver: (frame, signal) => this.#solve(session, frame, preparation, signal),
					auxiliaryPath: (stage, index) => join(directory, `ipolar-${stage}-${index}.fit`),
					clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay },
					rotationConfirmed: (signal) => this.#rotationConfirmed(session, signal),
					listener: (event) => this.#progress(session, event),
				}

				const calibrated = await runIPolarCalibration(
					context,
					camera,
					mount,
					{
						mode: request.mode,
						capture,
						observer,
						...(automatic && { motion: { direction: request.direction, slewRate: request.slewRate!, targetRotation: request.rotation, initialMotion: INITIAL_MOTION, maximumMotion: MAXIMUM_MOTION, maximumTotalMotion: MAXIMUM_TOTAL_MOTION } }),
						settle: request.settleDelay,
						maximumAttempts: MAXIMUM_ATTEMPTS,
						maximumDeclinationChange: MAXIMUM_DECLINATION_CHANGE,
						solveTimeout: SOLVE_TIMEOUT,
						abortGrace: SOLVE_ABORT_GRACE,
					},
					services,
				)

				if (!calibrated.ok) return calibrated

				const calibration = calibrated.value
				session.calibration = calibration
				const refinement = {
					capture,
					delay: request.refinementDelay,
					maximumFailures: MAXIMUM_REFINEMENT_FAILURES,
					maximumDeclinationChange: MAXIMUM_DECLINATION_CHANGE,
					solveTimeout: SOLVE_TIMEOUT,
					abortGrace: SOLVE_ABORT_GRACE,
					convergence: { ...DEFAULT_IPOLAR_CONVERGENCE, threshold: request.completionThreshold, count: COMPLETION_COUNT },
					// Only a mount turned by its motor keeps reporting where the camera points.
					snoop: automatic,
				}
				this.#sessions.update(session, { state: 'readyToRefine' })

				while (true) {
					if (!(await this.#refinementRequested(session, context.signal))) return failedOperationResult('aborted')

					const state = { previous: session.previous, convergence: session.convergence }
					const handle = context.start<void>('ipolarRefinement', [], (child) => runIPolarRefinement(child, camera, mount, calibration.mount, calibration.calibration, state, refinement, services, session.summary.frameCount + 1))
					session.refinement = handle
					this.#sessions.update(session, { state: 'refining' })
					const result = await handle.result
					session.refinement = undefined

					if (context.signal.aborted) return failedOperationResult('aborted')
					if (result.ok || result.reason !== 'aborted') return result.ok ? successfulOperationResult(undefined) : result
					this.#sessions.update(session, { state: 'refinementPaused', exposure: undefined })
				}
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}

	// Waits until the operator starts the refinement; resolves false when the session is stopped first.
	async #refinementRequested(session: Session, signal: AbortSignal): Promise<boolean> {
		return await this.#operatorStep(session, 'resume', signal)
	}

	// Waits until the operator confirms the RA rotation; resolves false when the session is stopped first.
	async #rotationConfirmed(session: Session, signal: AbortSignal): Promise<boolean> {
		return await this.#operatorStep(session, 'rotation', signal)
	}

	// Waits for the operator's step `key` of a session, which its route resolves; resolves false when `signal` aborts first.
	async #operatorStep(session: Session, key: 'resume' | 'rotation', signal: AbortSignal): Promise<boolean> {
		if (signal.aborted) return false

		const step = Promise.withResolvers<boolean>()
		const abort = () => step.resolve(false)
		session[key] = step
		signal.addEventListener('abort', abort, { once: true })

		try {
			return await step.promise
		} finally {
			signal.removeEventListener('abort', abort)
			session[key] = undefined
		}
	}

	// Decodes a frame file into the image store, records it as the latest frame of the camera in the capture frame
	// registry, and solves it with the prepared provider, whose job retains the document until it ends. Resolves the
	// solution, or undefined when the search found none; any other failure is recorded as a warning and rejects, so the
	// runner counts the frame as unsolved, while a cancellation ends the session.
	async #solve(session: Session, frame: IPolarRunnerFrame, preparation: PlateSolvePreparation, signal: AbortSignal): Promise<PlateSolution | undefined> {
		const { camera, cameraName, sessionId } = session.summary
		const current = session.frame
		const number = current?.number ?? session.summary.frameCount
		this.#sessions.update(session, { exposure: undefined })
		this.#phase(session, 'solving')

		try {
			const bytes = new Uint8Array(await Bun.file(frame.path).arrayBuffer())
			const time = current?.time ?? Date.now()
			const frameId = captureFrameId(sessionId, number)
			const info = await this.images.openCapture(bytes, basename(frame.path), { ...camera, frameId, time })
			const { width, height, channels, cfa, acquisition } = info
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const record: CaptureFrame = { imageId: info.id, sessionId, ...camera, generation: number, time, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
			this.frames.previewed(info, record, cameraName, 'ipolar')
			if (current) Object.assign(current, { imageId: info.id, observedAt: frame.observedAt })

			// The frame itself stays the one shown and solved for; only the pixels the solver reads lose the dark.
			const pixels = session.dark && (await this.#darkPixels(session, frame, info.header, number, preparation))
			if (pixels === 'stop') throw new Error(session.failure!.error)

			const step = frame.pose === 1 ? 'reference' : frame.pose === 2 ? 'second' : 'refinement'
			const result = await this.plateSolving.solve(info.id, preparation, signal, { kind: 'ipolar', sessionId, ...camera, frameId, step }, pixels)
			if (!result.solution) this.#warn(session, `Frame ${number} did not solve.`)
			return result.solution
		} catch (error) {
			if (!signal.aborted && !session.failure) this.#warn(session, `Frame ${number} could not be solved: ${Error.isError(error) ? error.message : String(error)}`)
			throw error
		}
	}

	// Subtracts the pinned dark from a frame for its solve. The master is checked again (it may have been deleted, changed,
	// or gone stale) and judged against the frame's own header, then subtracted on the session's worker. Resolves the
	// calibrated pixels, undefined when the frame is to be solved as it is (continue), or 'stop' after the session was
	// set to end (stop); every frame publishes its own outcome, so an earlier frame's never stands for it.
	async #darkPixels(session: Session, frame: IPolarRunnerFrame, header: FitsHeader, number: number, preparation: PlateSolvePreparation): Promise<PlateSolvePixels | undefined | 'stop'> {
		const { request, calibrator } = session.dark!
		const { masterId, digest } = request
		this.#darkStatus(session, { frame: number, state: 'pending', masterId })

		const master = await this.library.pinnedMaster({ masterId, digest })
		const assessment = master ? assessDarkForFrame(inspectHeader(header, 'fits', false).metadata, master) : ({ eligible: false, code: 'unavailable', reason: `The dark #${masterId} is no longer in the Calibration Library, or it changed` } as const)
		let outcome: IPolarDarkStatus

		if (master && assessment.eligible) {
			const omit = preparation.request.strategy === 'blind' ? POINTING_KEYWORDS : []
			const calibrated = await calibrator.calibrate({ framePath: frame.path, darkPath: master.path, fullScale: master.units === 'dimensionless' ? 1 : master.fullScaleDn, masterKey: `${masterId}:${digest}`, omit })

			if ('bytes' in calibrated) {
				this.#darkStatus(session, { frame: number, state: 'applied', masterId, unverified: assessment.unverified })
				return { bytes: calibrated.bytes, fingerprint: `dark:${masterId}:${digest}` }
			}

			outcome = { frame: number, state: 'failed', masterId, code: 'calibrationFailed', reason: calibrated.failed }
		} else {
			outcome = { frame: number, state: 'notApplied', masterId, code: assessment.eligible ? 'unavailable' : assessment.code, reason: assessment.eligible ? undefined : assessment.reason }
		}

		this.#darkStatus(session, outcome)

		if (request.onUnavailable === 'stop') {
			session.failure = { reason: 'unexpectedState', error: `The dark #${masterId} could not be subtracted from frame ${number}: ${outcome.reason}` }
			void session.handle?.cancel('unexpectedState')
			return 'stop'
		}

		this.#warn(session, `Frame ${number} was solved without the dark: ${outcome.reason}`)
		return undefined
	}

	// Publishes how the pinned dark went for a frame, and keeps the outcomes of the latest frames.
	#darkStatus(session: Session, status: IPolarDarkStatus) {
		if (status.state !== 'pending') {
			session.darkFrames.push(status)
			if (session.darkFrames.length > MAXIMUM_WARNINGS) session.darkFrames.shift()
		}

		this.#sessions.update(session, { dark: status })
	}

	// Follows the progress the runner reports.
	#progress(session: Session, event: IPolarRunnerEvent) {
		if (session.summary.state === 'stopping') return

		switch (event.type) {
			case 'slewRate':
				this.#sessions.update(session, { previousSlewRate: event.previous })
				break
			case 'capture': {
				const number = session.summary.frameCount + 1
				session.frame = { number, pose: event.pose, time: Date.now() }
				this.#sessions.update(session, { frameCount: number, ...(event.pose === 2 && { attemptCount: session.summary.attemptCount + 1 }) })
				this.#phase(session, 'capturing')
				break
			}
			case 'solved':
				if (event.solution && event.frame.pose === 1) this.#posed(session, 1, event.solution)
				else if (!event.solution && event.frame.stage === 'refinement') this.#rejected(session, 'unsolved')
				break
			case 'waitingForRotation':
				this.#sessions.update(session, { state: 'waitingForRotation' })
				break
			case 'move':
				this.#sessions.update(session, { state: 'rotating' })
				break
			case 'calibrationRejected': {
				const attempt: IPolarAttempt = { frame: this.#frameNumber(session), reason: event.reason, ...(event.quality.rotation !== undefined && { rotation: event.quality.rotation }), retry: event.retry }
				session.attempts.push(attempt)
				if (session.attempts.length > MAXIMUM_WARNINGS) session.attempts.shift()
				this.#sessions.update(session, {})
				break
			}
			case 'calibrationAccepted': {
				const { quality } = event.calibration
				this.#posed(session, 2, event.solution)
				const calibration: IPolarCalibrationSummary = {
					frame: this.#frameNumber(session),
					rotation: quality.rotation,
					preferred: quality.preferred,
					residual: quality.maximumResidual,
					conditioning: quality.conditioning,
					axisOffset: quality.axisOffset,
					interval: quality.interval,
					verified: event.verified,
				}
				this.#sessions.update(session, { calibration })
				this.#measured(session, event.measurement)
				break
			}
			case 'measurement':
				session.convergence = event.convergence
				this.#measured(session, event.measurement, true)
				break
		}
	}

	// Records an accepted calibration pose.
	#posed(session: Session, pose: 1 | 2, solution: PlateSolution) {
		const frame = session.frame
		session.poses.push({
			pose,
			frame: this.#frameNumber(session),
			rightAscension: solution.rightAscension,
			declination: solution.declination,
			time: frame?.observedAt ?? Date.now(),
			...(frame?.imageId !== undefined && { imageId: frame.imageId }),
		})
	}

	// Records a measurement: an accepted one becomes the latest measurement with the overlay of its frame, a rejected one
	// makes the latest measurement stale. A refinement frame also counts and carries the convergence.
	#measured(session: Session, measurement: IPolarMeasurement, refinement: boolean = false) {
		const counted = refinement ? { refinementCount: session.summary.refinementCount + 1, convergence: { streak: session.convergence.streak, converged: session.convergence.converged } } : {}
		if (!measurement.valid) {
			this.#rejected(session, measurement.reason, counted)
			return
		}

		const frame = session.frame
		const number = this.#frameNumber(session)
		const imageId = frame?.imageId
		const summary: IPolarMeasurementSummary = {
			frame: number,
			...(imageId !== undefined && { imageId }),
			time: frame?.observedAt ?? timeToUnixMillis(measurement.time),
			totalError: measurement.error.total,
			azimuthError: measurement.error.azimuth,
			altitudeError: measurement.error.altitude,
			residual: measurement.residual,
		}

		session.previous = measurement
		session.overlay = { frame: number, ...(imageId !== undefined && { imageId }), axis: measurement.axisPoint, pole: measurement.polePoint }
		this.#sessions.update(session, { measurement: summary, current: true, rejection: undefined, ...counted })
	}

	// Records a frame that gave no measurement, which makes the latest measurement stale.
	#rejected(session: Session, reason: IPolarRejectionSummary['reason'], fields: Partial<IPolarSessionSummary> = {}) {
		const frame = session.frame
		const rejection: IPolarRejectionSummary = { frame: this.#frameNumber(session), reason, time: frame?.observedAt ?? Date.now() }
		const convergence = reason === 'unsolved' ? { convergence: { streak: 0, converged: false } } : {}
		if (reason === 'unsolved') session.convergence = IPOLAR_CONVERGENCE_START
		this.#sessions.update(session, { current: false, rejection, ...convergence, ...fields })
	}

	// Number of the frame being handled.
	#frameNumber(session: Session) {
		return session.frame?.number ?? session.summary.frameCount
	}

	// Reports the step a session is in; the refinement stays refining throughout its frames.
	#phase(session: Session, state: Extract<IPolarState, 'capturing' | 'solving'>) {
		if (!session.refinement && session.summary.state !== state) this.#sessions.update(session, { state })
	}

	// Ends a session from the result of its operation: restores the slew rate an automatic rotation replaced, then records
	// its end, so a tab sees the session ended only once the mount is as it was, and a session started from that end finds
	// the mount free.
	async #ended(session: Session, result: OperationResult<void>) {
		session.frame = undefined
		// Nothing reads the dark any more: its lease and its worker end with the session.
		session.dark?.release()
		session.dark?.calibrator[Symbol.dispose]()
		const previous = session.summary.previousSlewRate
		const { mount } = session
		const restoration: { slewRateRestored?: boolean } = {}
		let { warnings } = session.summary

		// The operation released the mount, so the restoration takes it again for itself; another operation that took it
		// first, or a disconnection, leaves the mount as the session left it.
		if (mount && previous !== undefined && mount.slewRate !== previous) {
			const restored = mount.connected && this.operations.available(mount) ? await this.commander.setSlewRate(this.operations.coordinator, mount, previous) : undefined
			restoration.slewRateRestored = restored?.ok === true
			if (!restored?.ok) warnings = appendWarning(warnings, `The slew rate of ${mount.name} was left at ${mount.slewRate ?? 'an unknown preset'} instead of ${previous}.`)
		}

		const ended = { ...restoration, warnings, exposure: undefined, endedAt: Date.now() }
		if (result.ok || (result.reason === 'aborted' && session.finishing)) this.#sessions.update(session, { state: 'completed', ...ended })
		else if (result.reason === 'aborted') this.#sessions.update(session, { state: 'cancelled', ...ended })
		else if (session.failure) this.#sessions.update(session, { state: 'failed', reason: session.failure.reason, error: session.failure.error, ...ended })
		else this.#sessions.update(session, { state: 'failed', reason: result.reason, ...(result.error !== undefined && { error: result.error }), ...ended })
	}

	// Records a warning of a session.
	#warn(session: Session, warning: string) {
		this.#sessions.update(session, { warnings: appendWarning(session.summary.warnings, warning) })
	}

	// Returns the complete record of a session.
	#complete(session: Session): IPolarSession {
		return { ...session.summary, poses: session.poses, attempts: session.attempts, ...(session.overlay && { overlay: session.overlay }), darkFrames: session.darkFrames }
	}
}

// Warnings for a mount that reports another site than the request, which the session uses anyway.
function siteMismatch(mount: Mount, site: IPolarSite): string[] {
	if (!mount.hasGeographicCoordinate) return []
	const { latitude, longitude, elevation } = mount.geographicCoordinate
	const angle = Math.max(Math.abs(latitude - site.latitude), Math.abs(Math.atan2(Math.sin(longitude - site.longitude), Math.cos(longitude - site.longitude))))
	const height = Math.abs(toMeter(elevation) - site.elevation)
	if (angle <= SITE_MISMATCH_ANGLE && height <= SITE_MISMATCH_ELEVATION) return []
	return [`${mount.name} reports a site different from ${site.name}; the alignment uses ${site.name}.`]
}

// Returns the warnings with one more, keeping the latest MAXIMUM_WARNINGS.
function appendWarning(warnings: readonly string[], warning: string) {
	return [...warnings, warning].slice(-MAXIMUM_WARNINGS)
}

// Responds that no running session has the id.
function notRunning() {
	return errorResponse('No iPolar session is running with this id', 404, 'notFound' satisfies IPolarErrorCode)
}

// Responds that a session is not in the stage a command needs.
function notInStage(message: string) {
	return errorResponse(message, 409, 'notInStage' satisfies IPolarErrorCode)
}

// Responds that a session was accepted, with its id and the id of its operation.
function accepted({ summary: { sessionId, operationId } }: Session) {
	return Response.json({ sessionId, operationId } satisfies IPolarStartResponse, { status: 202 })
}

// Routes of the iPolar sessions.
export function createIPolarRoutes(ipolar: IPolarSessions) {
	return {
		'/api/ipolar': {
			// The latest iPolar session of every camera, started by any tab, without its poses and overlay.
			GET: () => Response.json(ipolar.snapshot()),
		},
		'/api/ipolar/:sessionId': {
			// An iPolar session with its poses, rejected candidates, and the overlay of its latest measurement; 404 when it
			// is not the latest of its camera.
			GET: (req) => ipolar.session(req.params.sessionId),
		},
		'/api/ipolar/:sessionId/rotation/confirm': {
			// Tells a manual iPolar session that the operator turned the RA axis; never moves anything.
			POST: (req) => ipolar.confirmRotation(req.params.sessionId),
		},
		'/api/ipolar/:sessionId/refinement/start': {
			// Starts or resumes the refinement of a calibrated iPolar session.
			POST: (req) => ipolar.startRefinement(req.params.sessionId),
		},
		'/api/ipolar/:sessionId/refinement/stop': {
			// Pauses the refinement of an iPolar session, keeping its devices.
			POST: (req) => ipolar.stopRefinement(req.params.sessionId),
		},
		'/api/ipolar/:sessionId/finish': {
			// Finishes a calibrated iPolar session as completed.
			POST: (req) => ipolar.finish(req.params.sessionId),
		},
		'/api/ipolar/:sessionId/stop': {
			// Stops an iPolar session; an automatic rotation is stopped and its previous slew rate restored when possible.
			POST: (req) => ipolar.stop(req.params.sessionId),
		},
		'/api/connections/:id/cameras/:deviceId/ipolar': {
			// Starts an iPolar alignment with this camera; its progress and outcome arrive as ipolar:updated and
			// operation:updated events.
			POST: async (req) => ipolar.start(req.params.id, req.params.deviceId, (await req.json()) as IPolarRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
