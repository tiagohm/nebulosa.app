import { constants } from 'fs'
import { copyFile, link, mkdir, rm, unlink } from 'fs/promises'
import { join } from 'path'
import { TIMEZONE } from 'nebulosa/src/astronomy/time/temporal'
import type { FlatPanelCommander } from 'nebulosa/src/devices/commanders/flatpanel'
import type { WheelCommander } from 'nebulosa/src/devices/commanders/wheel'
import type { Camera, FlatPanel, Wheel } from 'nebulosa/src/devices/indi/device'
import { failedOperationResult, type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay, abortReason } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { estimateFlatExposure } from 'nebulosa/src/imaging/analysis/flat/exposure'
import { finalizeFlatSequence, type FlatSequenceSample } from 'nebulosa/src/imaging/analysis/flat/sequence'
import type { FlatAnalysis, FlatDiagnosticCode, FlatExposureEstimate, FlatExposureObservation, FlatPlane, FlatSequencePlaneAnalysis } from 'nebulosa/src/imaging/analysis/flat/types'
import { clamp } from 'nebulosa/src/math/numerical/math'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureStart, DEFAULT_CAMERA_CAPTURE_START, SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import { type CaptureSettings, type CaptureSnoop, DEFAULT_CAPTURES_DIR, frameName, snoopedDevices } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice } from './commands'
import type { DeviceRegistry } from './devices'
import type { FlatFrameContext, FlatFrameMeasurement, FlatMeasurementOptions, FlatWizardAnalyzer } from './flatwizard.analysis'
import { errorResponse } from './http'
import type { OperationDevice, OperationRegistry } from './operations'

// Flat Wizard service: one server-owned session per camera that, filter after filter, finds the exposure putting
// the brightest plane of a flat inside its target and then acquires the requested number of accepted FLAT frames
// at that frozen exposure. The session is one `camera.flatWizard` operation of the process-wide registry holding the
// camera, and the filter wheel and flat panel when they are used, from start to end, including while it waits for
// the operator. Every exposure goes through the shared camera capturer into a staging directory inside the output
// directory, and is measured in the digital numbers of the file by the Flat Wizard analyzer (never on the normalized
// viewer documents). Trial frames of the exposure search and rejected final frames are deleted after measurement;
// an accepted final frame is published by hard-linking its original bytes to a new name that never overwrites an
// existing file. The levels are observed DN: without a bias reference the pedestal is unknown, so an out-of-target
// first trial is followed by a second distinct one before the toolkit's affine or interpolated estimate is used.
// A filter is selected by moving the assigned wheel, or by the operator, who confirms each manual step with its
// step id; the light comes from the assigned panel at a fixed brightness, or from a manual source the operator
// confirms. A light the session switched on is switched off once it ended. Stopping cancels the operation at once:
// the exposure in flight is lost, and files already published stay. Durations are seconds, instants Unix
// milliseconds, levels DN. Records live in memory, the latest session per camera.

// Camera settings applied to every frame; the exposure is the wizard's own and the frame type is always FLAT.
export type FlatWizardCaptureSettings = Pick<CaptureSettings, 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// One group of frames taken through one filter.
export interface FlatWizardFilter {
	// Name of the filter, used in the file names and shown to the operator.
	readonly label: string
	// Slot of the assigned wheel, 0-based; absent asks the operator to put the filter in place.
	readonly slot?: number
	// Number of accepted frames to save, at least 1.
	readonly count: number
	// Exposure of the first trial frame, in seconds.
	readonly initialExposure: number
	// Shortest exposure allowed, in seconds, positive.
	readonly minimumExposure: number
	// Longest exposure allowed, in seconds, above minimumExposure.
	readonly maximumExposure: number
	// Ordered inclusive interval the median of the brightest plane must reach, in observed DN.
	readonly targetRange: readonly [minimum: number, maximum: number]
	// Brightness of the assigned panel, in its own units; absent keeps the brightness it reports.
	readonly brightness?: number
}

// Body of POST /api/connections/:id/cameras/:deviceId/flat-wizard.
export interface FlatWizardRequest extends CommandRequest {
	// Camera settings of every frame.
	readonly capture: FlatWizardCaptureSettings
	// Groups to acquire, in order; at least one.
	readonly filters: readonly FlatWizardFilter[]
	// Filter wheel moved for the filters that name a slot; absent makes every filter change manual.
	readonly wheel?: OperationDevice
	// Flat panel lighting the frames; absent makes the light manual.
	readonly panel?: OperationDevice
	// Wait after the panel light or brightness changed, before the next exposure, in seconds.
	readonly settleTime: number
	// Absolute directory of the server the frames are saved into; DEFAULT_CAPTURES_DIR when absent.
	readonly directory?: string
	// Effective upper clipping code of the camera, in DN; absent leaves saturation evidence unknown.
	readonly effectiveClip?: number
	// Trial frames allowed per filter before the exposure search gives up, at least 1.
	readonly maximumTrials: number
	// Rejected or inconclusive final frames allowed per filter before the group fails.
	readonly maximumRejections: number
	// Devices snooped into the frame headers; the assigned wheel is always snooped.
	readonly snoop?: CaptureSnoop
}

