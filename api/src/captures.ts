import { homedir } from 'os'
import { basename, join } from 'path'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { Camera, CameraTransferFormat, Client } from 'nebulosa/src/devices/indi/device'
import type { OperationFailureReason } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { numericKeyword } from 'nebulosa/src/io/formats/fits/util'
import { type CameraCaptureHandle, CameraCapturer, type CameraFramePathRequest, writeFrameExclusively } from 'nebulosa/src/observation/capture/capture'
import { type CameraCaptureEvent, type CameraCaptureStart, type CameraCaptureTime, DEFAULT_CAMERA_CAPTURE_START } from 'nebulosa/src/observation/capture/types'
import type { DeviceRegistry } from './devices'
import type { ImageAcquisition, ImageInfo, ImageStore } from './images'
import type { OperationRegistry } from './operations'
import type { StarDetectionJob, StarDetectionPreparation, StarDetectionRequest, StarDetectionReservation, StarDetectionService, StarDetectorProvider } from './stars'

// Camera Capture service: single, fixed-count, and loop acquisitions of one camera, run on the server through
// the toolkit's CameraCapturer under the process-wide operation registry, so the camera stays held for the
// whole capture (inter-frame delays included) and no other operation can expose it meanwhile. A capture is
// addressed by the exact connection and device ids of the camera, never by a role, and belongs to the
// server: tabs only start, stop, abort, and observe it, through the routes and the capture:updated and
// capture:frame events, and the snapshot of GET /api/captures after any reconnect.
//
// The delay is the wait between the end of one frame (exposure, transfer, decoding, and the confirmed write
// when saving) and the start of the next, never a cadence: there is none before the first frame or after the
// last, and stopping during it ends the capture at once. With Preview + Save each frame is written as the
// bytes the driver sent, under the configured directory and filename template, by an exclusive write that
// never replaces a file; the saved count rises only once the write completed, and a failed write ends the
// capture. Every frame is also decoded into the image store as its own capture document, independently of
// the write: the latest frame of each camera is kept and the previous one closed. Decoding never delays the
// capture: while a frame of a camera is being decoded, only the newest of the frames arriving meanwhile is
// kept for decoding next, so a fast loop previews fewer frames than it saves. Exposure and delay times are
// in seconds in requests and microseconds in progress.
//
// A capture may also analyze its frames with the shared star detection service (post-capture analysis),
// configured once by its request, with ASTAP's settings resolved when it starts. The analysis never changes
// how frames are taken or saved, and its failures never fail the capture; its counters are its own. With
// Every Frame, each frame is decoded as its own document and analyzed: the capacity of a frame is reserved
// before its exposure, so when the analysis lags the next exposure waits for room (phase analysisWait) on
// top of the delay, which is never changed. With Latest Frame Only, the previewed frames are analyzed and a
// newer frame replaces one still waiting, which is counted as skipped; the capture never waits for it.
// Analyses already accepted finish after a stop or an abort. The analysis halts, and the capture goes on,
// when ASTAP cannot run or MAX_CONSECUTIVE_ANALYSIS_FAILURES frames in a row fail.

// Directory saved frames go into when a request names none, and the published path of previewed frames.
export const DEFAULT_CAPTURES_DIR = join(homedir(), 'Nebulosa', 'captures')

// Filename template of saved frames when a request names none.
export const DEFAULT_FILENAME_TEMPLATE = '{date}_{time}_{camera}_{type}_{seq}'

// What a capture does with its frames: preview and write each one to a file of the server, or only preview it.
export type CaptureOutputMode = 'preview-save' | 'preview-only'

// How a post-capture analysis forwards frames to the star detection: every frame, holding the next exposure
// while there is no room, or only the latest frame, skipping a frame still waiting when a newer one arrives.
export type PostCaptureAnalysisPolicy = 'everyFrame' | 'latestFrame'

// Star detection of the frames of a capture.
export interface PostCaptureAnalysis {
	// How frames are forwarded.
	readonly policy: PostCaptureAnalysisPolicy
	// Detector, settings, and acceptance criteria of every frame.
	readonly request: StarDetectionRequest
}

// Payload format a frame is transferred and saved in; NATIVE payloads cannot be decoded or saved as frames.
export type CaptureFormat = Exclude<CameraTransferFormat, 'NATIVE'>

