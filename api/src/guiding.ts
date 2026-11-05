import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { AstapError, astapDetectStars } from 'nebulosa/src/astrometry/solvers/astap'
import type { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager/device'
import type { BlobEncoding } from 'nebulosa/src/devices/indi/types'
import { failedOperationResult, type OperationFailureReason, type OperationResult, type OperationScope, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { Image } from 'nebulosa/src/imaging/model/types'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import type { CameraCaptureTime } from 'nebulosa/src/observation/capture/types'
import { DEFAULT_GUIDING_CALIBRATOR_CONFIG, type GuidingCalibrationConfig, type GuidingCalibrationDiagnostics, type GuidingCalibrationPhase } from 'nebulosa/src/observation/guiding/calibrator'
import { GuiderClient, type GuideFrameImage, type GuiderClientConnectOptions, type GuiderClientGuiderOptions, type GuiderClientOptions } from 'nebulosa/src/observation/guiding/client'
import type { DitherAmount } from 'nebulosa/src/observation/guiding/ditherer'
import type { GuiderState, GuidingEvent } from 'nebulosa/src/observation/guiding/events'
import type { GuidingSettle } from 'nebulosa/src/observation/guiding/session'
import { InteractiveGuidingSession, type GuidingPauseMode } from 'nebulosa/src/observation/guiding/session.interactive'
import { enrichGuideStars, type GuideStar, type GuidingMode, StarTracker, starTrackingOf } from 'nebulosa/src/observation/guiding/tracker.star'
import { CameraSessionRegistry } from './camerasessions'
import type { CaptureFrameRegistry } from './captureframes'
import type { CaptureFrame, CaptureSettings, CaptureSnoop } from './captures'
import { type ClientResolver, type CommandRefusal, type CommandRequest, failureResponse, notFound, refusal, refusalResponse, resolveConnected } from './commands'
import type { DeviceRegistry } from './devices'
import type { ExternalToolsStore, ResolvedExternalTool } from './externaltools'
import type { GuideRegions } from './guideregions'
import { guideStarProfile, type GuidingStarProfile } from './guidingprofile'
import { errorResponse } from './http'
import type { ImageStore } from './images'
import type { OperationDevice, OperationRegistry, ToolInvocation } from './operations'
import type { BuiltinStarDetectionSettings, StarDetectionSettings } from './stars'

// Guiding service: one native guiding session per guide camera, from its first looped exposure to its stop, built on the
// toolkit's InteractiveGuidingSession over a GuiderClient of its own. The session's root operation holds the guide
// camera and is published as camera.guiding; while guiding, its run also holds the guide output (the mount or camera
// behind it) and the mount it drives, the MOUNT of the Equipment Setup the request names, atomically, and is published as
// guideOutput.guiding, so manual pulses, nudges and slews of that mount are refused only then, even when the guide output
// is the ST4 port of a camera, which shares no device with the mount. The
// service never decides a guiding state: it only forwards commands to the session, publishes its snapshot, its native
// events and its per-frame telemetry, and previews its frames.
//
// Each guide BLOB is decoded on a worker thread of the session (guiding.worker.ts), which also takes the grayscale copy,
// detects its stars with the built-in detector and the settings of the request (while guiding, only in the regions
// around the stars the guider uses; see guidingRegions), and answers both with the FITS/XISF bytes; a session that
// detects with ASTAP has the worker decode only and runs ASTAP on the frame file here, about half a second per frame.
// The stars feed the tracker synchronously, and the guide star of each frame is profiled on its grayscale copy
// (guidingprofile.ts) into the record, with the progress of the exposure the camera counts down. The bytes of
// the newest frame are opened as a capture document of the image store and recorded in the capture frame registry as
// the latest frame of the camera (origin guiding, never saved), with its overlay published once the document is open;
// only the newest frame waits while another one is opened, so previewing never holds the guiding back. A session
// belongs to the server: it survives tab reloads and workspace changes and ends only by its stop route or the loss of
// a device; its record is kept in memory until the next session of the same camera. Exposures are milliseconds,
// positions and distances guide-image pixels from the top-left of the full frame, pulse durations milliseconds, dither
// angles radians, settle tolerances guide pixels and settle times seconds.
//
// A service composing tools inside the process admits a session (admit) under the ToolInvocation of the reservation it
// holds: the root of the session and every run, command, and stop of it then acquire inside the reservation, through
// its token scope, the toolkit's exception for a root a service keeps of its own; whoever commands the session (that
// caller or a tab) commands it there. Each durable command is admitted too (admitStartGuiding, admitDither, ...), with
// the outcome of that exact command, which the single command of the record cannot keep once a newer one replaced it.
// rootOf names the root a drain of the reservation preserves so guiding outlives the interruption of the other work.

// Sensor settings of the guide exposures, sent once when the session starts. The frame type is always LIGHT.
export type GuidingCameraSettings = Pick<CaptureSettings, 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Settings of the guider client, fixed when the session starts: the dither pattern, the side of the star search square
// in pixels (clamped by the toolkit to [16, 128], 64 when absent), whether the lock position stays exactly where it is
// across guider re-initialization, and whether a meridian flip of the calibration also reverses the DEC output.
export type GuidingClientSettings = Pick<GuiderClientOptions, 'ditherMode' | 'searchRegion' | 'stickyLockPosition' | 'fastRecenter' | 'reverseDecOutputAfterMeridianFlip'>

// Body of POST /api/connections/:id/cameras/:deviceId/guiding.
export interface GuidingStartRequest extends CommandRequest {
	// Guide output the session guides with, by its exact connection and device ids.
	readonly guideOutput: OperationDevice
	// Mount the guide output drives (the MOUNT of the Equipment Setup), held with the guide output while guiding; absent
	// when the setup has none.
	readonly mount?: OperationDevice
	// Guide exposure, in milliseconds.
	readonly exposure: number
	// Sensor settings of the guide exposures.
	readonly camera: GuidingCameraSettings
	// Whether the tracker measures one star or many.
	readonly trackingMode: GuidingMode
	// Optics of the guide camera, for the pixel scale of angular dithers and arcsecond RMS.
	readonly optics?: GuiderClientConnectOptions
	// Overrides of the calibration state machine.
	readonly calibration?: Partial<GuidingCalibrationConfig>
	// Overrides of the guide controller.
	readonly guider?: GuiderClientGuiderOptions
	// Settings of the guider client; absent keeps the toolkit defaults.
	readonly client?: GuidingClientSettings
	// Devices of the camera's connection snooped into the guide frame headers, set once when the session starts; absent
	// snoops none. A simulated camera renders its star field from the pointing of the snooped mount.
	readonly snoop?: CaptureSnoop
	// Star detector of the guide frames and its settings, as the Star Detection of the profile edits them; absent uses
	// the built-in detector with its defaults. The tracker filters the detected stars by its own thresholds.
	readonly detection?: StarDetectionSettings
}

// Body of POST /api/guiding/:sessionId/start.
export interface GuidingStartGuidingRequest extends CommandRequest {
	// Whether to calibrate again before guiding instead of reusing the solved calibration.
	readonly recalibrate: boolean
	// Settle the start waits for.
	readonly settle: GuidingSettle
}

// Body of POST /api/guiding/:sessionId/pause.
export interface GuidingPauseRequest extends CommandRequest {
	// Whether only the corrections pause, or the exposures too.
	readonly mode: GuidingPauseMode
}

// Body of POST /api/guiding/:sessionId/resume.
export interface GuidingResumeRequest extends CommandRequest {
	// Settle the resume waits for.
	readonly settle: GuidingSettle
}

// Body of POST /api/guiding/:sessionId/dither.
export interface GuidingDitherRequest extends CommandRequest {
	// Amount, in guide pixels or as an angle in radians.
	readonly amount: DitherAmount
	// Whether the dither moves the RA axis only.
	readonly raOnly: boolean
	// Settle the dither waits for.
	readonly settle: GuidingSettle
}

// Body of POST /api/guiding/:sessionId/target.
export interface GuidingTargetRequest {
	// Pixel of the current guide frame to select the nearest star of; absent selects the best star the tracker offers.
	readonly position?: readonly [number, number]
}

// Body of POST /api/guiding/:sessionId/exposure.
export interface GuidingExposureRequest {
	// Guide exposure of the next frames, in milliseconds.
	readonly exposure: number
}

// Durable command of a session.
export type GuidingCommand = 'startGuiding' | 'stopGuiding' | 'pause' | 'resume' | 'dither'

// Latest durable command of a session and its outcome.
export interface GuidingCommandStatus {
	// Id of the command, answered by its route.
	readonly commandId: string
	readonly command: GuidingCommand
	readonly state: 'running' | 'succeeded' | 'failed'
	// Why the command failed; present only when it did.
	readonly reason?: OperationFailureReason
	// Detail of the failure, meant for people.
	readonly error?: string
}

// Solved calibration of a session.
export interface GuidingCalibrationSummary {
	// Number of the solution within the session, from 1.
	readonly calibrationId: number
	// Image motion of a pulse, in pixels per millisecond, along the RA and DEC axes.
	readonly raRate: number
	readonly decRate: number
	// Direction of the image motion of each axis, in radians from the image X axis.
	readonly raAngle: number
	readonly decAngle: number
	// Measured DEC backlash, in milliseconds.
	readonly backlash: number
	// Calibration warnings meant for people.
	readonly warnings: readonly string[]
}

// Progress of a running calibration, from the diagnostics of its latest frame: the phase, and for each leg the steps
// taken against their limit and the travel in guide pixels against what the leg needs. The RA leg ends once the star
// moved raTarget pixels, the DEC leg once it moved decTarget pixels past the backlash, and the clearing once the star is
// back within clearingTarget pixels of the start; a leg that reaches its step limit first fails the calibration. With
// decReturn, the solved calibration then brings the star back south toward the start, which never fails it.
export interface GuidingCalibrationProgress {
	readonly phase: GuidingCalibrationPhase
	// RA forward steps taken, and their limit.
	readonly raSteps: number
	readonly maxRaSteps: number
	// Net RA travel, and the travel the leg needs, in pixels.
	readonly raDistance: number
	readonly raTarget: number
	// RA steps back toward the start, and their limit.
	readonly clearingSteps: number
	readonly maxClearingSteps: number
	// Distance from the start while clearing, where the clearing left the star once the DEC leg began, and the distance
	// that completes it, in pixels.
	readonly clearingDistance: number
	readonly clearingTarget: number
	// DEC forward steps taken, and their limit.
	readonly decSteps: number
	readonly maxDecSteps: number
	// Net DEC travel, and the travel the leg needs, in pixels.
	readonly decDistance: number
	readonly decTarget: number
	// Whether the calibration returns along DEC once solved, the DEC return pulses taken so far, nudges included, and the
	// current distance from the start, in pixels.
	readonly decReturn: boolean
	readonly decReturnSteps: number
	readonly decReturnDistance: number
	// Whether the DEC motion started past the backlash, and the backlash estimated so far, in milliseconds.
	readonly decMoving: boolean
	readonly backlash: number
	// Consecutive frames without a usable measurement, and how many fail the calibration.
	readonly badFrames: number
	readonly maxBadFrames: number
}

// Root-mean-square guide error over the latest measured guide steps, in guide pixels.
export interface GuidingRms {
	readonly ra: number
	readonly dec: number
	// sqrt(ra² + dec²).
	readonly total: number
	// Guide steps the window holds, at most GUIDING_RMS_WINDOW.
	readonly samples: number
}

// A guide run stopped for the motion of another service.
export interface GuidingSuspension {
	// Session whose run was stopped.
	readonly sessionId: string
	// Command that stopped it, the latest of the session until someone else commands it.
	readonly commandId: string
	// Settle guiding is restored with: the one it started with.
	readonly settle: GuidingSettle
}

// What became of a guide run after a motion: guiding again, not restored, or left alone because the session is no longer as
// the motion left it.
export type GuidingRestoration = 'restored' | 'failed' | 'externallyChanged'

// Session record published to clients.
export interface GuidingSessionSummary {
	readonly sessionId: string
	// Id of the camera.guiding operation holding the guide camera.
	readonly operationId: string
	// Id of the guideOutput.guiding operation holding the guide output while guiding.
	readonly runOperationId?: string
	readonly camera: OperationDevice
	readonly cameraName: string
	readonly guideOutput: OperationDevice
	readonly guideOutputName: string
	// Mount the guide output drives, held with it while guiding; absent when the request named none.
	readonly mount?: OperationDevice
	// Increases whenever the record changes.
	readonly revision: number
	// Whether the session lives.
	readonly active: boolean
	// Whether it ended by losing a device.
	readonly lost: boolean
	// Why it ended, when it did not end by its stop route.
	readonly failure?: { readonly reason: OperationFailureReason; readonly error?: string }
	// State of the guider.
	readonly state: GuiderState
	// Whether the run holds the guide output.
	readonly guideOutputHeld: boolean
	// Whether pulses may be sent.
	readonly pulsesAdmitted: boolean
	readonly settling: boolean
	readonly dithering: boolean
	readonly calibrated: boolean
	// Current lock position, in guide-image pixels.
	readonly lockPosition?: readonly [number, number]
	// Guide exposure, in milliseconds.
	readonly exposure: number
	// Arcseconds per guide-image pixel; absent while the optics or the pixel size are unknown.
	readonly pixelScale?: number
	readonly calibration?: GuidingCalibrationSummary
	// Progress of the calibration while one runs; absent otherwise.
	readonly calibrating?: GuidingCalibrationProgress
	readonly rms?: GuidingRms
	// Progress of the guide exposure the camera counts down, in microseconds (progress in percent); absent between
	// exposures and while the driver reports none.
	readonly exposureProgress?: CameraCaptureTime
	// Profile of the guide star of the latest measured frame; absent before one.
	readonly star?: GuidingStarProfile
	// Latest guide frame, with its capture document once previewed.
	readonly frame?: { readonly frameId: number; readonly time: number; readonly imageId?: string }
	readonly command?: GuidingCommandStatus
	// Sequence of the latest control event and cursor of the latest telemetry sample.
	readonly eventSequence: number
	readonly telemetryCursor: number
	// Instants the session started and ended, Unix milliseconds (UTC).
	readonly startedAt: number
	readonly endedAt?: number
}

// One control event of a session: every native guider event except the per-frame ones (guide steps, looping frames,
// lost stars, calibration steps and settle progress), which the telemetry and the record carry.
export interface GuidingEventRecord {
	// Position in the session, from 1, without gaps.
	readonly sequence: number
	readonly event: GuidingEvent
}

// Correction of one axis in a telemetry sample.
export interface GuidingTelemetryAxis {
	readonly direction?: string
	// Issued pulse, in whole milliseconds; 0 for none.
	readonly duration: number
	// Whether it reached the per-axis maximum.
	readonly limited: boolean
}

// Per-frame telemetry of a guiding frame: a measured guide step, or a frame the star was lost in.
export interface GuidingTelemetrySample {
	// Position in the session, from 1, without gaps.
	readonly cursor: number
	readonly frameId: number
	// Instant of the event, Unix milliseconds (UTC).
	readonly timestamp: number
	// Whether the star could not be measured; the distances and pulses are then 0.
	readonly lost: boolean
	// Image-space error, in pixels.
	readonly dx: number
	readonly dy: number
	// Error along the RA and DEC axes, in pixels.
	readonly raDistance: number
	readonly decDistance: number
	readonly ra: GuidingTelemetryAxis
	readonly dec: GuidingTelemetryAxis
	readonly snr: number
	readonly mass: number
	// Half-flux diameter, in pixels.
	readonly hfd: number
}

// Overlay of one guide frame, in pixels of the full decoded frame from its top-left.
export interface GuidingFrameOverlay {
	readonly frameId: number
	readonly state: GuiderState
	readonly lockPosition?: readonly [number, number]
	readonly searchPosition?: readonly [number, number]
	// Side of the search square, in pixels.
	readonly searchRegion: number
	readonly measurement?: readonly [number, number]
	readonly primary?: readonly [number, number]
	// Detected stars, accepted or rejected by the tracker filters, with their half-flux diameter in pixels.
	readonly stars: readonly { readonly x: number; readonly y: number; readonly hfd: number; readonly accepted: boolean }[]
}

// Snapshot of GET /api/guiding: the latest session of every guide camera.
export interface GuidingSnapshot {
	readonly sessions: readonly GuidingSessionSummary[]
}

// Bounded tail of GET /api/guiding/:sessionId/events or /telemetry after a position.
export interface GuidingPage<T> {
	readonly items: readonly T[]
	// Whether older items after the requested position were already forgotten.
	readonly truncated: boolean
}

// Response of an accepted session.
export interface GuidingStartResponse {
	readonly sessionId: string
	// Id of the camera.guiding operation.
	readonly operationId: string
}

// Response of an accepted durable command.
export interface GuidingCommandAccepted {
	readonly commandId: string
}

// Session admitted inside the process: its identity and its end.
export interface GuidingAdmitted {
	readonly ok: true
	// Id of the session, repeated by its guiding events.
	readonly sessionId: string
	// Id of the camera.guiding operation holding the guide camera.
	readonly operationId: string
	// Whether the token had already started the session, which this request did not start again.
	readonly repeated: boolean
	// Final summary once the session ended, by its stop or the loss of a device. Never rejects.
	readonly ended: Promise<GuidingSessionSummary>
}

// Outcome of asking for a session inside the process: the session admitted, or why it was refused.
export type GuidingAdmission = GuidingAdmitted | CommandRefusal

// Durable command admitted inside the process: its identity and its outcome.
export interface GuidingCommandAdmitted {
	readonly ok: true
	// Id of the command, as its route answers it.
	readonly commandId: string
	// Whether the token had already started the command, which this request did not start again.
	readonly repeated: boolean
	// Outcome of this command once it settled (a dither once settled, a stop once the guide output was proven at rest),
	// whatever command the record shows by then. Never rejects.
	readonly settled: Promise<GuidingCommandStatus>
}

// Outcome of asking for a durable command inside the process: the command admitted, or why it was refused.
export type GuidingCommandAdmission = GuidingCommandAdmitted | CommandRefusal

// Dither commands of a session given to one claimant inside the process (see GuidingSessions.claimDither). Never
// serialized; disposing it gives the dither commands back.
export interface GuidingDitherClaim extends Disposable {
	readonly ok: true
	// Admits a dither of the claimed session, as admitDither does.
	readonly admitDither: (request: GuidingDitherRequest) => GuidingCommandAdmission
}

// Identity of the claimant of the dither commands of a session; compared by object.
interface DitherClaimOwner {
	// Feature that claimed them, meant for people, such as "Camera Acquisition".
	readonly holder: string
}

// Notifications of the guiding sessions.
export type GuidingServerEvent =
	| { readonly type: 'guiding:updated'; readonly session: GuidingSessionSummary }
	| { readonly type: 'guiding:event'; readonly sessionId: string; readonly record: GuidingEventRecord }
	| { readonly type: 'guiding:telemetry'; readonly sessionId: string; readonly sample: GuidingTelemetrySample }
	| { readonly type: 'guiding:frame'; readonly sessionId: string; readonly frameId: number; readonly imageId: string; readonly overlay: GuidingFrameOverlay }

// Receiver of the guiding notifications.
export type GuidingListener = (event: GuidingServerEvent) => void

// Request to the guide frame worker: one BLOB, transferred.
export interface GuidingWorkerRequest {
	readonly jobId: number
	readonly bytes: Uint8Array<ArrayBuffer>
	readonly encoding: BlobEncoding
	// Settings of the built-in detector the worker detects the stars with; absent decodes only, for ASTAP.
	readonly detection?: Partial<Omit<BuiltinStarDetectionSettings, 'provider'>>
	// Regions the built-in detector is limited to; absent detects the whole frame.
	readonly regions?: GuideRegions
}

// Answer of the guide frame worker.
export type GuidingWorkerResponse =
	| { readonly jobId: number; readonly status: 'decoded'; readonly image: Image; readonly stars: readonly GuideStar[]; readonly bytes: Uint8Array<ArrayBuffer> }
	| { readonly jobId: number; readonly status: 'unsupported' }
	| { readonly jobId: number; readonly status: 'failed'; readonly error: string }

// Control events a session keeps, the newest first to go.
const MAX_EVENTS = 500

// Telemetry samples a session keeps, about half an hour at one frame per second.
const MAX_TELEMETRY = 2000

// Durable command tokens a session remembers, so a repeated request answers its first command.
const MAX_TOKENS = 64

// Settle of guiding restored after a motion when the session never asked for one; provisional.
const RESTORE_SETTLE: GuidingSettle = { pixels: 1.5, time: 10, timeout: 60 }

// Guide frames awaited after a motion before a star is selected on them.
const RESTORE_FRAMES = 2

// Longest wait for those frames beyond their exposures, in milliseconds.
const RESTORE_FRAMES_TIMEOUT = 30000

// Interval between the checks for those frames, in milliseconds.
const RESTORE_FRAMES_POLL = 100

// Commands that let a guide output send pulses, refused while a hold keeps guiding off a mount.
const HELD_COMMANDS: ReadonlySet<GuidingCommand> = new Set<GuidingCommand>(['startGuiding', 'resume', 'dither'])

// Identity of a guide output in the holds and the runs: its exact connection and device ids.
function guideOutputKey({ connectionId, deviceId }: OperationDevice) {
	return `${connectionId}:${deviceId}`
}

// Guide steps the RMS is computed over.
export const GUIDING_RMS_WINDOW = 50

// Accepted stars of the previous frame, by decreasing SNR, whose regions the built-in detection is limited to while
// guiding; with the measured position and the lock they are the reference stars of the next frame. PHD2 guides on up to
// 9 secondary stars; 16 keep the field measurement averaged over many stars at a fraction of the frame.
export const GUIDING_REGION_STARS = 16

// Half side of the region around each used star, in pixels: twice the 12-pixel frame jump the guider accepts, so a
// star that moved as far as the guider still trusts stays inside.
export const GUIDING_REGION_RADIUS = 24

// Native events carried only by the telemetry or the record, never as control events.
const PER_FRAME_EVENTS: ReadonlySet<GuidingEvent['type']> = new Set(['guideStep', 'loopingFrame', 'starLost', 'calibrationStep', 'settling'])

// Bytes of a frame waiting to be previewed.
interface PendingPreview {
	readonly frameId: number
	readonly time: number
	readonly bytes: Uint8Array<ArrayBuffer>
	readonly overlay: GuidingFrameOverlay
}

// Guide frame worker of a session, created on the first frame and again after a crash.
class GuideFrameDecoder implements Disposable {
	#worker?: Worker
	#jobs = 0
	readonly #pending = new Map<number, PromiseWithResolvers<GuidingWorkerResponse>>()

	// Decodes one BLOB on the worker, and detects its stars with the built-in detection given. Rejects when the worker
	// crashes or was disposed.
	decode(data: Buffer, encoding: BlobEncoding, detection: GuidingWorkerRequest['detection'], regions: GuideRegions | undefined): Promise<GuidingWorkerResponse> {
		const jobId = ++this.#jobs
		const pending = Promise.withResolvers<GuidingWorkerResponse>()
		this.#pending.set(jobId, pending)
		const bytes = new Uint8Array(data)
		this.#ensure().postMessage({ jobId, bytes, encoding, detection, ...(regions && { regions }) } satisfies GuidingWorkerRequest, [bytes.buffer])
		return pending.promise
	}

	// Terminates the worker and rejects what it was doing.
	[Symbol.dispose]() {
		this.#worker?.terminate()
		this.#worker = undefined
		this.#fail(new Error('the guide frame worker was stopped'))
	}

	#ensure() {
		if (this.#worker) return this.#worker

		const worker = new Worker(process.env.NEBULOSA_GUIDING_WORKER ?? new URL('./guiding.worker.ts', import.meta.url))
		worker.addEventListener('message', (event: MessageEvent<GuidingWorkerResponse>) => {
			const pending = this.#pending.get(event.data.jobId)
			this.#pending.delete(event.data.jobId)
			pending?.resolve(event.data)
		})
		worker.addEventListener('error', (event) => {
			if (this.#worker === worker) this.#worker = undefined
			worker.terminate()
			this.#fail(new Error(`the guide frame worker crashed: ${event.message}`))
		})
		this.#worker = worker
		return worker
	}

	#fail(error: Error) {
		for (const pending of this.#pending.values()) pending.reject(error)
		this.#pending.clear()
	}
}

// A session while its service knows it.
interface Session {
	summary: GuidingSessionSummary
	readonly client: GuiderClient
	readonly interactive: InteractiveGuidingSession
	readonly decoder: GuideFrameDecoder
	readonly camera: Camera
	readonly guideOutput: GuideOutput
	// Stars and file bytes of each decoded image, until its frame is processed.
	readonly detections: WeakMap<Image, readonly GuideStar[]>
	readonly files: WeakMap<Image, Uint8Array<ArrayBuffer>>
	readonly events: GuidingEventRecord[]
	readonly telemetry: GuidingTelemetrySample[]
	// Measured RA and DEC errors of the RMS window, in pixels.
	readonly errors: (readonly [number, number])[]
	// Commands each remembered token started.
	readonly tokens: Map<string, GuidingCommandAdmitted>
	// Ends the camera.guiding record once the session ended.
	readonly ended: PromiseWithResolvers<OperationResult<void>>
	// Resolved with the final summary once the session ended.
	readonly closed: PromiseWithResolvers<GuidingSessionSummary>
	// Scope the root, the runs, and the commands of the session acquire with: the coordinator, or the token scope of the
	// reservation a caller composing tools admitted it under.
	readonly scope: OperationScope
	// Ends the guideOutput.guiding record of the open run.
	run?: { readonly id: string; readonly ended: PromiseWithResolvers<OperationResult<void>> }
	preview: { decoding: boolean; next?: PendingPreview }
	// Whether the session is ending or ended.
	ending: boolean
	calibrations: number
	// Star detector of the frames and its settings, as requested; absent uses the built-in detector's defaults.
	readonly detection?: StarDetectionSettings
	// ASTAP settings and the directory of its input file, when ASTAP detects the stars; the directory is created on the
	// first frame and removed at the end.
	readonly astap?: { readonly tool: Readonly<ResolvedExternalTool>; directory?: Promise<string> }
	// Aborted at the end, so an ASTAP run in flight is killed.
	readonly abort: AbortController
	// Tracker of the guide stars, whose previous result places the regions of the built-in detection.
	readonly tracker: StarTracker
	// Whether the worker detects the stars with the built-in detector.
	readonly builtin: boolean
	// Follows the exposure countdown of the guide camera until the end.
	readonly progress: DeviceHandler<Camera>
	// Calibration settings of the request over the toolkit defaults, whose limits the calibration progress shows.
	readonly calibrator: Readonly<GuidingCalibrationConfig>
	// Settle of the latest Start Guiding, which guiding restored after a motion takes again.
	settle?: GuidingSettle
	// Claimant of the dither commands, while one holds them.
	claim?: DitherClaimOwner
}

// Returns the regions the built-in detection of a session's next frame is limited to, or undefined for the whole frame:
// only while its run holds the guide output (calibrating, guiding, settling, paused) and the previous frame was measured,
// around the measured position, the lock, and the GUIDING_REGION_STARS accepted stars of highest SNR. While looping or
// selecting, and after a frame without measurement, the whole frame is detected, so any star can be chosen or found
// again. A session whose stars ASTAP detects always runs on the whole file. The regions keep only detections from the
// tracker's minimum SNR: the frame quality the guider gates on is the accepted fraction of the detections, and the noise
// peaks of a crop, which the whole frame's brightest-first cap cuts, would otherwise bring every frame under it.
export function guidingRegions(session: Pick<Session, 'builtin' | 'tracker' | 'summary'>): GuideRegions | undefined {
	if (!session.builtin || !session.summary.guideOutputHeld) return undefined
	const result = starTrackingOf(session.tracker.lastResult)
	const measurement = result?.measurement
	if (!result || !measurement) return undefined

	const centers: (readonly [number, number])[] = [[measurement.x, measurement.y]]
	if (session.summary.lockPosition) centers.push(session.summary.lockPosition)
	for (const star of result.accepted.toSorted((a, b) => b.snr - a.snr).slice(0, GUIDING_REGION_STARS)) centers.push([star.x, star.y])
	return { centers, radius: GUIDING_REGION_RADIUS, minSNR: session.tracker.config.filter.minStarSnr }
}

// Guiding sessions of the cameras of every open connection.
export class GuidingSessions implements Disposable {
	// Latest session of each guide camera, and the session each start token started.
	readonly #sessions: CameraSessionRegistry<GuidingSessionSummary, Session>
	// Holds that keep a guide output from starting, by guideOutputKey of the guide output: the name of the holder of each
	// hold, in the order they were taken.
	readonly #holds = new Map<string, string[]>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// session, guideOutputs is the commander the pulses are dispatched through, images receives the previewed frames,
	// frames records them as the latest frame of their camera, tools resolves ASTAP for the sessions that detect their stars
	// with it, and listener receives every notification synchronously.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly guideOutputs: GuideOutputCommander,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly tools: ExternalToolsStore,
		readonly listener: GuidingListener,
	) {
		this.#sessions = new CameraSessionRegistry(operations, (session) => listener({ type: 'guiding:updated', session }))
	}

	// Returns the latest session of every guide camera.
	snapshot(): GuidingSnapshot {
		return { sessions: this.#sessions.summaries() }
	}

	// Responds with a session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json(session.summary) : this.#notFound()
	}

	// Responds with the control events after `after`, at most MAX_EVENTS.
	events(sessionId: string, after: number): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json(page(session.events, (record) => record.sequence, after)) : this.#notFound()
	}

	// Responds with the telemetry samples after `after`, at most MAX_TELEMETRY.
	telemetry(sessionId: string, after: number): Response {
		const session = this.#sessions.find(sessionId)
		return session ? Response.json(page(session.telemetry, (sample) => sample.cursor, after)) : this.#notFound()
	}

	// Starts a session looping on a guide camera. Responds 202 with GuidingStartResponse once accepted (a repeated token
	// answers its first session); its progress arrives as guiding and operation:updated events. Responds 404 for an
	// unknown camera or guide output, 409 when either is disconnected or the camera is held by another operation, and
	// 422 when the guide output cannot pulse guide or the request detects the stars with ASTAP while it is not configured.
	async start(connectionId: string, deviceId: string, request: GuidingStartRequest): Promise<Response> {
		const admitted = await this.admit(connectionId, deviceId, request)
		return admitted.ok ? Response.json({ sessionId: admitted.sessionId, operationId: admitted.operationId } satisfies GuidingStartResponse, { status: 202 }) : refusalResponse(admitted)
	}

	// Admits a session, under the reservation of invocation when given (which must then hold the guide camera and the
	// guide output), and returns its identity and end, or why it was refused, as start answers it. A repeated token
	// answers the session it started, while it is remembered.
	async admit(connectionId: string, deviceId: string, request: GuidingStartRequest, invocation?: ToolInvocation): Promise<GuidingAdmission> {
		const detection = request.detection
		const tool = detection?.provider === 'astap' ? await this.tools.resolve('astap') : undefined
		if (detection?.provider === 'astap' && !tool) return refusal('ASTAP is not configured, so it cannot detect the guide stars', 422, 'unsupported')
		// The built-in detection the worker runs; ASTAP runs here, on the decoded file.
		const builtin = detection?.provider === 'astap' ? undefined : detection === undefined ? {} : { maxStars: detection.maxStars, minSNR: detection.minSNR, searchRegion: detection.searchRegion, ...(detection.maximumRadius !== undefined && { maximumRadius: detection.maximumRadius }) }

		const repeated = this.#sessions.repeated(request.token)
		if (repeated) return admitted(repeated, true)

		const resolvedCamera = resolveConnected(this, connectionId, 'camera', deviceId, 'Camera')
		if (!resolvedCamera.ok) return resolvedCamera
		const resolvedOutput = resolveConnected(this, request.guideOutput.connectionId, 'guideOutput', request.guideOutput.deviceId, 'Guide output')
		if (!resolvedOutput.ok) return resolvedOutput
		const resolvedMount = request.mount && resolveConnected(this, request.mount.connectionId, 'mount', request.mount.deviceId, 'Mount')
		if (resolvedMount && !resolvedMount.ok) return resolvedMount
		const camera = resolvedCamera.device
		const guideOutput = resolvedOutput.device
		const mount = resolvedMount?.device
		if (!guideOutput.canPulseGuide) return refusal(`${guideOutput.name} cannot pulse guide, which guiding needs`, 422, 'unsupported')
		// A manual session takes the guide output and the mount only while guiding; one inside a reservation must find them reserved too.
		const run = mount ? [guideOutput, mount] : [guideOutput]
		if (!this.operations.admits(camera, invocation) || (invocation && !run.every((device) => this.operations.admits(device, invocation)))) return refusal('The device is busy', 409, 'busy')

		const detections = new WeakMap<Image, readonly GuideStar[]>()
		const files = new WeakMap<Image, Uint8Array<ArrayBuffer>>()
		const decoder = new GuideFrameDecoder()
		const tracker = new StarTracker({ mode: request.trackingMode, detector: (image) => detections.get(image) ?? [] })
		const client = new GuiderClient(this.devices.cameras, this.devices.guideOutputs, tracker, {
			decodeImage: async (data, encoding) => {
				const decoded = await decoder.decode(data, encoding, builtin, guidingRegions(session))
				if (decoded.status === 'unsupported') return undefined
				if (decoded.status === 'failed') throw new Error(decoded.error)
				detections.set(decoded.image, session.astap ? await this.#astapStars(session, session.astap, decoded.image, decoded.bytes) : decoded.stars)
				files.set(decoded.image, decoded.bytes)
				return decoded.image
			},
			...request.client,
			calibrator: request.calibration,
			guider: request.guider,
		})
		const interactive = new InteractiveGuidingSession(client, camera, guideOutput, this.guideOutputs, { connect: request.optics, mount })
		const cameraDevice = { connectionId, deviceId }

		const session: Session = {
			summary: {
				sessionId: crypto.randomUUID(),
				operationId: '',
				camera: cameraDevice,
				cameraName: camera.name,
				guideOutput: request.guideOutput,
				guideOutputName: guideOutput.name,
				...(request.mount && { mount: request.mount }),
				revision: 0,
				active: false,
				lost: false,
				state: 'stopped',
				guideOutputHeld: false,
				pulsesAdmitted: false,
				settling: false,
				dithering: false,
				calibrated: false,
				exposure: request.exposure,
				eventSequence: 0,
				telemetryCursor: 0,
				startedAt: Date.now(),
			},
			client,
			interactive,
			decoder,
			camera,
			guideOutput,
			detections,
			files,
			events: [],
			telemetry: [],
			errors: [],
			tokens: new Map(),
			ended: Promise.withResolvers(),
			closed: Promise.withResolvers(),
			scope: this.operations.scope(invocation),
			preview: { decoding: false },
			ending: false,
			calibrations: 0,
			...(detection && { detection }),
			...(tool && { astap: { tool } }),
			abort: new AbortController(),
			tracker,
			builtin: builtin !== undefined,
			calibrator: { ...DEFAULT_GUIDING_CALIBRATOR_CONFIG, ...request.calibration },
			progress: {
				added: () => {},
				removed: () => {},
				updated: (device, property) => {
					if (device === camera && (property === 'exposure' || property === 'exposuring')) this.#update(session, { exposureProgress: exposureProgressOf(camera, session.summary.exposure) })
				},
			},
		}
		this.devices.cameras.addHandler(session.progress)

		client.addHandler({ event: (_, event) => this.#event(session, event), frame: (_, frame) => this.#frame(session, frame) })

		const record = this.operations.run('camera.guiding', [cameraDevice], request.token, async () => {
			this.#snoop(connectionId, camera, request.snoop)
			const configuration = { ...request.camera, frameType: 'LIGHT', transferFormat: 'FITS', compressed: false } as const
			const looped = await interactive.startLoop(session.scope, { exposure: request.exposure, camera: configuration })
			this.#sync(session)
			if (!looped.ok) this.#end(session, looped)
			return await session.ended.promise
		})

		this.#sessions.adopt(resourceKey(camera), session, record.operationId)

		return admitted(session, false)
	}

	// Tells the driver of the guide camera which devices of its connection to stamp into the frame headers. The devices
	// are resolved, never acquired; an id the connection does not have is cleared.
	#snoop(connectionId: string, camera: Camera, snoop: CaptureSnoop | undefined) {
		const client = this.client(connectionId)
		const { mounts, focusers, wheels, rotators } = this.devices
		const mount = snoop?.mount ? mounts.get(client, snoop.mount) : undefined
		const focuser = snoop?.focuser ? focusers.get(client, snoop.focuser) : undefined
		const wheel = snoop?.wheel ? wheels.get(client, snoop.wheel) : undefined
		const rotator = snoop?.rotator ? rotators.get(client, snoop.rotator) : undefined
		this.devices.cameras.snoop(camera, mount, focuser, wheel, rotator)
	}

	// Starts calibrating or guiding the selected (or best) star. Responds 202 with the command id.
	startGuiding(sessionId: string, request: GuidingStartGuidingRequest): Response {
		return commandResponse(this.admitStartGuiding(sessionId, request))
	}

	// Stops the corrections and keeps looping, freeing the guide output. Responds 202 with the command id.
	stopGuiding(sessionId: string, request: CommandRequest): Response {
		return commandResponse(this.admitStopGuiding(sessionId, request))
	}

	// Pauses the corrections, or the exposures too. Responds 202 with the command id.
	pause(sessionId: string, request: GuidingPauseRequest): Response {
		return commandResponse(this.admitPause(sessionId, request))
	}

	// Resumes guiding after a pause. Responds 202 with the command id.
	resume(sessionId: string, request: GuidingResumeRequest): Response {
		return commandResponse(this.admitResume(sessionId, request))
	}

	// Dithers and waits for the guided settle. Responds 202 with the command id.
	dither(sessionId: string, request: GuidingDitherRequest): Response {
		return commandResponse(this.admitDither(sessionId, request))
	}

	// Admits Start Guiding (see startGuiding) and returns the command with its outcome, or its refusal.
	admitStartGuiding(sessionId: string, { token, recalibrate, settle }: GuidingStartGuidingRequest): GuidingCommandAdmission {
		return this.#command(sessionId, token, 'startGuiding', (session) => {
			session.settle = settle
			return session.interactive.startGuiding(session.scope, session.scope, { recalibrate, settle })
		})
	}

	// Admits Stop Guiding (see stopGuiding) and returns the command with its outcome, or its refusal.
	admitStopGuiding(sessionId: string, { token }: CommandRequest): GuidingCommandAdmission {
		return this.#command(sessionId, token, 'stopGuiding', (session) => session.interactive.stopGuiding(session.scope))
	}

	// Admits a pause (see pause) and returns the command with its outcome, or its refusal.
	admitPause(sessionId: string, { token, mode }: GuidingPauseRequest): GuidingCommandAdmission {
		return this.#command(sessionId, token, 'pause', (session) => session.interactive.pause(session.scope, mode))
	}

	// Admits a resume (see resume) and returns the command with its outcome, or its refusal.
	admitResume(sessionId: string, { token, settle }: GuidingResumeRequest): GuidingCommandAdmission {
		return this.#command(sessionId, token, 'resume', (session) => session.interactive.resume(session.scope, settle))
	}

	// Admits a dither (see dither) and returns the command with its outcome once settled, or its refusal.
	admitDither(sessionId: string, request: GuidingDitherRequest): GuidingCommandAdmission {
		return this.#dither(sessionId, request)
	}

	// Admits a dither on behalf of claim (see claimDither), or of nobody.
	#dither(sessionId: string, { token, amount, raOnly, settle }: GuidingDitherRequest, claim?: DitherClaimOwner): GuidingCommandAdmission {
		return this.#command(sessionId, token, 'dither', (session) => session.interactive.dither(session.scope, { amount, raOnly, settle: { kind: 'guided', ...settle } }), claim)
	}

	// Returns the id of the root operation of a living session, which holds its guide camera, or undefined: the root a
	// caller holding the reservation of the session preserves when it drains the reservation (drainByReservationOwner),
	// so the session outlives the interruption of the other work.
	rootOf(sessionId: string): string | undefined {
		const session = this.#living(sessionId)
		return session && this.operations.arbiter.snapshot(resourceKey(session.camera)).owner?.id
	}

	// Selects the target. Responds with its lock position, 404, or 422 when no star could be selected.
	selectTarget(sessionId: string, { position }: GuidingTargetRequest): Response {
		const session = this.#active(sessionId)
		if (session instanceof Response) return session
		const selected = session.interactive.selectTarget(position)
		this.#sync(session)
		return selected.ok ? Response.json({ lockPosition: selected.value }) : failureResponse(selected, 'Selecting the target')
	}

	// Clears the target; 422 while guiding.
	clearTarget(sessionId: string): Response {
		return this.#immediate(sessionId, 'Clearing the target', (session) => session.interactive.clearTarget())
	}

	// Sets the guide exposure of the next frames.
	setExposure(sessionId: string, { exposure }: GuidingExposureRequest): Response {
		return this.#immediate(sessionId, 'Setting the guide exposure', (session) => {
			const set = session.interactive.setExposure(exposure)
			if (set.ok) this.#update(session, { exposure })
			return set
		})
	}

	// Clears the solved calibration; 422 while guiding.
	clearCalibration(sessionId: string): Response {
		return this.#immediate(sessionId, 'Clearing the calibration', (session) => {
			const cleared = session.interactive.clearCalibration()
			if (cleared.ok) this.#update(session, { calibration: undefined })
			return cleared
		})
	}

	// Ends a session: stops guiding (proving the guide output at rest), the exposures and the operation. Responds 204
	// once the guide camera and guide output were released, 404 when the session is unknown or already ended, and 502
	// unknownResult when the end of a pulse could not be observed, the guide output then staying blocked.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#active(sessionId)
		if (session instanceof Response) return session
		const stopped = await session.interactive.stop(session.scope)
		this.#end(session, successfulOperationResult(undefined))
		return stopped.ok ? new Response(null, { status: 204 }) : failureResponse(stopped, 'Stopping the guiding')
	}

	// Returns the sessions whose run holds guideOutput, so they may send pulses through it now. The Equipment Setup says which
	// mount a guide output moves: its GUIDE_OUTPUT moves its MOUNT, whether it is the mount's own port or a camera's ST4.
	runsOn(guideOutput: OperationDevice): readonly GuidingSessionSummary[] {
		const key = guideOutputKey(guideOutput)
		return this.#sessions.summaries().filter((summary) => summary.active && summary.guideOutputHeld && guideOutputKey(summary.guideOutput) === key)
	}

	// Stops the corrections of a session for a motion of another service, keeping its loop and calibration, and resolves once the
	// guide output was released, with what restoreAfterMotion needs; a failure leaves the output as it stands.
	async suspendForMotion(sessionId: string): Promise<OperationResult<GuidingSuspension>> {
		const session = this.#sessions.find(sessionId)
		if (!session?.summary.active) return failedOperationResult('unexpectedState', 'The guiding session ended')

		const commandId = crypto.randomUUID()
		this.#update(session, { command: { commandId, command: 'stopGuiding', state: 'running' } })

		const stopped = await this.#settle(session, commandId, 'stopGuiding', session.interactive.stopGuiding(session.scope))
		if (!stopped.ok) return stopped
		if (session.summary.guideOutputHeld) return failedOperationResult('unexpectedState', 'The guide output was not released')
		return successfulOperationResult({ sessionId, commandId, settle: session.settle ?? RESTORE_SETTLE })
	}

	// Starts guiding again after a motion, if the session is as suspendForMotion left it: the lock pixel no longer means anything
	// after a slew, and the calibration does not follow the declination, so the best star of a frame taken after the motion is
	// selected and the guider recalibrates. Resolves how that went, without rejecting. An abort stops waiting and stops guiding.
	async restoreAfterMotion({ sessionId, commandId, settle }: GuidingSuspension, signal: AbortSignal): Promise<GuidingRestoration> {
		const session = this.#sessions.find(sessionId)
		if (!session?.summary.active || session.summary.guideOutputHeld || session.summary.command?.commandId !== commandId) return 'externallyChanged'

		const cleared = session.interactive.clearTarget()
		this.#sync(session)
		if (!cleared.ok || !(await this.#framesAfterMotion(session, signal))) return 'failed'

		const selected = session.interactive.selectTarget()
		this.#sync(session)
		if (!selected.ok) return 'failed'

		const restoring = crypto.randomUUID()
		this.#update(session, { command: { commandId: restoring, command: 'startGuiding', state: 'running' } })
		const started = this.#settle(session, restoring, 'startGuiding', session.interactive.startGuiding(session.scope, session.scope, { recalibrate: true, settle }))
		const { promise: aborted, resolve } = Promise.withResolvers<undefined>()
		signal.addEventListener('abort', () => resolve(undefined), { once: true })
		if (signal.aborted) resolve(undefined)

		const result = await Promise.race([started, aborted])

		if (!result) {
			await session.interactive.stopGuiding(session.scope)
			this.#sync(session)
			return 'failed'
		}

		return result.ok ? 'restored' : 'failed'
	}

	// Waits for the frames that follow a motion: one more than the exposure in progress, which may have started before the mount
	// stopped. Resolves whether they arrived, false when the session ended, the wait was aborted, or they took too long.
	async #framesAfterMotion(session: Session, signal: AbortSignal) {
		const first = session.summary.frame?.frameId ?? 0
		const deadline = Date.now() + RESTORE_FRAMES_TIMEOUT + (RESTORE_FRAMES + 1) * session.summary.exposure

		while ((session.summary.frame?.frameId ?? 0) < first + RESTORE_FRAMES) {
			if (!session.summary.active || Date.now() > deadline) return false
			const waited = await abortableDelay(RESTORE_FRAMES_POLL, signal)
			if (!waited.ok) return false
		}

		return true
	}

	// Keeps guideOutput from starting to guide until the result is disposed: Start Guiding, resume and dither of the sessions
	// guiding through it are refused as busy, naming holder (a feature name meant for people, such as "Target Centering") as
	// the one moving the mount it drives. Looping, which sends no pulse, goes on. Disposing twice releases once.
	hold(guideOutput: OperationDevice, holder: string): Disposable {
		const key = guideOutputKey(guideOutput)
		this.#holds.set(key, [...(this.#holds.get(key) ?? []), holder])
		let held = true

		return {
			[Symbol.dispose]: () => {
				if (!held) return
				held = false
				const holders = this.#holds.get(key)!
				const remaining = holders.toSpliced(holders.indexOf(holder), 1)
				if (remaining.length === 0) this.#holds.delete(key)
				else this.#holds.set(key, remaining)
			},
		}
	}

	// Gives the dither commands of a living session to one claimant until the claim is disposed: while claimed, a dither
	// admitted without the claim (the manual route, another claimant) is refused as busy, naming holder (a feature name
	// meant for people), and so is a second claim. Corrections, pause, resume and stop are untouched. Returns the claim,
	// whose admitDither is the only one admitted meanwhile, or 404 for a session that is unknown or ended. Disposing twice
	// releases once; a dither already admitted keeps running to its own settle.
	claimDither(sessionId: string, holder: string): GuidingDitherClaim | CommandRefusal {
		const session = this.#living(sessionId)
		if (!session) return refusal('No guiding session is running with this id', 404, 'notFound')
		if (session.claim) return refusal(`${session.claim.holder} is dithering with this guiding session`, 409, 'busy')

		const owner = { holder }
		session.claim = owner

		return {
			ok: true,
			admitDither: (request) => this.#dither(sessionId, request, owner),
			[Symbol.dispose]: () => {
				if (session.claim === owner) session.claim = undefined
			},
		}
	}

	// Returns the record of a session that still lives, or undefined when it is unknown or ended.
	summaryOf(sessionId: string): GuidingSessionSummary | undefined {
		return this.#living(sessionId)?.summary
	}

	// Stops every session.
	[Symbol.dispose]() {
		for (const session of this.#sessions.sessions()) {
			if (!session.summary.active) continue
			void session.interactive.stop(session.scope).then(() => this.#end(session, successfulOperationResult(undefined)))
		}
	}

	// Runs a durable command of a living session and returns it with its outcome, or its refusal; a repeated token answers
	// its first command. Its outcome also arrives as the command of the session record, while no newer command replaced it.
	// A dither of a claimed session is admitted only with its claim.
	#command(sessionId: string, token: string, command: GuidingCommand, run: (session: Session) => Promise<OperationResult<unknown>>, claim?: DitherClaimOwner): GuidingCommandAdmission {
		const session = this.#living(sessionId)
		if (!session) return refusal('No guiding session is running with this id', 404, 'notFound')
		const holders = this.#holds.get(guideOutputKey(session.summary.guideOutput))
		if (HELD_COMMANDS.has(command) && holders) return refusal(`${holders[0]} is moving the mount`, 409, 'busy')
		if (command === 'dither' && session.claim && session.claim !== claim) return refusal(`${session.claim.holder} is dithering with this guiding session`, 409, 'busy')

		const known = session.tokens.get(token)
		if (known) return { ...known, repeated: true }

		const commandId = crypto.randomUUID()
		this.#update(session, { command: { commandId, command, state: 'running' } })

		const settled = this.#settle(session, commandId, command, run(session)).then((result): GuidingCommandStatus => (result.ok ? { commandId, command, state: 'succeeded' } : { commandId, command, state: 'failed', reason: result.reason, ...(result.error !== undefined && { error: result.error }) }))
		const admitted: GuidingCommandAdmitted = { ok: true, commandId, repeated: false, settled }
		session.tokens.set(token, admitted)
		if (session.tokens.size > MAX_TOKENS) session.tokens.delete(session.tokens.keys().next().value!)
		this.#sync(session)
		return admitted
	}

	// Records the outcome of a durable command once it settles, unless a newer command replaced it in the record.
	async #settle<T>(session: Session, commandId: string, command: GuidingCommand, running: Promise<OperationResult<T>>): Promise<OperationResult<T>> {
		let result: OperationResult<T>

		try {
			result = await running
		} catch (error) {
			result = failedOperationResult('commandFailed', Error.isError(error) ? error.message : String(error))
		}

		this.#sync(session)
		if (session.summary.command?.commandId !== commandId) return result
		this.#update(session, { command: result.ok ? { commandId, command, state: 'succeeded' } : { commandId, command, state: 'failed', reason: result.reason, ...(result.error !== undefined && { error: result.error }) } })
		return result
	}

	// Runs an immediate command of a living session and responds 204, or with its failure.
	#immediate(sessionId: string, action: string, run: (session: Session) => OperationResult<unknown>): Response {
		const session = this.#active(sessionId)
		if (session instanceof Response) return session
		const result = run(session)
		this.#sync(session)
		return result.ok ? new Response(null, { status: 204 }) : failureResponse(result, action)
	}

	// Follows one native event of a session: control events are kept and published, guide steps and lost stars become
	// telemetry, and the record follows the snapshot of the session.
	#event(session: Session, event: GuidingEvent) {
		if (event.type === 'guideStep' || event.type === 'starLost') this.#telemetry(session, event)
		else if (event.type === 'calibrationCompleted') this.#calibrated(session, event.calibration)
		else if (event.type === 'calibrationStep') this.#update(session, { calibrating: calibrationProgressOf(event.diagnostics, session.calibrator) })
		else if (event.type === 'guidingStarted' || event.type === 'dithered') session.errors.length = 0

		if (!PER_FRAME_EVENTS.has(event.type)) {
			const record: GuidingEventRecord = { sequence: session.summary.eventSequence + 1, event }
			pushBounded(session.events, record, MAX_EVENTS)
			this.#update(session, { eventSequence: record.sequence })
			this.listener({ type: 'guiding:event', sessionId: session.summary.sessionId, record })
		}

		this.#sync(session)
	}

	// Records the telemetry sample of a guide step or a lost star and updates the RMS.
	#telemetry(session: Session, event: Extract<GuidingEvent, { type: 'guideStep' | 'starLost' }>) {
		const cursor = session.summary.telemetryCursor + 1
		const lost = event.type === 'starLost'
		const none: GuidingTelemetryAxis = { duration: 0, limited: false }
		const sample: GuidingTelemetrySample = lost
			? { cursor, frameId: event.frameId, timestamp: event.timestamp, lost, dx: 0, dy: 0, raDistance: 0, decDistance: 0, ra: none, dec: none, snr: event.snr, mass: event.mass, hfd: event.hfd }
			: {
					cursor,
					frameId: event.frameId,
					timestamp: event.timestamp,
					lost,
					dx: event.dx,
					dy: event.dy,
					raDistance: event.raDistance,
					decDistance: event.decDistance,
					ra: { direction: event.ra.direction, duration: event.ra.duration, limited: event.ra.limited },
					dec: { direction: event.dec.direction, duration: event.dec.duration, limited: event.dec.limited },
					snr: event.snr,
					mass: event.mass,
					hfd: event.hfd,
				}

		pushBounded(session.telemetry, sample, MAX_TELEMETRY)
		// A lost frame has no error of its own, so it leaves a gap rather than a zero in the RMS.
		if (!lost) pushBounded(session.errors, [event.raDistance, event.decDistance], GUIDING_RMS_WINDOW)
		this.#update(session, { telemetryCursor: cursor, rms: rmsOf(session.errors) })
		this.listener({ type: 'guiding:telemetry', sessionId: session.summary.sessionId, sample })
	}

	// Records a solved calibration.
	#calibrated(session: Session, calibration: Extract<GuidingEvent, { type: 'calibrationCompleted' }>['calibration']) {
		const calibrationId = ++session.calibrations
		const { ra, dec, backlash, warnings } = calibration
		this.#update(session, { calibration: { calibrationId, raRate: ra.ratePxPerMs, decRate: dec.ratePxPerMs, raAngle: ra.angle, decAngle: dec.angle, backlash, warnings } })
	}

	// Queues the newest decoded frame of a session for its preview, with its overlay.
	#frame(session: Session, frame: GuideFrameImage) {
		const bytes = session.files.get(frame.image)
		session.files.delete(frame.image)
		session.detections.delete(frame.image)
		const measurement = frame.tracking.measurement
		const star = measurement && guideStarProfile(frame.image, frame.frameId, [measurement.x, measurement.y])
		this.#update(session, { frame: { frameId: frame.frameId, time: frame.timestamp }, ...(star && { star }) })
		if (bytes === undefined) return

		session.preview.next = { frameId: frame.frameId, time: frame.timestamp, bytes, overlay: overlayOf(frame) }
		if (!session.preview.decoding) void this.#preview(session)
	}

	// Opens the waiting frame of a session as the latest frame of its camera, then the one that arrived meanwhile.
	async #preview(session: Session) {
		const { preview } = session
		preview.decoding = true

		for (let next = preview.next; next; next = preview.next) {
			preview.next = undefined
			const { sessionId, camera, cameraName } = session.summary
			const { frameId, time, bytes, overlay } = next

			try {
				const info = await this.images.openCapture(bytes, `${cameraName} guide #${frameId}`, { connectionId: camera.connectionId, deviceId: camera.deviceId, frameId: `${sessionId}:${frameId}`, time })
				const record: CaptureFrame = {
					imageId: info.id,
					sessionId,
					connectionId: camera.connectionId,
					deviceId: camera.deviceId,
					generation: frameId,
					time,
					frameType: 'LIGHT',
					width: info.width,
					height: info.height,
					channels: info.channels,
					cfa: info.cfa,
					bitpix: numericKeyword<number, undefined>(info.header, 'BITPIX', undefined),
					acquisition: info.acquisition,
				}
				// The overlay is published before the frame becomes the latest of the camera, so a tab that switches to it
				// already has what to draw over it.
				this.listener({ type: 'guiding:frame', sessionId, frameId, imageId: info.id, overlay })
				this.frames.previewed(info, record, cameraName, 'guiding')
				if (session.summary.frame?.frameId === frameId) this.#update(session, { frame: { frameId, time, imageId: info.id } })
			} catch (error) {
				console.error('guide frame preview failed:', error)
			}
		}

		preview.decoding = false
	}

	// Brings the record of a session to its snapshot: publishes the changes, tracks the run as a guideOutput.guiding
	// operation while it holds the guide output, and ends the session once it no longer lives.
	#sync(session: Session) {
		const snapshot = session.interactive.snapshot()
		const pixelScale = session.client.getPixelScale()
		this.#update(session, {
			active: snapshot.active,
			lost: snapshot.lost,
			state: snapshot.state,
			guideOutputHeld: snapshot.guideOutputHeld,
			pulsesAdmitted: snapshot.pulsesAdmitted,
			settling: snapshot.settling,
			dithering: snapshot.dithering,
			calibrated: snapshot.calibrated,
			lockPosition: snapshot.lockPosition,
			pixelScale: pixelScale > 0 ? pixelScale : undefined,
			// The progress belongs to the calibration running; it goes once the guider leaves the state.
			...(snapshot.state !== 'calibrating' && { calibrating: undefined }),
		})

		const run = session.run

		if (run !== undefined && run.id !== snapshot.runId) {
			session.run = undefined
			run.ended.resolve(snapshot.lost && snapshot.failure ? failedOperationResult(snapshot.failure.reason, snapshot.failure.detail) : successfulOperationResult(undefined))
			this.#update(session, { runOperationId: undefined })
		}

		if (session.run === undefined && snapshot.runId !== undefined) {
			const ended = Promise.withResolvers<OperationResult<void>>()
			session.run = { id: snapshot.runId, ended }
			const record = this.operations.track('guideOutput.guiding', session.summary.mount ? [session.summary.guideOutput, session.summary.mount] : [session.summary.guideOutput], ended.promise)
			this.#update(session, { runOperationId: record.operationId })
		}

		// Losing a device ended the session on its own; a stop ends it through its route.
		if (snapshot.lost) this.#end(session, failedOperationResult(snapshot.failure?.reason ?? 'disconnected', snapshot.failure?.detail))
	}

	// Ends a session once: disconnects its client, stops its worker and finishes its operation records.
	#end(session: Session, result: OperationResult<void>) {
		// Stopping the client emits events whose handler syncs the record and would end the session again.
		if (session.ending) return
		session.ending = true
		const failure = result.ok ? undefined : { reason: result.reason, ...(result.error !== undefined && { error: result.error }) }
		session.client.stopCapture()
		session.client.disconnect()
		this.devices.cameras.removeHandler(session.progress)
		session.decoder[Symbol.dispose]()
		session.abort.abort()
		if (session.astap?.directory)
			void session.astap.directory.then(
				(directory) => rm(directory, { recursive: true, force: true }),
				() => undefined,
			)
		session.preview.next = undefined
		session.run?.ended.resolve(result)
		session.run = undefined
		this.#update(session, { active: false, guideOutputHeld: false, pulsesAdmitted: false, runOperationId: undefined, exposureProgress: undefined, ...(failure && { failure }), endedAt: Date.now() })
		session.ended.resolve(result)
		session.closed.resolve(session.summary)
	}

	// Detects the stars of a decoded guide frame with ASTAP, from its FITS file written to the session directory, and
	// samples their peaks on the grayscale image for the saturation filter. Positions are 0-based pixels of the frame.
	// A run killed by the end of the session answers no star; any other failure of ASTAP throws, and the frame is lost.
	async #astapStars(session: Session, astap: NonNullable<Session['astap']>, image: Image, bytes: Uint8Array<ArrayBuffer>): Promise<readonly GuideStar[]> {
		astap.directory ??= mkdtemp(join(tmpdir(), 'nebulosa-guiding-'))
		const input = join(await astap.directory, 'frame.fits')
		await Bun.write(input, bytes)

		try {
			const { executable, timeout } = astap.tool
			const settings = session.detection
			return enrichGuideStars(await astapDetectStars(input, { executable, timeout, ...(settings && { minSNR: settings.minSNR, maxStars: settings.maxStars }) }, session.abort.signal), image)
		} catch (error) {
			if (error instanceof AstapError && error.code === 'aborted') return []
			throw error
		}
	}

	// Returns the latest session with this id that still lives, or the response refusing it.
	#active(sessionId: string): Session | Response {
		return this.#living(sessionId) ?? errorResponse('No guiding session is running with this id', 404, 'notFound')
	}

	// Returns the latest session with this id that still lives, if any.
	#living(sessionId: string): Session | undefined {
		const session = this.#sessions.find(sessionId)
		return session && session.summary.endedAt === undefined ? session : undefined
	}

	#notFound() {
		return notFound('Guiding session')
	}

	// Publishes a changed record; a record that did not change, or a session replaced by a newer one, changes silently.
	#update(session: Session, patch: Partial<GuidingSessionSummary>) {
		const current = session.summary
		let changed = false

		for (const key of Object.keys(patch) as (keyof GuidingSessionSummary)[]) {
			if (!sameValue(current[key], patch[key])) {
				changed = true
				break
			}
		}

		if (!changed) return
		this.#sessions.replace(session, { ...current, ...patch })
	}
}