// What a session is doing:
// - preparing: acquiring the devices.
// - waitingForFilter: waiting for the operator to put the filter in place (and, without a panel, the light).
// - movingFilter: the wheel moves to the slot of the filter.
// - waitingForIllumination: waiting for the operator to confirm the manual light is ready.
// - settingLight: the panel brightness and light are being applied.
// - settling: waiting settleTime after the panel changed.
// - exposing: a frame is being exposed and read.
// - measuring: the frame is measured in DN.
// - saving: an accepted frame is being published.
// - assessingSequence: the temporal stability of the accepted frames of a filter is evaluated.
// - stopping: the operator stopped the session; the devices are being released.
// - completed: every filter has its accepted frames.
// - cancelled: the session was stopped; published frames stay.
// - failed: the session ended because of an error, given in reason and error.
export type FlatWizardState = 'preparing' | 'waitingForFilter' | 'movingFilter' | 'waitingForIllumination' | 'settingLight' | 'settling' | 'exposing' | 'measuring' | 'saving' | 'assessingSequence' | 'stopping' | 'completed' | 'cancelled' | 'failed'

// Progress of one filter group: pending until reached, then calibrating while its exposure is searched, acquiring
// while its final frames are taken, and completed, failed, or cancelled.
export type FlatWizardFilterState = 'pending' | 'calibrating' | 'acquiring' | 'completed' | 'failed' | 'cancelled'

// Levels of one plane of a measured frame.
export interface FlatWizardPlaneLevel {
	// Physical plane, measured without debayering.
	readonly plane: FlatPlane
	// Robust median, in DN; absent when the plane had no finite sample.
	readonly median?: number
	// Fraction of the samples at or above the upper clipping limit, in [0, 1]; absent when no limit is known.
	readonly upperClipped?: number
	// Whether upper clipping is present, proven absent (effective limit known), or unknown.
	readonly upperClipping: 'present' | 'absent' | 'unknown'
	// Number of non-finite samples.
	readonly nonFinite: number
}

// Outcome of one measured frame:
// - usable / clipped / noSignal: a trial frame of the exposure search, usable as an observation or not.
// - accepted: a final frame whose target, clipping, and finite-sample checks passed (clipping may be unknown, see
//   reasons); it was published.
// - rejected: a final frame that failed a check.
// - inconclusive: a final frame whose checks could not be decided.
export type FlatWizardVerdict = 'usable' | 'clipped' | 'noSignal' | 'accepted' | 'rejected' | 'inconclusive'

// One exposure of a session.
export interface FlatWizardAttempt {
	// Number of the exposure within the session, from 1.
	readonly index: number
	// Index of its filter group.
	readonly filter: number
	// Whether it was a trial of the exposure search or a candidate final frame.
	readonly kind: 'trial' | 'final'
	// Exposure, in seconds.
	readonly exposure: number
	// Instant the exposure started, Unix milliseconds (UTC).
	readonly time: number
	// Levels of every measured plane.
	readonly planes: readonly FlatWizardPlaneLevel[]
	// Median of the plane driving the exposure, in DN.
	readonly level?: number
	// Outcome of the frame.
	readonly verdict: FlatWizardVerdict
	// Diagnostic codes of the toolkit's analysis, without repetitions.
	readonly reasons: readonly FlatDiagnosticCode[]
	// Name of the published file of an accepted frame, without its directory.
	readonly file?: string
}

// Temporal stability of the accepted frames of a filter.
export type FlatWizardSequenceResult =
	| {
			// Not evaluated: fewer than three frames, or metadata that does not form one stack.
			readonly status: 'notEvaluated'
			// Why it was not evaluated.
			readonly reason: string
	  }
	| {
			// Evaluated by the toolkit's sequence analysis.
			readonly status: 'evaluated'
			// Accepted, rejected, or inconclusive aggregate verdict; a frame is never deleted for it.
			readonly verdict: 'accepted' | 'rejected' | 'inconclusive'
			// Diagnostic codes behind the verdict.
			readonly reasons: readonly FlatDiagnosticCode[]
			// Temporal metrics per plane.
			readonly planes: readonly FlatSequencePlaneAnalysis[]
			// Names of the published files flagged as multivariate outliers.
			readonly outliers: readonly string[]
	  }

// Progress and result of one filter group.
export interface FlatWizardFilterRun {
	// Name of the filter.
	readonly label: string
	// Wheel slot, 0-based, when the wheel selects it.
	readonly slot?: number
	// Accepted frames requested.
	readonly required: number
	// Progress of the group.
	readonly state: FlatWizardFilterState
	// Plane whose median drives the exposure: the brightest one of the first usable trial.
	readonly plane?: FlatPlane
	// Exposure being tried by the search, in seconds.
	readonly candidateExposure?: number
	// Exposure frozen for the final frames, in seconds.
	readonly exposure?: number
	// Brightness the panel reported once applied, in its own units.
	readonly brightness?: number
	// Trial frames taken.
	readonly trials: number
	// Final frames accepted and published.
	readonly accepted: number
	// Final frames rejected.
	readonly rejected: number
	// Final frames whose checks could not be decided.
	readonly inconclusive: number
	// Accepted frames whose publication failed.
	readonly saveFailed: number
	// Names of the published files, in acquisition order.
	readonly files: readonly string[]
	// Temporal stability of the published frames, once evaluated.
	readonly sequence?: FlatWizardSequenceResult
	// Why the group failed.
	readonly error?: string
}

// Manual step the session waits for.
export interface FlatWizardPendingStep {
	// Id the continue request must repeat, so a stale or repeated confirmation never skips a later step.
	readonly stepId: string
	// Whether the operator puts the filter in place (and readies a manual light) or only readies the light.
	readonly kind: 'filter' | 'illumination'
	// Index of the filter group.
	readonly filter: number
}