// Destination of the frames of a capture.
export interface CaptureOutput {
	// Whether frames are saved as well as previewed.
	readonly mode: CaptureOutputMode
	// Absolute directory of the server saved frames go into; DEFAULT_CAPTURES_DIR when absent.
	readonly directory?: string
	// Name of each saved frame without its extension, with the placeholders {camera}, {type}, {date}
	// (YYYY-MM-DD), {time} (HH-mm-ss-SSS), and {seq} (the frame number, from 0001), all in the server's local
	// time at the moment the exposure is commanded; DEFAULT_FILENAME_TEMPLATE when absent.
	readonly filenameTemplate?: string
	// Format the driver transfers and the frame is saved in.
	readonly format: CaptureFormat
}

// Camera settings and acquisition of a capture, the toolkit's request fields with the exposure in seconds.
// Gain, offset, binning, subframe, and readout mode a camera does not support are left unchanged.
export type CaptureSettings = Pick<CameraCaptureStart, 'exposureMode' | 'count' | 'delay' | 'exposureTime' | 'frameType' | 'gain' | 'offset' | 'binX' | 'binY' | 'subframe' | 'x' | 'y' | 'width' | 'height' | 'frameFormat'>

// Body of POST /api/connections/:id/cameras/:deviceId/capture. exposureTime and delay are in seconds.
export interface CaptureRequest extends CaptureSettings {
	// Destination of the frames.
	readonly output: CaptureOutput
	// Star detection of the frames; absent when the capture does not analyze them.
	readonly analysis?: PostCaptureAnalysis
}

// Response of an accepted capture.
export interface CaptureStartResponse {
	// Id of the capture session, repeated by its capture events.
	readonly sessionId: string
	// Id of the operation holding the camera, repeated by its operation:updated events.
	readonly operationId: string
}

// What a capture is doing, as far as the camera and the service report it:
// - starting: the capture is acquiring the camera and applying its settings.
// - exposing: an exposure was commanded or is running.
// - reading: the exposure finished and its frame is being transferred and decoded.
// - saving: the frame is being written to its file.
// - waiting: the delay before the next frame is running.
// - analysisWait: the next exposure waits for room in the star detection of an Every Frame analysis.
// - completed: every requested frame was taken.
// - stopped: the capture was stopped and ended after its last frame.
// - aborted: the capture was aborted; the exposure in flight was lost.
// - failed: the capture ended because of an error, given in reason and error.
export type CapturePhase = 'starting' | 'exposing' | 'reading' | 'saving' | 'waiting' | 'analysisWait' | 'completed' | 'stopped' | 'aborted' | 'failed'

// State of the write of a saved frame's file, independent of the capture's outcome:
// - saving: the write has not completed yet.
// - saved: the file was completely written.
// - failed: the write failed, which also ends the capture.
export type CaptureFileState = 'saving' | 'saved' | 'failed'

// Frame of a capture that was decoded into the image store.
export interface CaptureFrame {
	// Id of the capture document of the frame in the image store.
	readonly imageId: string
	// Id of the capture session that took it.
	readonly sessionId: string
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Frame number within the session, from 1.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// Absolute path of the file the frame is saved to; absent when it is only previewed.
	readonly path?: string
	// State of the write of the frame's file; absent when the frame is only previewed.
	readonly file?: CaptureFileState
	// Frame type the capture requested.
	readonly frameType: CaptureSettings['frameType']
	// Width of the image, in pixels.
	readonly width: number
	// Height of the image, in pixels.
	readonly height: number
	// Number of channels: 1 for grayscale or a raw CFA mosaic, 3 for RGB.
	readonly channels: number
	// CFA pattern at the image origin of a mono CFA mosaic (ImageInfo cfa); absent otherwise.
	readonly cfa?: ImageInfo['cfa']
	// FITS BITPIX of the frame: 8, 16, or 32 for integers, -32 or -64 for floats; absent when not reported.
	readonly bitpix?: number
	// Acquisition data the driver wrote into the frame's header.
	readonly acquisition: ImageAcquisition
}

// Progress of the post-capture analysis of a session, counted apart from the captured and saved frames.
export interface CaptureAnalysisState {
	// How frames are forwarded.
	readonly policy: PostCaptureAnalysisPolicy
	// Detector of the analysis.
	readonly provider: StarDetectorProvider
	// Frames whose star detection completed.
	readonly analyzed: number
	// Frames whose star detection waits or runs.
	readonly pending: number
	// Frames whose star detection failed, including frames that could not be decoded for it.
	readonly failed: number
	// Frames not analyzed: replaced by a newer frame, cancelled, or refused by a full queue.
	readonly skipped: number
	// Whether the next exposure waits for room in the star detection.
	readonly waiting: boolean
	// Why the analysis stopped forwarding frames; absent while it runs.
	readonly halted?: string
}