// Overlay of a guide frame from its tracking result.
function overlayOf(frame: GuideFrameImage): GuidingFrameOverlay {
	const stellar = starTrackingOf(frame.tracking)
	const accepted = new Set(stellar?.accepted)
	const measurement = frame.tracking.measurement

	return {
		frameId: frame.frameId,
		state: frame.state,
		lockPosition: frame.lockPosition,
		searchPosition: frame.searchPosition,
		searchRegion: frame.searchRegion,
		measurement: measurement === undefined ? undefined : [measurement.x, measurement.y],
		primary: stellar?.primary === undefined ? undefined : [stellar.primary.x, stellar.primary.y],
		stars: stellar?.detections.map((star) => ({ x: star.x, y: star.y, hfd: star.hfd, accepted: accepted.has(star) })) ?? [],
	}
}

// Returns the progress of a calibration from the diagnostics of its latest frame and the limits of its settings.
export function calibrationProgressOf(diagnostics: GuidingCalibrationDiagnostics, config: Readonly<GuidingCalibrationConfig>): GuidingCalibrationProgress {
	const { startX, startY, decStartX, decStartY } = diagnostics
	// The diagnostics only carry the current distance from the start; the clearing ended where the DEC leg began.
	const clearingDistance = startX !== undefined && startY !== undefined && decStartX !== undefined && decStartY !== undefined ? Math.hypot(decStartX - startX, decStartY - startY) : diagnostics.clearingDistancePx

	return {
		phase: diagnostics.phase,
		raSteps: diagnostics.raSteps,
		maxRaSteps: config.maxRaSteps,
		raDistance: diagnostics.raNetDistancePx,
		raTarget: config.minNetRaTravelPx,
		clearingSteps: diagnostics.clearingSteps,
		maxClearingSteps: config.maxClearingSteps,
		clearingDistance,
		clearingTarget: config.maxClearingOffsetPx,
		decSteps: diagnostics.decSteps,
		maxDecSteps: config.maxDecSteps,
		decDistance: diagnostics.decNetDistancePx,
		decTarget: config.minNetDecTravelPx,
		decReturn: config.decReturnEnabled,
		decReturnSteps: diagnostics.decReturnSteps,
		decReturnDistance: diagnostics.clearingDistancePx,
		decMoving: diagnostics.decMotionDetected,
		backlash: diagnostics.backlash,
		badFrames: diagnostics.badFrames,
		maxBadFrames: config.maxBadFrames,
	}
}