// Session record published to clients.
export interface FlatWizardSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the devices.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Filter wheel moved by the session.
	readonly wheel?: OperationDevice
	// Name of the wheel.
	readonly wheelName?: string
	// Flat panel lighting the frames.
	readonly panel?: OperationDevice
	// Name of the panel.
	readonly panelName?: string
	// Settings the session runs with, without the token.
	readonly request: Omit<FlatWizardRequest, 'token'>
	// What the session is doing.
	readonly state: FlatWizardState
	// Index of the filter group in progress.
	readonly filter: number
	// Every filter group, in request order.
	readonly filters: readonly FlatWizardFilterRun[]
	// Latest measured exposure.
	readonly lastAttempt?: FlatWizardAttempt
	// Manual step the session waits for.
	readonly pending?: FlatWizardPendingStep
	// Problem leaving a device in a state the session did not intend, such as the panel light left on.
	readonly cleanupWarning?: string
	// Why the session failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC).
	readonly endedAt?: number
	// Number of changes published so far; increases with every change.
	readonly revision: number
}

// Complete session record.
export interface FlatWizardSession extends FlatWizardSessionSummary {
	// Latest exposures, oldest first; at most MAXIMUM_ATTEMPTS.
	readonly attempts: readonly FlatWizardAttempt[]
}

// Snapshot of GET /api/flat-wizard: the latest session of every camera.
export interface FlatWizardSnapshot {
	readonly sessions: readonly FlatWizardSessionSummary[]
}

// Response of an accepted start.
export interface FlatWizardStartResponse {
	// Id of the session, repeated by its flatWizard:updated events.
	readonly sessionId: string
	// Id of the operation holding the devices.
	readonly operationId: string
}

// Body of POST /api/flat-wizard/:sessionId/continue.
export interface FlatWizardContinueRequest {
	// Id of the pending step being confirmed.
	readonly stepId: string
}

// Notification published whenever a session changes.
export type FlatWizardEvent = { readonly type: 'flatWizard:updated'; readonly session: FlatWizardSessionSummary }

// Receiver of Flat Wizard events.
export type FlatWizardListener = (event: FlatWizardEvent) => void

// Exposures kept in the detail of a session, the latest ones.
const MAXIMUM_ATTEMPTS = 200

// Robust score above which the sequence analysis flags a frame as a multivariate outlier: well above the
// dispersion of a homogeneous stack, so only a frame that stands apart is flagged.
const SEQUENCE_OUTLIER_SIGMA = 5

// Relative difference under which two exposures are the same, so the search cannot retry one forever.
const SAME_EXPOSURE = 1e-6

// Name of the published frames: the capture placeholders plus the filter label.
const FILENAME_TEMPLATE = '{date}_{time}_{camera}_{type}_{filter}_{seq}'

// A session while its service knows it.
interface Session {
	// Resource key of the camera the session is registered under.
	readonly key: string
	summary: FlatWizardSessionSummary
	attempts: FlatWizardAttempt[]
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<void>
	// Confirmation of the manual step the session waits for.
	gate?: { readonly stepId: string; readonly confirm: VoidFunction }
	// Whether the session switched the panel light on and has not switched it off yet.
	lightOn: boolean
	// Settles once the session ended and its cleanup ran.
	readonly ended: PromiseWithResolvers<void>
}

// Devices of a session.
interface SessionDevices {
	readonly camera: Camera
	readonly wheel?: Wheel
	readonly panel?: FlatPanel
}