// State of a capture session as published to clients. It stays listed after it ends, until the next capture
// of the same camera replaces it, so its outcome can still be shown.
export interface CaptureSession {
	// Id of the capture session.
	readonly sessionId: string
	// Id of the operation holding the camera.
	readonly operationId: string
	// Id of the open connection that provides the camera.
	readonly connectionId: string
	// Exact id of the camera.
	readonly deviceId: string
	// Driver-reported camera name.
	readonly cameraName: string
	// Request the session runs, as received; it never changes while the session runs.
	readonly request: CaptureRequest
	// What the capture is doing, or how it ended.
	readonly phase: CapturePhase
	// Whether a stop was requested: the capture ends after the exposure in flight.
	readonly stopping: boolean
	// Frames taken and decoded, whether or not they were saved.
	readonly captured: number
	// Frames whose file was completely written.
	readonly saved: number
	// Frames requested; absent for a loop.
	readonly count?: number
	// Progress of the current exposure, in microseconds; absent when the driver reported none.
	readonly exposure?: CameraCaptureTime
	// Progress of the current delay, in microseconds; absent while not waiting, and for delays under 1 s.
	readonly delay?: CameraCaptureTime
	// Instant the capture started, Unix milliseconds (UTC).
	readonly startedAt: number
	// Instant the capture ended, Unix milliseconds (UTC); absent while it runs.
	readonly endedAt?: number
	// Why the capture failed or was aborted; present only when the phase is failed or aborted.
	readonly reason?: OperationFailureReason
	// Human-readable detail of the failure, when there is one.
	readonly error?: string
	// Why the latest frame could not be previewed; cleared by the next previewed frame.
	readonly previewError?: string
	// Progress of the post-capture analysis; absent when the capture does not analyze its frames.
	readonly analysis?: CaptureAnalysisState
}

// Snapshot of GET /api/captures: the latest session and the latest previewed frame of each camera.
export interface CaptureSnapshot {
	// Latest session of each camera, running or ended.
	readonly sessions: readonly CaptureSession[]
	// Latest previewed frame of each camera.
	readonly frames: readonly CaptureFrame[]
}

// Notification published when a capture session changes, and when a frame is previewed or saved.
export type CaptureEvent = { readonly type: 'capture:updated'; readonly session: CaptureSession } | { readonly type: 'capture:frame'; readonly frame: CaptureFrame }

// Receiver of capture events.
export type CaptureListener = (event: CaptureEvent) => void

// Frames of a session remembered behind the newest one, so a loop keeps a bounded record. Only the newest
// frame waits for preview, so a frame being decoded is at most a few generations old.
const FRAME_HISTORY = 8

// Consecutive failed star detections that halt the analysis of a session.
const MAX_CONSECUTIVE_ANALYSIS_FAILURES = 3

// What the service knows of one frame of a running session.
interface FrameRecord {
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// File the frame is saved to, when saving.
	readonly path?: string
	// State of the write of that file, when saving.
	file?: CaptureFileState
}

// Frame of a running session waiting to be decoded, or being decoded.
interface PendingFrame {
	// Copy of the frame bytes, owned by the service until they are transferred to the image worker.
	readonly bytes: Uint8Array<ArrayBuffer>
	// Frame number within the session.
	readonly generation: number
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// File the frame is saved to, when saving.
	readonly path?: string
	// Star detection capacity reserved for the frame by an Every Frame analysis; such a frame is never dropped.
	readonly reservation?: StarDetectionReservation
}

// Post-capture analysis of a running or ended session.
interface ActiveAnalysis {
	// Request and provider settings, resolved when the capture started.
	readonly preparation: StarDetectionPreparation
	// How frames are forwarded.
	readonly policy: PostCaptureAnalysisPolicy
	// Scheduling group of the reservations of the session.
	readonly group: string
	// Capacity reserved for the frame whose exposure is next, until the frame is published.
	reservation?: StarDetectionReservation
	// Failed star detections in a row.
	consecutiveFailures: number
}