// Progress of the exposure a guide camera counts down, for a guide exposure of exposure milliseconds: the remaining
// time the driver reports, the time elapsed since the start, in microseconds, and the completion in percent; undefined
// while the camera is not exposing.
function exposureProgressOf(camera: Camera, exposure: number): CameraCaptureTime | undefined {
	if (!camera.exposuring) return undefined
	const total = exposure * 1000
	const remainingTime = Math.min(total, Math.max(0, camera.exposure.value * 1e6))
	const elapsedTime = total - remainingTime
	return { remainingTime, elapsedTime, progress: total > 0 ? (elapsedTime / total) * 100 : 0 }
}

// RMS of the measured RA and DEC errors, in pixels, or undefined without any.
function rmsOf(errors: readonly (readonly [number, number])[]): GuidingRms | undefined {
	if (errors.length === 0) return undefined
	let ra = 0
	let dec = 0

	for (const [x, y] of errors) {
		ra += x * x
		dec += y * y
	}

	ra = Math.sqrt(ra / errors.length)
	dec = Math.sqrt(dec / errors.length)
	return { ra, dec, total: Math.hypot(ra, dec), samples: errors.length }
}

// Items positioned after `after` (position read by `positionOf`), and whether older ones after it were forgotten.
function page<T>(items: readonly T[], positionOf: (item: T) => number, after: number): GuidingPage<T> {
	const index = items.findIndex((item) => positionOf(item) > after)
	const selected = index < 0 ? [] : items.slice(index)
	const oldest = items.length > 0 ? positionOf(items[0]) : after + 1
	return { items: selected, truncated: oldest > after + 1 }
}