// Flat Wizard sessions of the cameras of every open connection.
export class FlatWizardSessions {
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session of each operation a command token started, so a repeated request answers it.
	readonly #byOperation = new Map<string, Session>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes every
	// session, capturer takes the frames (the one of the capture service), wheels and panels drive the assigned
	// devices (the commanders of their commands), analyzer measures the frames in DN, and listener receives every
	// session change synchronously. capturesDir is the default output directory.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly capturer: CameraCapturer,
		readonly wheels: WheelCommander,
		readonly panels: FlatPanelCommander,
		readonly analyzer: Pick<FlatWizardAnalyzer, 'measure'>,
		readonly listener: FlatWizardListener,
		readonly capturesDir: string = DEFAULT_CAPTURES_DIR,
	) {}

	// Returns the latest session of every camera.
	snapshot(): FlatWizardSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json({ ...session.summary, attempts: session.attempts } satisfies FlatWizardSession) : errorResponse('Flat Wizard session not found', 404, 'notFound')
	}

	// Starts a session, replacing the ended session of the camera. Responds 202 with FlatWizardStartResponse once
	// accepted (a repeated token answers its session); progress and outcome arrive as flatWizard:updated and
	// operation:updated events. Responds 404 for an unknown camera, wheel, or panel, and 409 when one is
	// disconnected or held by another operation, or the camera's session is running.
	start(connectionId: string, deviceId: string, { token, ...request }: FlatWizardRequest): Response {
		const known = this.operations.started(token)
		const repeated = known && this.#byOperation.get(known.operationId)
		if (repeated) return Response.json({ sessionId: repeated.summary.sessionId, operationId: repeated.summary.operationId } satisfies FlatWizardStartResponse, { status: 202 })

		const camera = connectedDevice(this, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const wheel = request.wheel && connectedDevice(this, request.wheel.connectionId, 'wheel', request.wheel.deviceId, 'Filter wheel')
		if (wheel instanceof Response) return wheel
		const panel = request.panel && connectedDevice(this, request.panel.connectionId, 'flatPanel', request.panel.deviceId, 'Flat panel')
		if (panel instanceof Response) return panel

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous && previous.summary.endedAt === undefined) return errorResponse('A Flat Wizard session is running on this camera', 409, 'busy')
		if (!this.operations.available(camera) || (wheel && !this.operations.available(wheel)) || (panel && !this.operations.available(panel))) return busy()

		const devices: SessionDevices = { camera, wheel, panel }
		const held: OperationDevice[] = [{ connectionId, deviceId }, ...(request.wheel ? [request.wheel] : []), ...(request.panel ? [request.panel] : [])]
		const session: Session = {
			key,
			summary: {
				sessionId: crypto.randomUUID(),
				operationId: '',
				camera: { connectionId, deviceId },
				cameraName: camera.name,
				wheel: request.wheel,
				wheelName: wheel?.name,
				panel: request.panel,
				panelName: panel?.name,
				request: structuredClone(request),
				state: 'preparing',
				filter: 0,
				filters: request.filters.map((filter) => ({ label: filter.label, slot: wheel ? filter.slot : undefined, required: filter.count, state: 'pending', trials: 0, accepted: 0, rejected: 0, inconclusive: 0, saveFailed: 0, files: [] })),
				startedAt: Date.now(),
				revision: 0,
			},
			attempts: [],
			lightOn: false,
			ended: Promise.withResolvers(),
		}

		const record = this.operations.run('camera.flatWizard', held, token, () => {
			session.handle = this.#run(session, devices)
			return session.handle.result
		})

		if (previous) this.#byOperation.delete(previous.summary.operationId)
		this.#sessions.set(key, session)
		this.#byOperation.set(record.operationId, session)
		this.#update(session, { operationId: record.operationId })

		void session.handle!.result.then((result) => this.#ended(session, devices, result))
		return Response.json({ sessionId: session.summary.sessionId, operationId: record.operationId } satisfies FlatWizardStartResponse, { status: 202 })
	}

	// Confirms the manual step a session waits for. Responds 204, 404 when the session is unknown, and 409 when it
	// waits for no step or for another one, so a stale or repeated confirmation never skips a later step.
	continue(sessionId: string, { stepId }: FlatWizardContinueRequest): Response {
		const session = this.#find(sessionId)
		if (!session) return errorResponse('Flat Wizard session not found', 404, 'notFound')
		if (session.gate?.stepId !== stepId) return errorResponse('The Flat Wizard session is not waiting for this step', 409, 'staleStep')

		session.gate.confirm()
		return new Response(null, { status: 204 })
	}

	// Stops a running session wherever it stands: the exposure in flight is aborted and lost, a measurement or a
	// manual step is abandoned, and files already published stay. Resolves once the devices were released and the
	// light the session switched on was switched off. Responds 204, 404 when the session is unknown, and 409 when it
	// already ended.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session) return errorResponse('Flat Wizard session not found', 404, 'notFound')
		if (session.summary.endedAt !== undefined) return errorResponse('The Flat Wizard session already ended', 409, 'notRunning')

		if (session.summary.state !== 'stopping') this.#update(session, { state: 'stopping', pending: undefined })
		await session.handle?.cancel('aborted')
		await session.ended.promise
		return new Response(null, { status: 204 })
	}

	// Starts the operation of a session, holding its devices until every filter group ended.
	#run(session: Session, devices: SessionDevices): OperationHandle<void> {
		const resources = new Map<string, ResourceRequest>()
		for (const device of [devices.camera, devices.wheel, devices.panel]) if (device) resources.set(resourceKey(device), { key: resourceKey(device), device })

		return this.operations.coordinator.start<void>('flatWizardSession', Array.from(resources.values()), async (context) => {
			const { request, sessionId } = session.summary
			const directory = request.directory || this.capturesDir
			// Staging lives in the output directory, so publishing a frame is a link on the same file system.
			const staging = join(directory, `.flatwizard-${sessionId}`)

			try {
				await mkdir(staging, { recursive: true })
			} catch (error) {
				return failedOperationResult('commandFailed', `Unable to create the output directory: ${Error.isError(error) ? error.message : String(error)}`)
			}

			try {
				for (let index = 0; index < request.filters.length; index++) {
					const result = await this.#filter(session, context, devices, index, directory, staging)
					if (!result.ok) return result
				}

				return successfulOperationResult(undefined)
			} finally {
				await rm(staging, { recursive: true, force: true })
			}
		})
	}

	// Prepares a filter group, searches its exposure, acquires its final frames, and evaluates their stability.
	async #filter(session: Session, context: OperationContext, devices: SessionDevices, index: number, directory: string, staging: string): Promise<OperationResult<void>> {
		const filter = session.summary.request.filters[index]
		this.#update(session, { filter: index })
		this.#patch(session, index, { state: 'calibrating' })

		const prepared = await this.#prepare(session, context, devices, index)
		if (!prepared.ok) return this.#failFilter(session, index, prepared)

		const calibrated = await this.#calibrate(session, context, devices, index, staging)
		if (!calibrated.ok) return this.#failFilter(session, index, calibrated)

		const { exposure, plane } = calibrated.value
		this.#patch(session, index, { state: 'acquiring', exposure, candidateExposure: undefined })
		const acquired = await this.#acquire(session, context, devices, index, exposure, plane, directory, staging)
		if (!acquired.ok) return this.#failFilter(session, index, acquired)

		this.#update(session, { state: 'assessingSequence' })
		this.#patch(session, index, { state: 'completed', sequence: assessSequence(acquired.value, measurementOptions(session.summary.request, filter, plane)) })
		return successfulOperationResult(undefined)
	}

	// Puts the filter in place and readies the light: the wheel moves, or the operator confirms; the panel is set to
	// the brightness of the filter and switched on, then settles, or the operator confirms a manual light.
	async #prepare(session: Session, context: OperationContext, { wheel, panel }: SessionDevices, index: number): Promise<OperationResult<void>> {
		const filter = session.summary.request.filters[index]
		let confirmed = false

		if (wheel && filter.slot !== undefined) {
			this.#update(session, { state: 'movingFilter' })
			const moved = await this.wheels.moveTo(context, wheel, filter.slot)
			if (!moved.ok) return failedWith(moved, `The wheel did not reach the slot of ${filter.label}`)
		} else {
			const answered = await this.#gate(session, context, 'filter', index)
			if (!answered.ok) return answered
			confirmed = true
		}

		if (!panel) {
			// Without a panel the operator readies the light; a filter step already asked for it.
			if (confirmed) return successfulOperationResult(undefined)
			return await this.#gate(session, context, 'illumination', index)
		}

		this.#update(session, { state: 'settingLight' })
		let changed = false

		if (filter.brightness !== undefined && panel.intensity.value !== filter.brightness) {
			const set = await this.panels.intensity(context, panel, filter.brightness)
			if (!set.ok) return failedWith(set, 'The flat panel did not apply the brightness')
			changed = true
		}

		if (!panel.enabled) {
			const enabled = await this.panels.enable(context, panel)
			if (!enabled.ok) return failedWith(enabled, 'The flat panel light did not switch on')
			session.lightOn = true
			changed = true
		}

		this.#patch(session, index, { brightness: panel.intensity.value })

		const { settleTime } = session.summary.request
		if (!changed || settleTime <= 0) return successfulOperationResult(undefined)
		this.#update(session, { state: 'settling' })
		return await abortableDelay(settleTime * 1000, context.signal)
	}

	// Waits for the operator to confirm a manual step, published with a fresh step id.
	async #gate(session: Session, context: OperationContext, kind: FlatWizardPendingStep['kind'], filter: number): Promise<OperationResult<void>> {
		const { signal } = context
		if (signal.aborted) return failedOperationResult(abortReason(signal))

		const stepId = crypto.randomUUID()
		const { promise, resolve } = Promise.withResolvers<OperationResult<void>>()
		const onAbort = () => resolve(failedOperationResult(abortReason(signal)))
		signal.addEventListener('abort', onAbort, { once: true })
		session.gate = { stepId, confirm: () => resolve(successfulOperationResult(undefined)) }
		this.#update(session, { state: kind === 'filter' ? 'waitingForFilter' : 'waitingForIllumination', pending: { stepId, kind, filter } })

		try {
			return await promise
		} finally {
			signal.removeEventListener('abort', onAbort)
			session.gate = undefined
			if (session.summary.pending?.stepId === stepId) this.#update(session, { pending: undefined })
		}
	}

	// Searches the exposure that puts the brightest plane inside the target with trial frames that are never kept.
	// Observed levels carry an unknown pedestal, so a single out-of-target observation is followed by a second
	// distinct exposure (twice or half the first, within the bounds) instead of a proportional guess; the toolkit's
	// estimate then interpolates or fits the response. A clipped trial is no observation and halves the exposure.
	async #calibrate(session: Session, context: OperationContext, { camera, panel }: SessionDevices, index: number, staging: string): Promise<OperationResult<{ readonly exposure: number; readonly plane: FlatPlane }>> {
		const { request } = session.summary
		const filter = request.filters[index]
		const [minimum, maximum] = [filter.minimumExposure, filter.maximumExposure]
		const observations: FlatExposureObservation[] = []
		const tried: number[] = []
		let exposure = clamp(filter.initialExposure, minimum, maximum)
		let plane: FlatPlane | undefined

		for (let trial = 1; ; trial++) {
			if (trial > request.maximumTrials) return failedOperationResult('unexpectedState', `No exposure of ${filter.label} reached the target in ${request.maximumTrials} trial frames`)

			tried.push(exposure)
			this.#patch(session, index, { candidateExposure: exposure, trials: trial })
			const name = `trial-${index + 1}-${trial}.fit`
			const measured = await this.#take(session, context, camera, panel, index, exposure, name, staging, undefined, false)
			await rm(join(staging, name), { force: true })
			if (!measured.ok) return measured

			const { analysis, time } = measured.value
			if (plane === undefined) {
				plane = brightestPlane(analysis)
				if (plane !== undefined) this.#patch(session, index, { plane })
			}

			const level = plane && planeMedian(analysis, plane)
			const clipped = analysis.planes.some((entry) => entry.clipping.upper?.status === 'present')
			const verdict: FlatWizardVerdict = clipped ? 'clipped' : level === undefined || !(level > 0) ? 'noSignal' : 'usable'
			this.#record(session, { filter: index, kind: 'trial', exposure, time, planes: planeLevels(analysis), level, verdict, reasons: reasonsOf(analysis) })

			let next: number | undefined
			let estimate: FlatExposureEstimate | undefined

			if (verdict === 'clipped') {
				if (exposure <= minimum) return failedOperationResult('unexpectedState', `${filter.label} saturates even at the minimum exposure of ${minimum} s; dim the light`)
				next = Math.max(minimum, exposure / 2)
			} else if (verdict === 'noSignal') {
				return failedOperationResult('unexpectedState', `${filter.label} shows no measurable signal at ${exposure} s`)
			} else {
				observations.push({ exposure, level: level! })
				estimate = estimateFlatExposure({ observations: observations as [FlatExposureObservation, ...FlatExposureObservation[]], levelMode: 'observed', targetRange: filter.targetRange, exposureRange: [minimum, maximum] })

				if (estimate.status === 'accepted') return successfulOperationResult({ exposure, plane: plane! })
				if (estimate.status === 'invalid') {
					// A single observation cannot separate the light from the pedestal: a second distinct exposure can.
					if (observations.length > 1 || !estimate.diagnostics.some((diagnostic) => diagnostic.code === 'insufficientSamples')) return failedOperationResult('unexpectedState', `The exposure of ${filter.label} cannot be estimated: ${estimate.diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`)
					next = clamp(level! < filter.targetRange[0] ? exposure * 2 : exposure / 2, minimum, maximum)
				} else {
					next = estimate.recommendedExposure
				}
			}

			if (next === undefined || tried.some((value) => Math.abs(value - next) <= SAME_EXPOSURE * value)) {
				if (estimate?.status === 'belowMinimum') return failedOperationResult('unexpectedState', `${filter.label} is too bright: the target needs less than the minimum exposure of ${minimum} s`)
				if (estimate?.status === 'aboveMaximum') return failedOperationResult('unexpectedState', `${filter.label} is too dim: the target needs more than the maximum exposure of ${maximum} s`)
				return failedOperationResult('unexpectedState', `The exposure search of ${filter.label} stalled at ${exposure} s`)
			}

			exposure = next
		}
	}

	// Takes final frames at the frozen exposure until the requested number was accepted and published, keeping the
	// temporal sample of each published frame. Resolves those samples with their file names.
	async #acquire(session: Session, context: OperationContext, { camera, panel }: SessionDevices, index: number, exposure: number, plane: FlatPlane, directory: string, staging: string): Promise<OperationResult<readonly AcceptedFrame[]>> {
		const { request, cameraName } = session.summary
		const filter = request.filters[index]
		const accepted: AcceptedFrame[] = []
		let rejections = 0

		for (let candidate = 1; accepted.length < filter.count; candidate++) {
			if (rejections > request.maximumRejections) return failedOperationResult('unexpectedState', `${rejections} frames of ${filter.label} were rejected or inconclusive; check the light and the target`)

			const name = `final-${index + 1}-${candidate}.fit`
			const staged = join(staging, name)
			const measured = await this.#take(session, context, camera, panel, index, exposure, name, staging, name, true, plane)

			if (!measured.ok) {
				await rm(staged, { force: true })
				return measured
			}

			const { analysis, sample, time } = measured.value
			const verdict = finalVerdict(analysis)
			const record = { filter: index, kind: 'final', exposure, time, planes: planeLevels(analysis), level: planeMedian(analysis, plane), reasons: reasonsOf(analysis) } as const
			const run = session.summary.filters[index]

			if (verdict !== 'accepted') {
				await rm(staged, { force: true })
				rejections++
				this.#record(session, { ...record, verdict })
				this.#patch(session, index, verdict === 'rejected' ? { rejected: run.rejected + 1 } : { inconclusive: run.inconclusive + 1 })
				continue
			}

			this.#update(session, { state: 'saving' })
			const file = `${frameName(FILENAME_TEMPLATE.replace('{filter}', filter.label.replaceAll(/[{}]/g, '')), { camera: cameraName, type: 'FLAT', time, generation: accepted.length + 1, timezoneOffset: TIMEZONE })}.fit`

			try {
				await publishFrame(staged, join(directory, file))
			} catch (error) {
				await rm(staged, { force: true })
				this.#record(session, { ...record, verdict })
				this.#patch(session, index, { saveFailed: run.saveFailed + 1 })
				return failedOperationResult('commandFailed', `Unable to save ${file}: ${Error.isError(error) ? error.message : String(error)}`)
			}

			accepted.push({ file, sample: sample! })
			this.#record(session, { ...record, verdict, file })
			this.#patch(session, index, { accepted: run.accepted + 1, files: [...run.files, file] })
		}

		return successfulOperationResult(accepted)
	}

	// Exposes one frame into the staging directory and measures it in DN. sampled keeps the temporal sample of a
	// final frame; plane, once known, is the plane whose target the frame is checked against.
	async #take(session: Session, context: OperationContext, camera: Camera, panel: FlatPanel | undefined, index: number, exposure: number, name: string, staging: string, id: string | undefined, sampled: boolean, plane?: FlatPlane): Promise<OperationResult<FlatFrameMeasurement & { readonly time: number }>> {
		const { request } = session.summary
		const filter = request.filters[index]
		this.#update(session, { state: 'exposing' })

		const captured = await this.capturer.start(context, camera, this.#captureRequest(session, camera, exposure, staging, name), { clock: SYSTEM_CAMERA_CAPTURE_CLOCK }).result
		if (!captured.ok) return captured

		const time = captured.value.frames[0]?.exposureStartedAt ?? Date.now()
		const frame: FlatFrameContext = { id, exposure, timestamp: time, filter: filter.label, illumination: panel ? { source: panel.name, brightness: panel.intensity.value } : { source: 'manual' } }
		this.#update(session, { state: 'measuring' })

		try {
			const measured = await this.analyzer.measure(join(staging, name), frame, measurementOptions(request, filter, plane), sampled, context.signal)
			return successfulOperationResult({ ...measured, time })
		} catch (error) {
			if (context.signal.aborted) return failedOperationResult(abortReason(context.signal))
			return failedOperationResult('commandFailed', Error.isError(error) ? error.message : String(error))
		}
	}

	// Builds the capture request of one frame: the session's camera settings, a FLAT frame of exposure seconds
	// written as FITS to name inside staging, and the snooped devices.
	#captureRequest(session: Session, camera: Camera, exposure: number, staging: string, name: string): CameraCaptureStart {
		const { capture, snoop, wheel } = session.summary.request
		const snoopWheel = wheel && wheel.connectionId === session.summary.camera.connectionId ? wheel.deviceId : snoop?.wheel

		return {
			...structuredClone(DEFAULT_CAMERA_CAPTURE_START),
			...capture,
			exposureTime: exposure,
			exposureTimeUnit: 'second',
			frameType: 'FLAT',
			exposureMode: 'single',
			count: 1,
			delay: 0,
			autoSave: true,
			autoSubFolderMode: 'off',
			transferFormat: 'FITS',
			compressed: false,
			outputPath: staging,
			outputName: name,
			...snoopedDevices(this.devices, camera, { ...snoop, wheel: snoopWheel }),
		}
	}

	// Records the end of a session: switches off the light it switched on, then publishes its outcome.
	async #ended(session: Session, { panel }: SessionDevices, result: OperationResult<void>) {
		if (session.lightOn && panel) {
			// The operation released the panel, so the cleanup takes it again for itself; another operation that took
			// it first, or a disconnection, leaves the light on.
			const disabled = panel.connected && this.operations.available(panel) ? await this.panels.disable(this.operations.coordinator, panel) : undefined
			if (disabled?.ok) session.lightOn = false
			else this.#update(session, { cleanupWarning: `The light of ${panel.name} was left on: ${disabled && !disabled.ok ? (disabled.error ?? disabled.reason) : 'the panel was not available'}` })
		}

		const filters = session.summary.filters.map((filter) => (filter.state === 'calibrating' || filter.state === 'acquiring' ? { ...filter, state: 'cancelled' as const, candidateExposure: undefined } : filter))
		if (result.ok) this.#update(session, { state: 'completed', filters, pending: undefined, endedAt: Date.now() })
		else if (result.reason === 'aborted') this.#update(session, { state: 'cancelled', filters, pending: undefined, endedAt: Date.now() })
		else this.#update(session, { state: 'failed', filters, pending: undefined, reason: result.reason, ...(result.error !== undefined && { error: result.error }), endedAt: Date.now() })

		session.ended.resolve()
	}

	// Marks a filter group as failed, or cancelled when the session was stopped, and returns the failure.
	#failFilter<T>(session: Session, index: number, result: OperationResult<T> & { readonly ok: false }): OperationResult<void> {
		if (result.reason === 'aborted') this.#patch(session, index, { state: 'cancelled', candidateExposure: undefined })
		else this.#patch(session, index, { state: 'failed', candidateExposure: undefined, error: result.error ?? result.reason })
		return result
	}

	// Appends an exposure to the session and publishes it as the latest one.
	#record(session: Session, attempt: Omit<FlatWizardAttempt, 'index'>) {
		const recorded: FlatWizardAttempt = { index: (session.attempts.at(-1)?.index ?? 0) + 1, ...attempt }
		session.attempts.push(recorded)
		if (session.attempts.length > MAXIMUM_ATTEMPTS) session.attempts.shift()
		this.#update(session, { lastAttempt: recorded })
	}

	// Returns the latest session with this id.
	#find(sessionId: string): Session | undefined {
		for (const session of this.#sessions.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Changes a filter group of a session and publishes the session.
	#patch(session: Session, index: number, patch: Partial<FlatWizardFilterRun>) {
		this.#update(session, { filters: session.summary.filters.map((filter, i) => (i === index ? { ...filter, ...patch } : filter)) })
	}

	// Publishes a changed session with the next revision; a session replaced by a newer one of its camera changes
	// silently.
	#update(session: Session, patch: Partial<FlatWizardSessionSummary>) {
		// A stop request keeps the session stopping until it ended, whatever step was running.
		const state = session.summary.state === 'stopping' && patch.state !== undefined && !TERMINAL_STATES.has(patch.state) ? 'stopping' : (patch.state ?? session.summary.state)
		session.summary = { ...session.summary, ...patch, state, revision: session.summary.revision + 1 }
		if (this.#sessions.get(session.key) === session) this.listener({ type: 'flatWizard:updated', session: session.summary })
	}
}

