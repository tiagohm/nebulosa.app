import { mkdtemp, rm, unlink } from 'fs/promises'
import { tmpdir } from 'os'
import { basename, join } from 'path'
import type { FocuserMover } from 'nebulosa/src/devices/commanders/focuser'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import { type OperationContext, type OperationFailureReason, type OperationHandle, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortableDelay } from 'nebulosa/src/devices/orchestration/operation.wait'
import { type ResourceRequest, resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import type { CameraCapturer } from 'nebulosa/src/observation/capture/capture'
import { SYSTEM_CAMERA_CAPTURE_CLOCK } from 'nebulosa/src/observation/capture/types'
import type { AutoFocusFittingMode } from 'nebulosa/src/observation/focus/autofocus'
import { type AutoFocusCaptureOptions, type AutoFocusRunEvent, type AutoFocusRunResult, autoFocusCaptureRequest, runAutoFocus } from 'nebulosa/src/observation/focus/autofocus.runner'
import { type FocusCurve, focusCurve } from './autofocus.curve'
import { type CaptureFrameRegistry, captureFrameId } from './captureframes'
import { type CaptureFrame, type CaptureSettings, type CaptureSnoop, snoopedDevices } from './captures'
import { busy, type ClientResolver, type CommandRequest, connectedDevice, errorResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { ImageInfo, ImageStore } from './images'
import type { OperationDevice, OperationRegistry } from './operations'
import { StarDetectionError, type StarDetectionPreparation, type StarDetectionRequest, type StarDetectionService, type StarDetectorProvider } from './stars'

// Auto Focus service: runs the toolkit's runAutoFocus for one camera and one focuser inside a single operation of
// the process-wide registry, which holds both devices for the whole session, so neither a capture nor a manual
// focuser move can come between a move and the frame measured there. The runner owns the sampling, the curve
// fitting and the best position; this service adapts the shared services to it: the backlash compensated mover of
// the focuser commands (with an optional settle wait after each move), the camera capturer of the capture service
// (its auxiliary FITS frames written to a temporary directory and deleted after each measurement, never saved as
// captures), and the shared star detection, whose median HFD of the accepted stars is the measurement. The provider
// and its ASTAP settings are resolved once when a session starts and never change during it.
//
// Each frame is decoded into the image store as a capture document and recorded in the capture frame registry as
// the latest frame of its camera (origin autofocus, identified by the session id and the frame number), the same
// latest frame Camera Capture updates, before it is measured; the registry owns its closing, so only the latest
// frame of each camera and the frames leased by clients stay open, and none is ever among the saved frames. Once the
// runner placed the focuser at the best focus, one more frame there verifies the HFD reached. A session belongs to the server: it survives tab reloads and workspace changes, is
// stopped only by its stop route, an Equipment Control stop of its focuser, or a disconnection, and its record (the
// measurements and the fitted curve, never pixels) is kept in memory until the next session of the same camera.
// A stop never moves the focuser back; a failure lets the runner restore the start position. Positions are focuser
// steps, HFD is in pixels, request durations are seconds. Every frame snoops the focuser of the session and the
// mount, filter wheel and rotator the request names into its header.

// Settings of the frames of a session; the exposure in seconds. The frame type is always LIGHT.
export type AutoFocusCaptureSettings = Pick<CaptureSettings, 'exposureTime' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/connections/:id/cameras/:deviceId/autofocus.
export interface AutoFocusRequest extends CommandRequest {
	// Focuser to move, by its exact connection and device ids.
	readonly focuser: OperationDevice
	// Camera settings of every frame.
	readonly capture: AutoFocusCaptureSettings
	// Mount, filter wheel and rotator snooped into the frame headers besides the focuser, which always is; absent
	// snoops only the focuser.
	readonly snoop?: Omit<CaptureSnoop, 'focuser'>
	// Star detector, its settings, and the acceptance criteria of the stars entering the aggregate HFD.
	readonly detection: StarDetectionRequest
	// Curve fitting that places the best focus.
	readonly fittingMode: AutoFocusFittingMode
	// Positions sampled on each side of the start, >= 1.
	readonly initialOffsetSteps: number
	// Distance between sampled positions, in steps, >= 1.
	readonly stepSize: number
	// Whether the sweep starts inwards instead of outwards.
	readonly reversed: boolean
	// Largest RMSD of a fitted curve over its HFD at the best focus; 0 accepts any fit.
	readonly rmsdThreshold: number
	// Wait after each completed focuser move before the next exposure, in seconds; 0 waits nothing.
	readonly settleDelay: number
	// Longest star detection of one frame, in seconds; > 0.
	readonly measureTimeout: number
}

// What a session is doing:
// - preparing: the session is acquiring the devices and reading the start position.
// - moving: the focuser moves to the next sampled position.
// - settling: the focuser reached it and the settle delay runs.
// - exposing: the camera takes a frame.
// - measuring: the stars of the frame are being detected.
// - applying: the focuser moves to the best focus the curve placed.
// - verifying: a frame at the best focus is being taken and measured.
// - restoring: a failure moves the focuser back to the start position.
// - stopping: a stop was requested and the session is ending.
// - completed: the focuser stands at the best focus.
// - failed: the session ended because of an error, given in reason and error.
// - cancelled: the session was stopped; the focuser stands wherever the stop found it.
export type AutoFocusState = 'preparing' | 'moving' | 'settling' | 'exposing' | 'measuring' | 'applying' | 'verifying' | 'restoring' | 'stopping' | 'completed' | 'failed' | 'cancelled'

// Outcome of the verification frame at the best focus:
// - pending: not taken yet.
// - measured: its HFD is verifiedHfd.
// - noStars: too few accepted stars to aggregate an HFD.
// - failed: the frame could not be taken or measured; the reason is verificationError.
// - skipped: the session ended before reaching the best focus.
export type AutoFocusVerification = 'pending' | 'measured' | 'noStars' | 'failed' | 'skipped'

// One sampled frame of a session.
export interface FocusMeasurement {
	// Frame number within the session, from 1.
	readonly capture: number
	// Position the runner asked for, in steps.
	readonly requestedPosition: number
	// Logical position the focuser reported once the move ended, in steps.
	readonly observedPosition: number
	// Id of the capture document of the frame in the image store; it stays open only while it is the latest frame of
	// its camera in the capture frame registry, or a client leases it.
	readonly imageId?: string
	// Aggregate HFD of the accepted stars, in pixels; absent when the frame is an invalid point of the curve.
	readonly hfd?: number
	// Stars the detector found.
	readonly detectedCount: number
	// Stars that met the acceptance criteria.
	readonly acceptedCount: number
	// Duration of the star detection, in milliseconds; 0 when it did not run.
	readonly elapsed: number
	// Problems of the measurement meant for people, such as a failed detection.
	readonly warnings: readonly string[]
	// Instant the exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
}

// Latest frame of a session, as recorded in the capture frame registry.
export interface AutoFocusFrame {
	// Id of the capture document.
	readonly imageId: string
	// Frame number within the session, from 1; the verification frame follows the sampled ones.
	readonly capture: number
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Bayer pattern of a mono mosaic; absent for a plain mono or color image.
	readonly cfa?: ImageInfo['cfa']
	// Instant the exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
}

// Session record published to clients, without its measurements and curve.
export interface AutoFocusSessionSummary {
	// Id of the session.
	readonly sessionId: string
	// Id of the operation holding the camera and the focuser.
	readonly operationId: string
	// Camera taking the frames.
	readonly camera: OperationDevice
	// Name of the camera.
	readonly cameraName: string
	// Focuser being moved.
	readonly focuser: OperationDevice
	// Name of the focuser.
	readonly focuserName: string
	// Request the session runs with.
	readonly request: Omit<AutoFocusRequest, 'token'>
	// Star detector of every measurement.
	readonly provider: StarDetectorProvider
	// What the session is doing.
	readonly state: AutoFocusState
	// Logical focuser position when the session started, in steps; absent while preparing.
	readonly initialPosition?: number
	// Target of the move in progress, in steps.
	readonly target?: number
	// Number of sampled frames so far.
	readonly measurementCount: number
	// Latest sampled frame.
	readonly lastMeasurement?: FocusMeasurement
	// Latest frame taken, sampled or verifying; its document may since have been closed by the registry.
	readonly latestFrame?: AutoFocusFrame
	// Best focus the curve placed, in steps (rounded); present once the curve was accepted.
	readonly estimatedPosition?: number
	// HFD of the fitted curve at the best focus, in pixels.
	readonly estimatedHfd?: number
	// Logical focuser position after the move to the best focus completed, in steps.
	readonly finalPosition?: number
	// Outcome of the verification frame.
	readonly verification: AutoFocusVerification
	// Aggregate HFD measured at the best focus, in pixels; present when verification is measured.
	readonly verifiedHfd?: number
	// Id of the capture document of the verification frame; open while it is the latest frame of its camera.
	readonly verificationImageId?: string
	// Why the verification failed.
	readonly verificationError?: string
	// Why the session failed.
	readonly reason?: OperationFailureReason
	// Detail of the failure meant for people.
	readonly error?: string
	// Instant the session started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the session ended, Unix milliseconds (UTC).
	readonly endedAt?: number
}

// Complete session record: the summary with every measurement and the fitted curve.
export interface AutoFocusSession extends AutoFocusSessionSummary {
	// Every sampled frame, in capture order.
	readonly measurements: readonly FocusMeasurement[]
	// Curve the runner fitted so far; absent before two positions were sampled.
	readonly curve?: FocusCurve
}

// Snapshot of GET /api/autofocus: the latest session of every camera.
export interface AutoFocusSnapshot {
	readonly sessions: readonly AutoFocusSessionSummary[]
}

// Response of an accepted session.
export interface AutoFocusStartResponse {
	// Id of the session, repeated by its autofocus:updated events.
	readonly sessionId: string
	// Id of the operation holding the camera and the focuser.
	readonly operationId: string
}

// Notification published whenever a session changes.
export type AutoFocusEvent = { readonly type: 'autofocus:updated'; readonly session: AutoFocusSessionSummary }

// Receiver of Auto Focus events.
export type AutoFocusListener = (event: AutoFocusEvent) => void

// Watchdog after an aborted star detection before it is reported unresponsive, in seconds.
const MEASURE_ABORT_GRACE = 10

// A session while its service knows it.
interface Session {
	summary: AutoFocusSessionSummary
	measurements: FocusMeasurement[]
	curve?: FocusCurve
	// Operation holding the devices; absent only before it started.
	handle?: OperationHandle<AutoFocusRunResult>
	// Frame being taken or measured, before the runner reports its sample.
	frame?: { readonly capture: number; readonly requestedPosition: number; readonly observedPosition: number; readonly time: number; imageId?: string; detail?: Pick<FocusMeasurement, 'detectedCount' | 'acceptedCount' | 'elapsed' | 'warnings'> }
}

// Result of measuring one frame.
interface FrameMeasurement {
	// Whether the star detection completed; false when the frame could not be decoded or detected.
	readonly measured: boolean
	// Aggregate HFD, in pixels; absent when too few stars were accepted or the detection did not complete.
	readonly hfd?: number
	readonly imageId?: string
	readonly detail: Pick<FocusMeasurement, 'detectedCount' | 'acceptedCount' | 'elapsed' | 'warnings'>
}

// Auto Focus sessions of the cameras of every open connection.
export class AutoFocusSessions {
	// Latest session of each camera, by camera resource key.
	readonly #sessions = new Map<string, Session>()
	// Session of each operation a command token started, so a repeated start answers it.
	readonly #byOperation = new Map<string, Session>()

	// Creates the service. client resolves an open connection id to its client, operations holds and publishes
	// every session, capturer takes the frames (the one of the capture service), mover moves the focusers with
	// their backlash compensation, images receives the frames, frames records them as the latest frame of their camera
	// and closes them, stars measures them, and listener receives every
	// session change synchronously. auxiliaryDir is the parent of the temporary directory of each session.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly capturer: CameraCapturer,
		readonly mover: FocuserMover,
		readonly images: ImageStore,
		readonly frames: CaptureFrameRegistry,
		readonly stars: StarDetectionService,
		readonly listener: AutoFocusListener,
		readonly auxiliaryDir: string = tmpdir(),
	) {}

	// Returns the latest session of every camera.
	snapshot(): AutoFocusSnapshot {
		return { sessions: Array.from(this.#sessions.values(), (session) => session.summary) }
	}

	// Responds with a complete session, or 404 when it is not the latest of its camera.
	session(sessionId: string): Response {
		const session = this.#find(sessionId)
		return session ? Response.json(this.#complete(session)) : errorResponse('Auto Focus session not found', 404, 'notFound')
	}

	// Starts a session. Responds 202 with AutoFocusStartResponse once accepted (a repeated token answers its first
	// session); its progress and outcome arrive as autofocus:updated and operation:updated events. Responds 404 for
	// an unknown camera or focuser, 409 when either is disconnected or held by another operation, and 422 when the
	// focuser cannot move to absolute positions or the detector is ASTAP and it is not configured.
	async start(connectionId: string, deviceId: string, request: AutoFocusRequest): Promise<Response> {
		const known = this.operations.started(request.token)
		const repeated = known && this.#byOperation.get(known.operationId)
		if (repeated) return Response.json({ sessionId: repeated.summary.sessionId, operationId: repeated.summary.operationId } satisfies AutoFocusStartResponse, { status: 202 })

		// The provider settings are resolved first, so nothing can take the devices between the checks below and the start.
		const preparation = await this.stars.prepare(request.detection)
		if (!preparation) return unsupported('ASTAP is not configured; set it up in Settings → External Tools or measure with the built-in detector')

		const camera = connectedDevice(this.devices, this.client, connectionId, 'camera', deviceId, 'Camera')
		if (camera instanceof Response) return camera
		const focuser = connectedDevice(this.devices, this.client, request.focuser.connectionId, 'focuser', request.focuser.deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canAbsoluteMove) return unsupported(`${focuser.name} cannot move to absolute positions, which the Auto Focus needs`)
		if (!this.operations.available(camera) || !this.operations.available(focuser)) return busy()

		const { token, ...settings } = request
		const cameraDevice = { connectionId, deviceId }
		const session: Session = {
			summary: {
				sessionId: crypto.randomUUID(),
				operationId: '',
				camera: cameraDevice,
				cameraName: camera.name,
				focuser: request.focuser,
				focuserName: focuser.name,
				request: settings,
				provider: request.detection.detector.provider,
				state: 'preparing',
				measurementCount: 0,
				verification: 'pending',
				startedAt: Date.now(),
			},
			measurements: [],
		}

		const record = this.operations.run('focuser.autofocus', cameraDevice.connectionId === request.focuser.connectionId && cameraDevice.deviceId === request.focuser.deviceId ? [cameraDevice] : [cameraDevice, request.focuser], token, () => {
			const handle = this.#run(session, camera, focuser, preparation)
			session.handle = handle
			return handle.result
		})

		const key = resourceKey(camera)
		const previous = this.#sessions.get(key)
		if (previous) this.#forget(previous)
		this.#sessions.set(key, session)
		this.#byOperation.set(record.operationId, session)
		this.#update(session, { operationId: record.operationId })

		void session.handle!.result.then((result) => this.#ended(session, result))
		return Response.json({ sessionId: session.summary.sessionId, operationId: record.operationId } satisfies AutoFocusStartResponse, { status: 202 })
	}

	// Stops a session: the move, exposure or detection in progress is cancelled and nothing more is commanded; the
	// focuser is not moved back. Resolves once the operation released the devices. Responds 204, and 404 when the
	// session is unknown or already ended.
	async stop(sessionId: string): Promise<Response> {
		const session = this.#find(sessionId)
		if (!session?.handle || session.summary.endedAt !== undefined) return errorResponse('No Auto Focus session is running with this id', 404, 'notFound')

		if (session.summary.state !== 'stopping') this.#update(session, { state: 'stopping', target: undefined })
		await session.handle.cancel('aborted')
		return new Response(null, { status: 204 })
	}

	// Starts the operation of a session holding its camera and focuser, and runs the autofocus and its
	// verification inside it.
	#run(session: Session, camera: Camera, focuser: Focuser, preparation: StarDetectionPreparation): OperationHandle<AutoFocusRunResult> {
		const resources: ResourceRequest[] = [{ key: resourceKey(camera), device: camera }]
		if (resourceKey(focuser) !== resourceKey(camera)) resources.push({ key: resourceKey(focuser), device: focuser })

		return this.operations.coordinator.start<AutoFocusRunResult>('autofocusSession', resources, async (context) => {
			const directory = await mkdtemp(join(this.auxiliaryDir, 'nebulosa-autofocus-'))

			try {
				const { request } = session.summary
				const { mount, wheel, rotator } = snoopedDevices(this.devices, camera, request.snoop)
				const capture: AutoFocusCaptureOptions = { ...request.capture, exposureTimeUnit: 'second', frameType: 'LIGHT', compressed: false, mount, wheel, rotator }
				const mover = this.#settlingMover(session, request.settleDelay)
				const measure = (path: string, signal: AbortSignal) => this.#measure(session, path, preparation, signal)

				const result = await runAutoFocus(
					context,
					focuser,
					camera,
					{
						algorithm: { initialOffsetSteps: request.initialOffsetSteps, stepSize: request.stepSize, fittingMode: request.fittingMode, reversed: request.reversed, rmsdThreshold: request.rmsdThreshold },
						capture,
						measureTimeout: request.measureTimeout,
						abortGrace: MEASURE_ABORT_GRACE,
					},
					{
						focuserMover: mover,
						cameraCapturer: this.capturer,
						measurer: async ({ path }, signal) => (await measure(path, signal)).hfd,
						auxiliaryPath: (n) => join(directory, `autofocus-${n}.fit`),
						clock: { ...SYSTEM_CAMERA_CAPTURE_CLOCK, delay: abortableDelay },
						listener: (event) => this.#progress(session, focuser, event),
					},
				)

				if (!result.ok) return result

				this.#update(session, { finalPosition: this.mover.position(focuser), estimatedPosition: result.value.position, estimatedHfd: Number.isFinite(result.value.hfd) ? result.value.hfd : undefined })
				await this.#verify(session, context, camera, focuser, capture, join(directory, 'autofocus-verification.fit'), measure)
				return successfulOperationResult(result.value)
			} finally {
				await rm(directory, { recursive: true, force: true })
			}
		})
	}

	// The backlash compensated mover of the focuser commands, followed by the settle delay (seconds) after each
	// completed move, inside the scope of the move.
	#settlingMover(session: Session, settleDelay: number): FocuserMover {
		const { mover } = this

		return {
			position: (focuser) => mover.position(focuser),
			moveTo: async (scope, focuser, position, options) => {
				const moved = await mover.moveTo(scope, focuser, position, options)
				if (!moved.ok || !(settleDelay > 0)) return moved
				this.#update(session, { state: 'settling' })
				return await scope.start<void>('autofocusSettle', [], (context) => abortableDelay(settleDelay * 1000, context.signal)).result
			},
		}
	}

	// Follows the progress the runner reports.
	#progress(session: Session, focuser: Focuser, event: AutoFocusRunEvent) {
		if (session.summary.state === 'stopping') return

		switch (event.type) {
			case 'move': {
				// The runner reads the start position just before its first move.
				const initialPosition = session.summary.initialPosition ?? this.mover.position(focuser)
				this.#update(session, { state: event.purpose === 'sample' ? 'moving' : event.purpose === 'best' ? 'applying' : 'restoring', target: event.target, initialPosition })
				break
			}
			case 'expose':
				session.frame = { capture: event.capture, requestedPosition: event.position, observedPosition: this.mover.position(focuser), time: Date.now() }
				this.#update(session, { state: 'exposing', target: undefined })
				break
			case 'measure':
				this.#update(session, { state: 'measuring' })
				break
			case 'sample': {
				const frame = session.frame
				const detail = frame?.detail ?? { detectedCount: 0, acceptedCount: 0, elapsed: 0, warnings: [] }
				const measurement: FocusMeasurement = {
					capture: event.capture,
					requestedPosition: event.position,
					observedPosition: frame?.observedPosition ?? event.position,
					...(frame?.imageId !== undefined && { imageId: frame.imageId }),
					...(event.hfd !== undefined && { hfd: event.hfd }),
					...detail,
					time: frame?.time ?? Date.now(),
				}
				session.frame = undefined
				session.measurements.push(measurement)
				session.curve = focusCurve(event.autoFocus, session.summary.request.fittingMode)
				this.#update(session, { measurementCount: session.measurements.length, lastMeasurement: measurement })
				break
			}
		}
	}

	// Decodes a frame file into the image store, records it as the latest frame of the camera in the capture frame
	// registry, which closes the previous one unless leased, and measures its aggregate HFD with the prepared
	// detector, whose job retains the document until it ends. A frame that cannot be decoded or measured is an invalid
	// point, with the reason in its warnings; a cancellation rejects, so the runner ends the session.
	async #measure(session: Session, path: string, preparation: StarDetectionPreparation, signal: AbortSignal): Promise<FrameMeasurement> {
		const { camera, cameraName, sessionId } = session.summary
		const capture = session.frame?.capture ?? 0
		let imageId: string | undefined
		let detail: FrameMeasurement['detail'] = { detectedCount: 0, acceptedCount: 0, elapsed: 0, warnings: [] }

		try {
			const bytes = new Uint8Array(await Bun.file(path).arrayBuffer())
			const time = session.frame?.time ?? Date.now()
			const frameId = captureFrameId(sessionId, capture)
			const info = await this.images.openCapture(bytes, basename(path), { ...camera, frameId, time })
			imageId = info.id
			const { width, height, channels, cfa, acquisition } = info
			const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
			const frame: CaptureFrame = { imageId: info.id, sessionId, ...camera, generation: capture, time, frameType: 'LIGHT', width, height, channels, cfa, bitpix, acquisition }
			this.frames.previewed(info, frame, cameraName, 'autofocus')
			if (session.frame) session.frame.imageId = info.id
			this.#update(session, { latestFrame: { imageId: info.id, capture, width: info.width, height: info.height, ...(info.cfa && { cfa: info.cfa }), time } })

			const result = await this.stars.measure(info.id, preparation, signal, { kind: 'autofocus', sessionId, ...camera, frameId, capture })
			detail = { detectedCount: result.detectedCount, acceptedCount: result.acceptedCount, elapsed: result.elapsed, warnings: result.measurement === 'ok' ? result.warnings : [...result.warnings, result.measurement === 'noStars' ? 'Too few accepted stars to measure the HFD.' : 'The HFD could not be measured.'] }
			if (session.frame) session.frame.detail = detail
			return { measured: true, hfd: result.aggregateHfd, imageId, detail }
		} catch (error) {
			if (signal.aborted) throw error
			const message = error instanceof StarDetectionError ? error.message : `Unable to measure the frame: ${Error.isError(error) ? error.message : String(error)}`
			detail = { ...detail, warnings: [message] }
			if (session.frame) session.frame.detail = detail
			return { measured: false, imageId, detail }
		}
	}

	// Takes and measures one frame at the best focus inside the operation of the session and records its HFD.
	// Its failure never fails the session, whose focuser already stands at the best focus.
	async #verify(session: Session, context: OperationContext, camera: Camera, focuser: Focuser, capture: AutoFocusCaptureOptions, path: string, measure: (path: string, signal: AbortSignal) => Promise<FrameMeasurement>) {
		this.#update(session, { state: 'verifying', target: undefined })
		session.frame = { capture: session.measurements.length + 1, requestedPosition: this.mover.position(focuser), observedPosition: this.mover.position(focuser), time: Date.now() }

		try {
			const captured = await this.capturer.start(context, camera, autoFocusCaptureRequest(capture, path, focuser), { clock: SYSTEM_CAMERA_CAPTURE_CLOCK }).result

			if (!captured.ok) {
				if (!context.signal.aborted) this.#update(session, { verification: 'failed', verificationError: captured.error ?? `The frame could not be taken (${captured.reason})` })
				return
			}

			const signal = AbortSignal.any([context.signal, AbortSignal.timeout(session.summary.request.measureTimeout * 1000)])
			let measured: FrameMeasurement

			try {
				measured = await measure(path, signal)
			} catch {
				if (!context.signal.aborted) this.#update(session, { verification: 'failed', verificationError: `The measurement did not finish in ${session.summary.request.measureTimeout} s` })
				return
			}

			const image = measured.imageId !== undefined ? { verificationImageId: measured.imageId } : {}
			if (measured.hfd !== undefined) this.#update(session, { verification: 'measured', verifiedHfd: measured.hfd, ...image })
			else if (measured.measured) this.#update(session, { verification: 'noStars', ...image })
			else this.#update(session, { verification: 'failed', verificationError: measured.detail.warnings.join(' ') || 'The HFD could not be measured', ...image })
		} finally {
			session.frame = undefined
			await unlink(path).catch(() => undefined)
		}
	}

	// Records the end of a session from the result of its operation.
	#ended(session: Session, result: OperationResult<AutoFocusRunResult>) {
		const { summary } = session
		const verification = summary.verification === 'pending' ? 'skipped' : summary.verification
		const endedAt = Date.now()
		session.frame = undefined

		if (result.ok) this.#update(session, { state: 'completed', target: undefined, verification, endedAt })
		else if (result.reason === 'aborted') this.#update(session, { state: 'cancelled', target: undefined, verification, endedAt })
		else this.#update(session, { state: 'failed', target: undefined, verification, reason: result.reason, ...(result.error !== undefined && { error: result.error }), endedAt })
	}

	// Forgets a session replaced by a newer one of its camera; its latest frame stays with the registry.
	#forget(session: Session) {
		this.#byOperation.delete(session.summary.operationId)
	}

	// Returns the latest session with this id.
	#find(sessionId: string): Session | undefined {
		for (const session of this.#sessions.values()) if (session.summary.sessionId === sessionId) return session
		return undefined
	}

	// Returns the complete record of a session.
	#complete(session: Session): AutoFocusSession {
		return { ...session.summary, measurements: session.measurements, ...(session.curve && { curve: session.curve }) }
	}

	// Publishes a changed session; a session replaced by a newer one of its camera changes silently.
	#update(session: Session, patch: Partial<AutoFocusSessionSummary>) {
		session.summary = { ...session.summary, ...patch }
		const latest = Array.from(this.#sessions.values()).includes(session)
		if (latest) this.listener({ type: 'autofocus:updated', session: session.summary })
	}
}