// Appends an item, dropping the oldest beyond `limit`.
function pushBounded<T>(items: T[], item: T, limit: number) {
	items.push(item)
	if (items.length > limit) items.splice(0, items.length - limit)
}

// Whether two record values are equal: primitives by identity, arrays and plain objects by their JSON.
function sameValue(a: unknown, b: unknown) {
	if (a === b) return true
	if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
	return JSON.stringify(a) === JSON.stringify(b)
}

// Routes of the guiding sessions.
export function createGuidingRoutes(guiding: GuidingSessions) {
	const after = (req: Request) => Number(new URL(req.url).searchParams.get('after') ?? 0)

	return {
		'/api/guiding': {
			// The latest guiding session of every guide camera, started by any tab.
			GET: () => Response.json(guiding.snapshot()),
		},
		'/api/guiding/:sessionId': {
			// A guiding session; 404 when it is not the latest of its camera.
			GET: (req) => guiding.session(req.params.sessionId),
		},
		'/api/guiding/:sessionId/events': {
			// The control events of a session after ?after=sequence.
			GET: (req) => guiding.events(req.params.sessionId, after(req)),
		},
		'/api/guiding/:sessionId/telemetry': {
			// The telemetry samples of a session after ?after=cursor.
			GET: (req) => guiding.telemetry(req.params.sessionId, after(req)),
		},
		'/api/connections/:id/cameras/:deviceId/guiding': {
			// Starts a guiding session looping on this camera.
			POST: async (req) => guiding.start(req.params.id, req.params.deviceId, (await req.json()) as GuidingStartRequest),
		},
		'/api/guiding/:sessionId/start': {
			// Starts calibrating or guiding; the outcome arrives as the command of the session record.
			POST: async (req) => guiding.startGuiding(req.params.sessionId, (await req.json()) as GuidingStartGuidingRequest),
		},
		'/api/guiding/:sessionId/stop-guiding': {
			// Stops the corrections and keeps looping.
			POST: async (req) => guiding.stopGuiding(req.params.sessionId, (await req.json()) as CommandRequest),
		},
		'/api/guiding/:sessionId/pause': {
			// Pauses the corrections, or the exposures too.
			POST: async (req) => guiding.pause(req.params.sessionId, (await req.json()) as GuidingPauseRequest),
		},
		'/api/guiding/:sessionId/resume': {
			// Resumes guiding after a pause.
			POST: async (req) => guiding.resume(req.params.sessionId, (await req.json()) as GuidingResumeRequest),
		},
		'/api/guiding/:sessionId/dither': {
			// Dithers and waits for the guided settle.
			POST: async (req) => guiding.dither(req.params.sessionId, (await req.json()) as GuidingDitherRequest),
		},
		'/api/guiding/:sessionId/target': {
			// Selects the target star.
			POST: async (req) => guiding.selectTarget(req.params.sessionId, (await req.json()) as GuidingTargetRequest),
		},
		'/api/guiding/:sessionId/target/clear': {
			// Clears the target star.
			POST: (req) => guiding.clearTarget(req.params.sessionId),
		},
		'/api/guiding/:sessionId/exposure': {
			// Sets the guide exposure of the next frames.
			POST: async (req) => guiding.setExposure(req.params.sessionId, (await req.json()) as GuidingExposureRequest),
		},
		'/api/guiding/:sessionId/calibration/clear': {
			// Clears the solved calibration.
			POST: (req) => guiding.clearCalibration(req.params.sessionId),
		},
		'/api/guiding/:sessionId/stop': {
			// Ends the session once the guide camera and guide output were released.
			POST: (req) => guiding.stop(req.params.sessionId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}

// Returns the admission of a session: its ids, whether a repeated token answered it, and its end.
function admitted({ summary: { sessionId, operationId }, closed }: Session, repeated: boolean): GuidingAdmitted {
	return { ok: true, sessionId, operationId, repeated, ended: closed.promise }
}

// Responds to a durable command: 202 with its id, or with its refusal.
function commandResponse(admitted: GuidingCommandAdmission): Response {
	return admitted.ok ? Response.json({ commandId: admitted.commandId } satisfies GuidingCommandAccepted, { status: 202 }) : refusalResponse(admitted)
}