// One published final frame of a filter group.
interface AcceptedFrame {
	// Name of the published file.
	readonly file: string
	// Temporal sample of the frame.
	readonly sample: FlatSequenceSample
}

// States after which a session never changes again.
const TERMINAL_STATES: ReadonlySet<FlatWizardState> = new Set(['completed', 'cancelled', 'failed'])

// Single-frame analysis options of a filter group: the clipping and finite-sample checks always, and the target
// of the plane driving the exposure once it is known. Only that plane is held to the target, since the other planes
// of a color flat are dimmer by nature.
export function measurementOptions(request: Pick<FlatWizardRequest, 'effectiveClip'>, filter: Pick<FlatWizardFilter, 'targetRange'>, plane?: FlatPlane): FlatMeasurementOptions {
	return {
		...(request.effectiveClip !== undefined && { effectiveClip: { upper: request.effectiveClip } }),
		criteria: {
			...(plane && { targets: { [plane]: { levelMode: 'observed', range: filter.targetRange } } }),
			maximumClippedFraction: 0,
			maximumNonFiniteFraction: 0,
		},
	}
}

// Classifies a final frame from its checks: any failed check rejects it; it is accepted when the target and the
// finite samples pass and clipping is not present, even when its absence cannot be proven (the analysis then
// reports effectiveClipUnknown); otherwise it is inconclusive.
export function finalVerdict(analysis: FlatAnalysis): 'accepted' | 'rejected' | 'inconclusive' {
	const { target, clipping, finiteSamples } = analysis.assessment
	if (target.status === 'fail' || clipping.status === 'fail' || finiteSamples.status === 'fail') return 'rejected'
	return target.status === 'pass' && finiteSamples.status === 'pass' ? 'accepted' : 'inconclusive'
}