// Running capture of one camera, with what the service needs to follow it.
interface ActiveCapture {
	// Published state, replaced on every change.
	session: CaptureSession
	// Toolkit capture that is running.
	handle?: CameraCaptureHandle
	// Camera taking the frames.
	readonly camera: Camera
	// Latest frames of the session, by generation; older ones are forgotten (see FRAME_HISTORY).
	readonly frames: Map<number, FrameRecord>
	// Generation of the exposure currently open.
	generation: number
	// Post-capture analysis; absent when the capture does not analyze its frames.
	readonly analysis?: ActiveAnalysis
}

// Preview state of one camera: the frame shown, and decoding in progress.
interface CameraPreview {
	// Latest previewed frame.
	frame?: CaptureFrame
	// Whether a frame is being decoded.
	decoding: boolean
	// Frames received while decoding, decoded next in order: every frame with a reservation, and only the
	// newest of those without one.
	readonly queue: (PendingFrame & { readonly session: ActiveCapture })[]
}

// Responds with an error message and a status.
function errorResponse(message: string, status: number) {
	return Response.json({ error: message }, { status })
}

// Characters no file name may contain on some supported platform, besides the control characters.
const FORBIDDEN_FILE_NAME_CHARACTERS: ReadonlySet<string> = new Set(['\\', '/', '<', '>', ':', '"', '|', '?', '*'])

// Replaces the characters a file name cannot contain on any platform (separators, control characters, and
// the ones Windows forbids) with `_`, and drops trailing dots and spaces, which Windows strips.
export function sanitizeFileName(name: string) {
	let sanitized = ''
	for (const character of name) sanitized += character.charCodeAt(0) < 32 || FORBIDDEN_FILE_NAME_CHARACTERS.has(character) ? '_' : character
	return sanitized.replace(/[. ]+$/, '')
}

// Fields a filename template is filled with.
export interface FrameNameFields {
	// Camera name.
	readonly camera: string
	// Frame type, such as LIGHT.
	readonly type: string
	// Instant the exposure is commanded, Unix milliseconds (UTC).
	readonly time: number
	// Frame number within the session, from 1.
	readonly generation: number
	// Offset of the local time zone at time, in minutes east of UTC.
	readonly timezoneOffset: number
}

// Fills a filename template with a frame's fields and sanitizes the result (see CaptureOutput for the
// placeholders); an unknown placeholder is kept as written. Returns `frame` when nothing usable is left.
export function frameName(template: string, { camera, type, time, generation, timezoneOffset }: FrameNameFields) {
	const values: Readonly<Record<string, string>> = {
		camera,
		type,
		date: formatTemporal(time, 'YYYY-MM-DD', timezoneOffset),
		time: formatTemporal(time, 'HH-mm-ss-SSS', timezoneOffset),
		seq: String(generation).padStart(4, '0'),
	}

	return sanitizeFileName(template.replaceAll(/\{(\w+)\}/g, (placeholder, key: string) => values[key] ?? placeholder)) || 'frame'
}

// Returns a session with fields replaced.
function changed(session: CaptureSession, patch: Partial<CaptureSession>): CaptureSession {
	return { ...session, ...patch }
}

// Captures of the cameras of every open connection.
export class CameraCaptures implements Disposable {
	// Toolkit capturer shared by every camera; it routes the callbacks of each camera to its own capture.
	readonly #capturer: CameraCapturer
	// Running capture of each camera, by camera resource key.
	readonly #active = new Map<string, ActiveCapture>()
	// Latest session of each camera, running or ended, by camera resource key.
	readonly #sessions = new Map<string, CaptureSession>()
	// Preview state of each camera, by camera resource key.
	readonly #previews = new Map<string, CameraPreview>()
	// Capture and generation of each frame path being saved, so the write can be attributed to its frame.
	readonly #writes = new Map<string, { readonly capture: ActiveCapture; readonly generation: number }>()

