import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { angularDistance, equatorialToJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import type { MountCommander } from 'nebulosa/src/devices/commanders/mount'
import type { Camera, Mount, MountTargetCoordinate, PierSide } from 'nebulosa/src/devices/indi/device'
import { isDeviceQuiescent } from 'nebulosa/src/devices/orchestration/device.lifecycle'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type Angle, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { toMeter } from 'nebulosa/src/math/units/distance'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureTime, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import { type CenteringCorrection, type CenteringFrame, type CenteringMeasurement, type CenteringObserver, type CenteringOptions, type CenteringStep, type CenteringTarget, centerTarget } from 'nebulosa/src/observation/mount/centering'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, exposureProgressListener } from './captures'
import { busy, type ClientResolver, type CommandErrorCode, type CommandRequest, connectedDevice, notFound, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { GuidingSessions } from './guiding'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { MountCommands } from './mounts'
import type { OperationDevice, OperationRegistry } from './operations'
import { type PlateSolvePreparation, type PlateSolveRequest, PlateSolvingError, type PlateSolverProvider, type PlateSolvingService } from './platesolving'
import type { SkyObserver } from './sky/ephemeris'

// Target Centering: brings a fixed J2000 target to the center of a camera, or measures how far it is, inside one
// mount.targetCentering operation. Center slews first, through the same refusals and the single correction of the goto
// route (MountCommands.goToWithin); Recenter slews only when the mount stands farther than a correction may go; Verify Only
// never commands the mount. Then the toolkit's centerTarget exposes, solves, and corrects with the residual it measured,
// which never passes through a pointing model, so a model in force is applied once, by the first slew, and later changes of
// it cannot reach the session. Success is only ever a solution taken after the last motion, within the tolerance.
//
// The operation's root holds the camera and a child of it the mount, both until the end, so nothing comes between an
// exposure and its correction. Frames are auxiliary files deleted once solved, recorded as the latest frame of their camera
// (origin targetCentering), never saved as captures. Guiding that may pulse the mount refuses the start, and the mount is
// kept from being guided until the operation ends: a guide output on a camera's ST4 port shares no device with the mount, so
// the arbiter alone would not tell. A session belongs to the server: it survives tab reloads and workspace changes, and ends
// with the process; sessions live in memory, the latest of each camera. Angles are radians, durations seconds, and instants
// Unix milliseconds.

// What a session does:
// - center: slews to a new target, then corrects until a solution verifies it.
// - recenter: recovers a target it should stand near, slewing only when it does not.
// - verifyOnly: measures the distance to a target; nothing commands the mount.
export type TargetCenteringMode = 'center' | 'recenter' | 'verifyOnly'

// Fixed target of a session. J2000 means ICRS, and a time-dependent target has no place here.
export interface TargetCenteringTarget extends CenteringTarget {
	// Name meant for people.
	readonly label?: string
	// Saved framing the target was copied from; informative, since the coordinates here are what the session uses.
	readonly framingId?: string
}

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type TargetCenteringCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/connections/:id/cameras/:deviceId/target-centering.
export interface TargetCenteringRequest extends CommandRequest {
	// Mount to center, by its exact connection and device ids.
	readonly mount: OperationDevice
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
	// Largest correction a session makes by itself, in radians; a larger one ends it, and it is also how far a Recenter stands
	// from its target before it slews.
	readonly maximumCorrection: Angle
	// Whether a frame an assisted solve left without a solution is searched again over the whole sky, with the same provider.
	readonly blindRetry: boolean
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
export type TargetCenteringStep = 'slewing' | CenteringStep

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
export type TargetCenteringRefusal = 'correctionRefused' | 'belowHorizon' | 'tooLarge' | 'pierSide' | 'parked' | 'unsupported'

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
	// Plate solver of every frame.
	readonly provider: PlateSolverProvider
	// What the session is doing.
	readonly state: TargetCenteringState
	// Step while running.
	readonly step?: TargetCenteringStep
	// Iterations so far, latest last; at most the frames of the request.
	readonly attempts: readonly TargetCenteringAttempt[]
	// Pointing model that corrected the first slew, when one did.
	readonly model?: { readonly modelId: string; readonly revisionId: string }
	// Whether the session started the tracking of a mount that was not tracking; absent when it was already on.
	readonly trackingStarted?: boolean
	// Whether the tracking the session started was stopped because the session did not succeed; absent otherwise.
	readonly trackingStopped?: boolean
	// Progress of the frame being exposed, as the driver reports it (times in microseconds, progress in percent).
	readonly exposure?: CameraCaptureTime
	// Whether a solution taken after the last motion lies within tolerance; only this proves a position.
	readonly positionVerified: boolean
	// Whether the session leaves everything ready to go on acquiring, which takes a verified position.
	readonly readyForImaging: boolean
	// Distance of the latest solution from the target, in radians; absent before one.
	readonly finalSeparation?: Angle
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

// Longest wait for one solve, queue included, in seconds; the provider's own timeout normally ends it first.
const SOLVE_TIMEOUT = 600

// Watchdog after an aborted solve before it is reported unresponsive, in seconds.
const SOLVE_ABORT_GRACE = 10

// Corrections in a row that did not get closer before a session gives up, instead of spending its frames; provisional.
const STALL_LIMIT = 2

// Warnings kept per session.
const MAXIMUM_WARNINGS = 20

// A session while its service knows it.
interface Session {
	summary: TargetCenteringSessionSummary
	// Camera of the session.
	readonly camera: Camera
	// Mount of the session.
	readonly mount: Mount
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
	// What the operator asked for the operation being cancelled.
	intent?: 'stop'
	// Operation holding the devices, while one runs.
	handle?: OperationHandle<boolean>
}

// Guiding, as far as a session depends on it.
export type TargetCenteringGuiding = Pick<GuidingSessions, 'outputInUse' | 'hold'>

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
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session of each operation a command token started, so a repeated start answers it.
	readonly #byOperation = new Map<string, Session>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every session,
	// mounts sends the first slew and judges each motion, commander runs the corrections and the tracking (the one of the mount
	// commands), capturer takes the frames (the one of the capture service), images receives the frames, frames records them as
	// the latest frame of their camera and closes them, plateSolving solves them, guiding tells whether the mount is being
	// guided, and listener receives every session change synchronously. auxiliaryDir is the parent of the temporary directory
	// of each session.
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
	) {}

	// Returns the latest session of every camera.
	snapshot(): TargetCenteringSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with the complete record of a session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json({ ...session.summary, solutions: Object.fromEntries(session.solutions) } satisfies TargetCenteringSession) : notFound('Session')
	}

	// Starts a session. Responds 202 with TargetCenteringStartResponse once accepted (a repeated token answers its first
	// session); its progress and outcome arrive as targetCentering:updated and operation:updated events. Responds 404 for an
	// unknown camera or mount; 409 when either device is disconnected or held, the camera has a session that did not end, or
	// guiding may pulse the mount; and 422 when the plate solver is not configured, the mount cannot serve the mode, or the
	// target is below the horizon of the site the mount reports.
	async start(connectionId: string, deviceId: string, request: TargetCenteringRequest): Promise<Response> {
		const repeated = this.#repeated(request.token)
		if (repeated) return this.#accepted(repeated)

		// The provider settings are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.plateSolving.prepare(request.solving)
		if (!preparation) return unsupported('The plate solver is not configured; set it up in Settings → External Tools')

		const raced = this.#repeated(request.token)
		if (raced) return this.#accepted(raced)

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const mount = connectedDevice(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (mount instanceof Response) return mount

		const { mode, target } = request
		const refused = mountRefusal(mount, mode)
		if (refused) return unsupported(refused)

		const observer = observerOf(mount)

		if (mode !== 'verifyOnly') {
			const below = this.mounts.refusal(mount, j2000Target(target.rightAscension, target.declination), observer)
			if (below) return errorResponse(...below)
		}

		if (!this.operations.available(camera) || !this.operations.available(mount)) return busy()

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous && previous.summary.endedAt === undefined) return errorResponse('The camera has a centering session that did not end', 409, 'busy')
		if (this.guiding.outputInUse(request.mount.connectionId)) return errorResponse('Guiding is correcting the mount; stop it before centering', 409, 'guidingActive')

		const { token, ...settings } = request
		const session: Session = {
			summary: {
				sessionId: crypto.randomUUID(),
				operationId: '',
				camera: { connectionId, deviceId },
				cameraName: camera.name,
				mount: request.mount,
				mountName: mount.name,
				request: settings,
				provider: request.solving.provider,
				state: 'preparing',
				attempts: [],
				positionVerified: false,
				readyForImaging: false,
				warnings: mode === 'verifyOnly' && !mount.tracking ? [`${mount.name} is not tracking, so the frames may trail.`] : [],
				startedAt: Date.now(),
				revision: 0,
			},
			camera,
			mount,
			preparation,
			observer,
			solutions: new Map(),
			commanded: false,
			pierSide: mount.pierSide,
			guidingHold: this.guiding.hold(request.mount.connectionId),
		}

		if (previous) this.#byOperation.delete(previous.summary.operationId)
		this.#sessions.set(key, session)

		const record = this.operations.run('mount.targetCentering', [session.summary.camera, session.summary.mount], token, () => {
			const handle = this.#run(session)
			session.handle = handle
			return handle.result
		})

		this.#byOperation.set(record.operationId, session)
		this.#update(session, { operationId: record.operationId })
		void session.handle!.result.then((result) => this.#operationEnded(session, result))
		return this.#accepted(session)
	}

	// Stops a session. Answers at once, because a camera may stay held for minutes while its frame arrives; the end arrives as an
	// event. A blocked session is dismissed. Responds 202, also when it already ended, and 404 for an unknown session.
	stop(sessionId: string): Response {
		const session = this.#find(sessionId)
		if (!session) return notFound('Session')

		if (session.summary.state === 'blocked') this.#finish(session, 'cancelled', false)
		else if (session.summary.endedAt === undefined) {
			session.intent = 'stop'
			this.#update(session, { state: 'stopping', step: undefined, exposure: undefined })
			void session.handle?.cancel('aborted')
		}

		return new Response(null, { status: 202 })
	}

	// Runs a session: the root holds the camera, and its child the mount for all the work. Resolves whether the position was
	// verified; a Verify Only that measured a position out of tolerance succeeds with false.
	#run(session: Session): OperationHandle<boolean> {
		const { camera, mount } = session

		return this.operations.coordinator.start<boolean>('targetCenteringSession', [{ key: resourceKey(camera), device: camera }], async (root) => await root.start<boolean>('targetCenteringMotion', [{ key: resourceKey(mount), device: mount }], (context) => this.#work(session, context)).result)
	}

	// Does the work of a session holding both devices, in a temporary directory removed at the end.
	async #work(session: Session, context: OperationContext): Promise<OperationResult<boolean>> {
		const { mount, camera } = session
		const { mode, target } = session.summary.request
		const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-centering-'))

		try {
			if (mode !== 'verifyOnly' && !mount.tracking) {
				const started = await this.commander.setTracking(context, mount, true)
				if (!started.ok) return started
				this.#update(session, { trackingStarted: true })
			}

			if (this.#slews(session)) {
				const slewed = await this.#slew(session, context)
				if (!slewed.ok) return slewed
			}

			const services = {
				mountCommander: this.commander,
				cameraCapturer: this.capturer,
				solver: (frame: CenteringFrame, signal: AbortSignal) => this.#solve(session, frame, signal),
				auxiliaryPath: (attempt: number) => join(directory, `centering-${attempt}.fit`),
				clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay },
				observer: this.#observer(session),
			}
			const centered = await centerTarget(context, mount, camera, target, this.#options(session), services)

			if (centered.ok) return successfulOperationResult(true)

			// A solve that ran out of time ends the loop before its measurement.
			if (centered.reason === 'timeout') this.#updateAttempt(session, session.summary.attempts.length, { outcome: 'timeout', error: centered.error })

			// Out of tolerance is what a measurement may find, not a failure of it.
			const last = session.summary.attempts.at(-1)
			if (mode === 'verifyOnly' && centered.reason === 'unexpectedState' && last?.separation !== undefined) return successfulOperationResult(false)

			return centered
		} finally {
			await rm(directory, { recursive: true, force: true })
		}
	}

	// Returns whether a session starts with a slew. A Recenter skips it when the mount says it stands within what a correction
	// may reach; what it says is only a reason not to slew, since the position is measured next.
	#slews({ mount, summary: { request } }: Session) {
		if (request.mode !== 'recenter') return request.mode === 'center'
		if (!mount.hasEquatorialCoordinate) return true

		const { rightAscension, declination } = mount.equatorialCoordinate
		const [reportedRightAscension, reportedDeclination] = equatorialToJ2000(rightAscension, declination, timeUnix(Date.now() / 1000))
		return angularDistance(reportedRightAscension, reportedDeclination, request.target.rightAscension, request.target.declination) > request.maximumCorrection
	}

	// Sends the mount to the target of a session and waits for it to settle. Resolves failed for a refusal, which moved nothing.
	async #slew(session: Session, context: OperationContext): Promise<OperationResult<void>> {
		const { mount, observer } = session
		const { rightAscension, declination } = session.summary.request.target

		this.#update(session, { state: 'running', step: 'slewing' })

		const sent = await this.mounts.goToWithin(context, mount, j2000Target(rightAscension, declination), observer, { timeout: SLEW_TIMEOUT })

		if (sent.status === 'refused') {
			this.#update(session, { refusal: refusalOf(sent.code) })
			return failedOperationResult('commandFailed', sent.error)
		}

		if (sent.correction) this.#update(session, { model: sent.correction })
		if (!sent.result.ok) return sent.result

		session.commanded = true
		session.pierSide = mount.pierSide
		this.#update(session, { step: 'settling' })
		return await abortableDelay(session.summary.request.settleDelay * 1000, context.signal)
	}

	// Returns the options of the toolkit's loop for a session. The corrections go to a position measured from the sky, so a model
	// in force is out of their way.
	#options({ summary: { request } }: Session): CenteringOptions {
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
		}
	}

	// Returns the observer of a session's loop.
	#observer(session: Session): CenteringObserver {
		return {
			step: (step, attempt) => {
				if (step === 'exposing') this.#update(session, { state: 'running', step, attempts: [...session.summary.attempts, { attempt }] })
				else this.#update(session, { step, exposure: undefined })
			},
			measured: (measurement) => this.#measured(session, measurement),
			captureListener: exposureProgressListener((exposure) => this.#update(session, { exposure })),
			beforeCorrection: (correction) => this.#beforeCorrection(session, correction),
		}
	}

	// Records what a frame measured.
	#measured(session: Session, { attempt, solution, separation, dx, dy }: CenteringMeasurement) {
		if (!solution) {
			const known = session.summary.attempts.find((each) => each.attempt === attempt)
			if (known?.outcome === undefined) this.#updateAttempt(session, attempt, { outcome: 'noSolution' })
			return
		}

		session.solutions.set(attempt, solution)
		this.#updateAttempt(session, attempt, { outcome: 'solved', solved: { rightAscension: solution.rightAscension, declination: solution.declination }, separation, dx, dy })
		this.#update(session, { finalSeparation: separation })
	}

	// Decides whether a correction may go, and records it when it does. Returns why it may not.
	#beforeCorrection(session: Session, { attempt, separation, rightAscension, declination }: CenteringCorrection) {
		const { mount, observer } = session
		const { maximumCorrection } = session.summary.request

		const refuse = (refusal: TargetCenteringRefusal, error: string) => {
			this.#update(session, { refusal })
			return error
		}

		if (mount.parked || mount.parking) return refuse('parked', `${mount.name} was parked`)
		if (mount.pierSide !== session.pierSide && mount.pierSide !== 'NEITHER' && session.pierSide !== 'NEITHER') return refuse('pierSide', `${mount.name} changed pier side during the session`)
		if (separation > maximumCorrection) return refuse('tooLarge', `The correction of ${(toArcsec(separation) / 60).toFixed(1)}′ is over the maximum of ${(toArcsec(maximumCorrection) / 60).toFixed(1)}′; center again to slew there`)

		const refused = this.mounts.refusal(mount, j2000Target(rightAscension, declination), observer)
		if (refused) return refuse(refusalOf(refused[2]), refused[0])

		this.#updateAttempt(session, attempt, { correction: { rightAscension, declination } })
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
	async #operationEnded(session: Session, result: OperationResult<boolean>) {
		const { mount, intent } = session
		session.handle = undefined
		session.guidingHold?.[Symbol.dispose]()
		session.guidingHold = undefined

		if (result.ok) return this.#finish(session, 'completed', result.value)

		const failure = { reason: result.reason, ...(result.error !== undefined && { error: result.error }) }

		if (mount.connected && !isDeviceQuiescent(mount)) return this.#update(session, { state: 'blocked', step: undefined, exposure: undefined, reason: result.reason, error: `${mount.name} could not be confirmed stopped` })

		if (session.summary.trackingStarted) {
			const stopped = !mount.tracking || (mount.connected && this.operations.available(mount) && (await this.commander.setTracking(this.operations.coordinator, mount, false)).ok)
			if (stopped) this.#update(session, { trackingStopped: true })
			else this.#warn(session, `The tracking of ${mount.name} that the session started was left on.`)
		}

		return this.#finish(session, intent === 'stop' || result.reason === 'aborted' ? 'cancelled' : 'failed', false, failure)
	}

	// Ends a session in a state.
	#finish(session: Session, state: Extract<TargetCenteringState, 'completed' | 'failed' | 'cancelled'>, positionVerified: boolean, failure?: Pick<TargetCenteringSessionSummary, 'reason' | 'error'>) {
		this.#update(session, { state, step: undefined, exposure: undefined, positionVerified, readyForImaging: positionVerified, endedAt: Date.now(), ...failure })
	}

	// Returns the session of a token already used.
	#repeated(token: string) {
		const known = this.operations.started(token)
		return known && this.#byOperation.get(known.operationId)
	}

	// Responds that a session was accepted.
	#accepted({ summary: { sessionId, operationId } }: Session) {
		return Response.json({ sessionId, operationId } satisfies TargetCenteringStartResponse, { status: 202 })
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

	// Replaces fields of one attempt of a session.
	#updateAttempt(session: Session, attempt: number, patch: Partial<TargetCenteringAttempt>) {
		this.#update(session, { attempts: session.summary.attempts.map((each) => (each.attempt === attempt ? { ...each, ...patch } : each)) })
	}

	// Publishes a changed session with the next revision.
	#update(session: Session, patch: Partial<TargetCenteringSessionSummary>) {
		session.summary = { ...session.summary, ...patch, revision: session.summary.revision + 1 }
		this.listener({ type: 'targetCentering:updated', session: session.summary })
	}
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