// Returns the plane with the highest finite observed median, or undefined when none has one.
export function brightestPlane(analysis: FlatAnalysis): FlatPlane | undefined {
	let best: FlatPlane | undefined
	let level = Number.NEGATIVE_INFINITY

	for (const entry of analysis.planes) {
		const median = entry.observed.median
		if (median !== undefined && Number.isFinite(median) && median > level) {
			best = entry.plane
			level = median
		}
	}

	return best
}

// Returns the observed median of a plane, in DN.
function planeMedian(analysis: FlatAnalysis, plane: FlatPlane) {
	return analysis.planes.find((entry) => entry.plane === plane)?.observed.median
}

// Copies the levels of every plane into the shape published to clients.
function planeLevels(analysis: FlatAnalysis): FlatWizardPlaneLevel[] {
	return analysis.planes.map(({ plane, observed, clipping }) => ({ plane, median: observed.median, upperClipped: clipping.upper?.fraction, upperClipping: clipping.upper?.status ?? 'unknown', nonFinite: observed.nonFinite }))
}

// Returns the diagnostic codes of an analysis, without repetitions.
function reasonsOf(analysis: FlatAnalysis): FlatDiagnosticCode[] {
	return Array.from(new Set([...analysis.assessment.reasons, ...analysis.diagnostics.map((diagnostic) => diagnostic.code)]))
}