	// Creates the service over the device registry. client resolves an open connection id to its client,
	// operations holds and publishes every capture, images receives the frames, stars analyzes them, and
	// listener receives every capture event synchronously. capturesDir replaces DEFAULT_CAPTURES_DIR.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly operations: OperationRegistry,
		readonly images: ImageStore,
		readonly stars: StarDetectionService,
		readonly listener: CaptureListener,
		readonly capturesDir: string = DEFAULT_CAPTURES_DIR,
	) {
		this.#capturer = new CameraCapturer(devices.cameras, operations.arbiter, {
			capturesDir,
			// The focuser a request names, such as the one of an Auto Focus, is snooped into the frame headers.
			devices: { focuser: devices.focusers },
			publish: (frame, _, camera) => this.#published(frame, camera),
			write: (path, data) => this.#write(path, data),
		})
	}

	// Toolkit capturer of every camera, for composite features such as the Auto Focus that take their own frames
	// inside their operation; frames it takes for them never enter the capture sessions or previews of this service.
	get capturer(): CameraCapturer {
		return this.#capturer
	}

	// Returns the latest session and previewed frame of every camera.
	snapshot(): CaptureSnapshot {
		const frames: CaptureFrame[] = []
		for (const preview of this.#previews.values()) if (preview.frame) frames.push(preview.frame)
		return { sessions: Array.from(this.#sessions.values()), frames }
	}

	// Responds with the capabilities of a camera, or 404 when the connection is not open or has no such camera.
	capabilities(connectionId: string, deviceId: string): Response {
		const client = this.client(connectionId)
		const capabilities = client && this.devices.cameraCapabilities(client, deviceId)
		return capabilities ? Response.json(capabilities) : errorResponse('Camera not found', 404)
	}

	// Starts a capture. Responds 202 with CaptureStartResponse once it is accepted; its progress and outcome
	// arrive as capture:updated events. Responds 404 for an unknown camera, 409 when it is disconnected or
	// held by another operation, such as a capture started by another tab, and 422 when its analysis uses ASTAP
	// and ASTAP is not configured.
	async start(connectionId: string, deviceId: string, request: CaptureRequest): Promise<Response> {
		// The settings of the analysis are resolved first, so nothing can take the camera between the checks
		// below and the start.
		const preparation = request.analysis && (await this.stars.prepare(request.analysis.request))
		if (request.analysis && !preparation) return errorResponse('ASTAP is not configured; set it up in Settings → External Tools or analyze with the built-in detector', 422)

		const client = this.client(connectionId)
		const camera = client && this.devices.camera(client, deviceId)
		if (!camera) return errorResponse('Camera not found', 404)
		if (!camera.connected) return errorResponse('The camera is disconnected', 409)

		const key = resourceKey(camera)
		if (this.#active.has(key) || this.operations.arbiter.availability(key) !== 'available') return errorResponse('The camera is busy', 409)

		const saving = request.output.mode === 'preview-save'
		const start: CameraCaptureStart = {
			...structuredClone(DEFAULT_CAMERA_CAPTURE_START),
			exposureMode: request.exposureMode,
			count: request.count,
			delay: request.delay,
			exposureTime: request.exposureTime,
			exposureTimeUnit: 'second',
			frameType: request.frameType,
			gain: request.gain,
			offset: request.offset,
			binX: request.binX,
			binY: request.binY,
			subframe: request.subframe,
			x: request.x,
			y: request.y,
			width: request.width,
			height: request.height,
			frameFormat: request.frameFormat,
			autoSave: saving,
			transferFormat: request.output.format,
		}

		const capture: ActiveCapture = {
			session: {
				sessionId: '',
				operationId: '',
				connectionId,
				deviceId,
				cameraName: camera.name,
				request,
				phase: 'starting',
				stopping: false,
				captured: 0,
				saved: 0,
				count: request.exposureMode === 'loop' ? undefined : request.exposureMode === 'single' ? 1 : request.count,
				startedAt: Date.now(),
				...(request.analysis && { analysis: { policy: request.analysis.policy, provider: request.analysis.request.detector.provider, analyzed: 0, pending: 0, failed: 0, skipped: 0, waiting: false } }),
			},
			camera,
			frames: new Map(),
			generation: 0,
			...(request.analysis && preparation && { analysis: { preparation, policy: request.analysis.policy, group: crypto.randomUUID(), consecutiveFailures: 0 } }),
		}

		this.#active.set(key, capture)

		const handle = this.#capturer.start(this.operations.coordinator, camera, start, {
			listener: (event, path) => this.#reported(capture, event, path),
			framePath: (frame) => this.#framePath(capture, frame),
			...(capture.analysis?.policy === 'everyFrame' && { beforeFrame: (_, signal) => this.#reserveFrame(capture, signal) }),
		})

		const { operationId } = this.operations.track('camera.capture', [{ connectionId, deviceId }], handle.result)
		capture.handle = handle
		this.#update(capture, { sessionId: handle.id, operationId })

		void handle.result.then((result) => {
			if (this.#active.get(key) === capture) this.#active.delete(key)
			// The capacity reserved for an exposure that never came is given back.
			capture.analysis?.reservation?.release()
			if (capture.analysis) capture.analysis.reservation = undefined
			if (capture.session.analysis?.waiting) this.#updateAnalysis(capture, { waiting: false })
			for (const [path, write] of this.#writes) if (write.capture === capture) this.#writes.delete(path)

			if (result.ok) this.#update(capture, { phase: capture.session.stopping ? 'stopped' : 'completed', endedAt: Date.now(), exposure: undefined, delay: undefined })
			else this.#update(capture, { phase: result.reason === 'aborted' ? 'aborted' : 'failed', reason: result.reason, error: result.error, endedAt: Date.now(), exposure: undefined, delay: undefined })
		})

		return Response.json({ sessionId: handle.id, operationId } satisfies CaptureStartResponse, { status: 202 })
	}

	// Stops the capture of a camera after the exposure in flight, which is still saved. Responds 204 once
	// requested (the end arrives as a capture:updated event) and 404 when the camera captures nothing.
	stop(connectionId: string, deviceId: string): Response {
		const capture = this.#running(connectionId, deviceId)
		if (!capture?.handle) return errorResponse('No capture is running on this camera', 404)

		capture.handle.stop()
		if (!capture.session.stopping) this.#update(capture, { stopping: true })
		return new Response(null, { status: 204 })
	}

	// Aborts the capture of a camera: the exposure in flight is aborted on the driver and its frame lost.
	// Resolves once the camera is idle and released. Responds 204, 404 when the camera captures nothing, and
	// 409 when its driver cannot abort an exposure.
	async abort(connectionId: string, deviceId: string): Promise<Response> {
		const capture = this.#running(connectionId, deviceId)
		if (!capture?.handle) return errorResponse('No capture is running on this camera', 404)
		if (!capture.camera.canAbort) return errorResponse('The camera cannot abort an exposure', 409)

		await capture.handle.cancel()
		return new Response(null, { status: 204 })
	}

	// Returns the running capture of a camera, if any.
	#running(connectionId: string, deviceId: string): ActiveCapture | undefined {
		const client = this.client(connectionId)
		const camera = client && this.devices.camera(client, deviceId)
		return camera && this.#active.get(resourceKey(camera))
	}

	// Publishes a changed session.
	#update(capture: ActiveCapture, patch: Partial<CaptureSession>) {
		capture.session = changed(capture.session, patch)
		this.#sessions.set(resourceKey(capture.camera), capture.session)
		this.listener({ type: 'capture:updated', session: capture.session })
	}

	// Resolves the file of a saved frame from the request's directory and template.
	#framePath(capture: ActiveCapture, { generation, time, camera }: CameraFramePathRequest) {
		const { output, frameType } = capture.session.request
		const name = frameName(output.filenameTemplate ?? DEFAULT_FILENAME_TEMPLATE, { camera: camera.name, type: frameType, time, generation, timezoneOffset: -new Date(time).getTimezoneOffset() })
		const path = join(output.directory || this.capturesDir, `${name}.${output.format === 'XISF' ? 'xisf' : 'fit'}`)
		capture.frames.set(generation, { time, path, file: 'saving' })
		capture.frames.delete(generation - FRAME_HISTORY)
		this.#writes.set(path, { capture, generation })
		return path
	}

	// Follows the presentation events of a capture. A path marks a frame that finished processing.
	#reported(capture: ActiveCapture, event: CameraCaptureEvent, path?: string) {
		if (event.generation > capture.generation) {
			capture.generation = event.generation
			// A frame that is not saved resolves no path, so its record starts when its exposure is commanded.
			if (!capture.frames.has(event.generation)) capture.frames.set(event.generation, { time: Date.now() })
			capture.frames.delete(event.generation - FRAME_HISTORY)
		}

		if (path !== undefined) {
			const more = event.remainingCount > 0 && !capture.session.stopping
			this.#update(capture, { phase: more && capture.session.request.delay > 0 ? 'waiting' : capture.session.phase, exposure: undefined, delay: undefined })
			return
		}

		switch (event.state) {
			case 'exposureStarted':
				this.#update(capture, { phase: 'exposing', exposure: undefined, delay: undefined })
				break
			case 'exposing':
				this.#update(capture, { phase: 'exposing', exposure: event.frameProgress })
				break
			case 'exposureFinished':
				this.#update(capture, { phase: 'reading', exposure: event.frameProgress })
				break
			case 'waiting':
				this.#update(capture, { phase: 'waiting', delay: event.frameProgress })
				break
		}
	}

	// Counts a decoded frame and queues it for preview. The bytes are the toolkit's buffer, copied here
	// because it is not ours to keep.
	#published(frame: Buffer, camera: Camera) {
		const key = resourceKey(camera)
		const capture = this.#active.get(key)
		if (!capture) return

		const generation = capture.generation
		const resolved = capture.frames.get(generation)
		this.#update(capture, { captured: capture.session.captured + 1, phase: capture.session.request.output.mode === 'preview-save' ? 'saving' : capture.session.phase })

		let preview = this.#previews.get(key)

		if (!preview) {
			preview = { decoding: false, queue: [] }
			this.#previews.set(key, preview)
		}

		// The capacity reserved before this exposure now belongs to its frame.
		const reservation = capture.analysis?.reservation
		if (capture.analysis) capture.analysis.reservation = undefined

		const pending = { bytes: new Uint8Array(frame), generation, time: resolved?.time ?? Date.now(), path: resolved?.path, session: capture, reservation }
		const last = preview.queue.at(-1)

		// A frame without a reservation only replaces the newest waiting frame without one.
		if (!reservation && last && !last.reservation) preview.queue[preview.queue.length - 1] = pending
		else preview.queue.push(pending)

		if (!preview.decoding) void this.#preview(key, preview)
	}

	// Decodes the waiting frames of a camera into the image store one at a time, in order, replaces the
	// camera's previewed frame with each, closing the previous document, and hands each to the analysis of
	// its capture.
	async #preview(key: string, preview: CameraPreview) {
		preview.decoding = true

		for (let next = preview.queue.shift(); next; next = preview.queue.shift()) {
			const { bytes, generation, time, path, session: capture, reservation } = next
			const { sessionId, connectionId, deviceId, cameraName } = capture.session

			try {
				const info = await this.images.openCapture(bytes, path === undefined ? `${cameraName} #${generation}` : basename(path), { connectionId, deviceId, frameId: `${sessionId}:${generation}`, time, path })
				const previous = preview.frame
				const bitpix = numericKeyword<number, undefined>(info.header, 'BITPIX', undefined)
				const { width, height, channels, cfa, acquisition } = info
				const file = path === undefined ? undefined : (capture.frames.get(generation)?.file ?? 'saving')
				preview.frame = { imageId: info.id, sessionId, connectionId, deviceId, generation, time, path, file, frameType: capture.session.request.frameType, width, height, channels, cfa, bitpix, acquisition }
				// The analysis retains the frame before the previous one is closed, so neither is ever released early.
				this.#analyze(capture, info.id, generation, reservation)
				if (previous) this.images.close(previous.imageId)
				this.listener({ type: 'capture:frame', frame: preview.frame })
				if (capture.session.previewError !== undefined) this.#update(capture, { previewError: undefined })
			} catch (error) {
				this.#update(capture, { previewError: `Unable to decode the frame: ${Error.isError(error) ? error.message : String(error)}` })

				if (reservation) {
					reservation.release()
					this.#analysisEnded(capture, 'failed')
				}
			}
		}

		preview.decoding = false
	}

	// Holds the next exposure of an Every Frame analysis until star detection capacity is reserved for its
	// frame, publishing the wait while there is none. Lets the frame go without a reservation once the analysis
	// halted. Never refuses a frame: a stop or an abort ends the wait through signal.
	async #reserveFrame(capture: ActiveCapture, signal: AbortSignal): Promise<undefined> {
		const analysis = capture.analysis!
		if (capture.session.analysis?.halted || analysis.reservation) return undefined

		analysis.reservation = this.stars.tryReserve(analysis.group)
		if (analysis.reservation) return undefined

		this.#updateAnalysis(capture, { waiting: true }, { phase: 'analysisWait', exposure: undefined, delay: undefined })
		analysis.reservation = await this.stars.reserve(analysis.group, signal)
		this.#updateAnalysis(capture, { waiting: false })
		return undefined
	}

	// Submits the star detection of a decoded frame by the policy of its capture's analysis. Counts a frame
	// the queue refused as skipped.
	#analyze(capture: ActiveCapture, imageId: string, generation: number, reservation?: StarDetectionReservation) {
		const { analysis } = capture
		const state = capture.session.analysis

		if (!analysis || !state || state.halted) {
			reservation?.release()
			return
		}

		const { sessionId, connectionId, deviceId } = capture.session
		const origin = { kind: 'capture', sessionId, connectionId, deviceId, frameId: `${sessionId}:${generation}`, generation } as const

		if (analysis.policy === 'everyFrame') {
			// A frame without a reservation, such as one taken before the analysis halted, is not analyzed.
			const job = reservation?.submit(imageId, analysis.preparation, origin)
			if (job) this.#follow(capture, job)
			return
		}

		const { job, skipped, full } = this.stars.submitLatest(imageId, analysis.preparation, origin)
		if (skipped > 0 || full) this.#updateAnalysis(capture, { skipped: state.skipped + skipped + (full ? 1 : 0), pending: state.pending - skipped })
		if (job) this.#follow(capture, job)
	}

	// Counts a submitted star detection as pending, then by its outcome once it ended.
	#follow(capture: ActiveCapture, job: StarDetectionJob) {
		this.#updateAnalysis(capture, { pending: capture.session.analysis!.pending + 1 })

		void this.stars.ended(job.jobId).then((ended) => {
			// A skipped job of Latest Frame Only was already counted when the newer frame replaced it.
			if (ended?.state === 'skipped') return
			this.#analysisEnded(capture, ended?.state === 'completed' ? 'analyzed' : ended?.state === 'failed' ? 'failed' : 'skipped', true, ended)
		})
	}

	// Counts the outcome of the analysis of one frame, and halts the analysis when ASTAP cannot run or too many
	// frames failed in a row.
	#analysisEnded(capture: ActiveCapture, outcome: 'analyzed' | 'failed' | 'skipped', wasPending = false, job?: StarDetectionJob) {
		const state = capture.session.analysis
		const analysis = capture.analysis
		if (!state || !analysis) return

		analysis.consecutiveFailures = outcome === 'failed' ? analysis.consecutiveFailures + 1 : outcome === 'analyzed' ? 0 : analysis.consecutiveFailures
		const patch: { -readonly [K in keyof CaptureAnalysisState]?: CaptureAnalysisState[K] } = { [outcome]: state[outcome] + 1 }
		if (wasPending) patch.pending = state.pending - 1

		if (!state.halted && job?.code === 'astapUnavailable') patch.halted = `ASTAP cannot run: ${job.error ?? 'unavailable'}`
		else if (!state.halted && analysis.consecutiveFailures >= MAX_CONSECUTIVE_ANALYSIS_FAILURES) patch.halted = `${analysis.consecutiveFailures} frames in a row could not be analyzed${job?.error ? `: ${job.error}` : ''}`

		this.#updateAnalysis(capture, patch)
	}

	// Publishes a changed analysis state of a session, with other session fields. The session of a capture that
	// ended and was replaced by a newer one of the same camera changes silently, so it never replaces the
	// newer one in clients.
	#updateAnalysis(capture: ActiveCapture, patch: Partial<CaptureAnalysisState>, session: Partial<CaptureSession> = {}) {
		const analysis = { ...capture.session.analysis!, ...patch }
		const latest = this.#sessions.get(resourceKey(capture.camera))
		if (!latest || latest.sessionId === capture.session.sessionId) this.#update(capture, { ...session, analysis })
		else capture.session = changed(capture.session, { analysis })
	}

	// Writes a saved frame exclusively, and counts it once the write completed. A failed write marks the
	// frame's file as failed and is rethrown, so the capture fails.
	async #write(path: string, data: Buffer) {
		try {
			await writeFrameExclusively(path, data)
		} catch (error) {
			this.#written(path, 'failed')
			throw error
		}

		const capture = this.#written(path, 'saved')
		if (capture) this.#update(capture, { saved: capture.session.saved + 1 })
	}

	// Records the outcome of the write of a frame's file, and republishes the previewed frame when it is
	// that frame. Returns the capture the file belongs to, or undefined when the path is unknown.
	#written(path: string, file: CaptureFileState) {
		const write = this.#writes.get(path)
		if (!write) return undefined
		this.#writes.delete(path)

		const { capture, generation } = write
		const record = capture.frames.get(generation)
		if (record) record.file = file

		const preview = this.#previews.get(resourceKey(capture.camera))

		if (preview?.frame?.path === path) {
			preview.frame = { ...preview.frame, file }
			this.listener({ type: 'capture:frame', frame: preview.frame })
		}

		return capture
	}

	// Stops routing camera callbacks; running captures end by their own cleanup or the registry's disposal.
	[Symbol.dispose]() {
		this.#capturer.dispose()
	}
}