// Evaluates the temporal stability of the published frames of a filter group with the options they were measured
// with. Fewer than three frames, or frames the toolkit refuses as one stack, are reported as not evaluated.
function assessSequence(frames: readonly AcceptedFrame[], options: FlatMeasurementOptions): FlatWizardSequenceResult {
	if (frames.length < 3) return { status: 'notEvaluated', reason: 'At least three accepted frames are needed' }

	try {
		const result = finalizeFlatSequence(
			frames.map((frame) => frame.sample),
			{ analysis: options, outlierSigma: SEQUENCE_OUTLIER_SIGMA },
		)
		const outliers = new Set(result.planes.flatMap((plane) => plane.outliers))
		return { status: 'evaluated', verdict: result.assessment.verdict, reasons: result.assessment.reasons, planes: result.planes, outliers: frames.filter((_, index) => outliers.has(index)).map((frame) => frame.file) }
	} catch (error) {
		return { status: 'notEvaluated', reason: Error.isError(error) ? error.message : String(error) }
	}
}

// Publishes the original bytes of a staged frame under its final path, never replacing an existing file: a hard
// link on the same file system, or an exclusive copy where links are unsupported. The staged file is removed once
// the final one exists. Throws when the final path exists or cannot be written.
export async function publishFrame(staged: string, path: string) {
	try {
		await link(staged, path)
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw error

		try {
			await copyFile(staged, path, constants.COPYFILE_EXCL)
		} catch (copyError) {
			// An exclusive copy that failed midway must not leave a partial frame behind.
			if ((copyError as NodeJS.ErrnoException).code !== 'EEXIST') await rm(path, { force: true })
			throw copyError
		}
	}

	await unlink(staged)
}

// Returns a failure with a detail meant for people, keeping its reason.
function failedWith(result: OperationResult<unknown> & { readonly ok: false }, message: string) {
	return failedOperationResult(result.reason, result.error ? `${message}: ${result.error}` : message)
}

// Routes of the Flat Wizard sessions.
export function createFlatWizardRoutes(flatWizard: FlatWizardSessions) {
	return {
		'/api/flat-wizard': {
			// The latest Flat Wizard session of every camera, started by any tab.
			GET: () => Response.json(flatWizard.snapshot()),
		},
		'/api/flat-wizard/:sessionId': {
			// A Flat Wizard session with its latest exposures; 404 when it is not the latest of its camera.
			GET: (req) => flatWizard.session(req.params.sessionId),
		},
		'/api/flat-wizard/:sessionId/continue': {
			// Confirms the manual step a Flat Wizard session waits for.
			POST: async (req) => flatWizard.continue(req.params.sessionId, (await req.json()) as FlatWizardContinueRequest),
		},
		'/api/flat-wizard/:sessionId/stop': {
			// Stops a Flat Wizard session; the exposure in flight is lost and published frames stay.
			POST: (req) => flatWizard.stop(req.params.sessionId),
		},
		'/api/connections/:id/cameras/:deviceId/flat-wizard': {
			// Starts a Flat Wizard session with this camera; progress arrives as flatWizard:updated events.
			POST: async (req) => flatWizard.start(req.params.id, req.params.deviceId, (await req.json()) as FlatWizardRequest),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
