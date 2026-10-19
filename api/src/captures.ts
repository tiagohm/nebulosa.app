import { homedir } from 'os'
import { basename, join } from 'path'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { Camera, CameraTransferFormat, Client } from 'nebulosa/src/devices/indi/device'
import type { OperationFailureReason } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { type CameraCaptureHandle, CameraCapturer, type CameraFramePathRequest, writeFrameExclusively } from 'nebulosa/src/devices/runners/camera.capture'
import { type CameraCaptureEvent, type CameraCaptureStart, type CameraCaptureTime, DEFAULT_CAMERA_CAPTURE_START } from 'nebulosa/src/devices/runners/camera.capture.types'
import type { DeviceRegistry } from './devices'
import type { ImageStore } from './images'
import type { OperationRegistry } from './operations'

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

// Directory saved frames go into when a request names none, and the published path of previewed frames.
export const DEFAULT_CAPTURES_DIR = join(homedir(), 'Nebulosa', 'captures')

// Filename template of saved frames when a request names none.
export const DEFAULT_FILENAME_TEMPLATE = '{date}_{time}_{camera}_{type}_{seq}'

// What a capture does with its frames: preview and write each one to a file of the server, or only preview it.
export type CaptureOutputMode = 'preview-save' | 'preview-only'

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
// - completed: every requested frame was taken.
// - stopped: the capture was stopped and ended after its last frame.
// - aborted: the capture was aborted; the exposure in flight was lost.
// - failed: the capture ended because of an error, given in reason and error.
export type CapturePhase = 'starting' | 'exposing' | 'reading' | 'saving' | 'waiting' | 'completed' | 'stopped' | 'aborted' | 'failed'

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
	// Whether the write of the frame's file completed; false until it does and when it failed.
	readonly saved: boolean
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

// What the service knows of one frame of a running session.
interface FrameRecord {
	// Instant the frame's exposure was commanded, Unix milliseconds (UTC).
	readonly time: number
	// File the frame is saved to, when saving.
	readonly path?: string
	// Whether the write of that file completed.
	saved: boolean
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
}

// Preview state of one camera: the frame shown, and decoding in progress.
interface CameraPreview {
	// Latest previewed frame.
	frame?: CaptureFrame
	// Whether a frame is being decoded.
	decoding: boolean
	// Newest frame received while decoding, decoded next.
	next?: PendingFrame & { readonly session: ActiveCapture }
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
	// operations holds and publishes every capture, images receives the frames, and listener receives every
	// capture event synchronously. capturesDir replaces DEFAULT_CAPTURES_DIR.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: (connectionId: string) => Client | undefined,
		readonly operations: OperationRegistry,
		readonly images: ImageStore,
		readonly listener: CaptureListener,
		readonly capturesDir: string = DEFAULT_CAPTURES_DIR,
	) {
		this.#capturer = new CameraCapturer(devices.cameras, operations.arbiter, {
			capturesDir,
			publish: (frame, _, camera) => this.#published(frame, camera),
			write: (path, data) => this.#write(path, data),
		})
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
	// arrive as capture:updated events. Responds 404 for an unknown camera and 409 when it is disconnected or
	// held by another operation, such as a capture started by another tab.
	start(connectionId: string, deviceId: string, request: CaptureRequest): Response {
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
			},
			camera,
			frames: new Map(),
			generation: 0,
		}

		this.#active.set(key, capture)

		const handle = this.#capturer.start(this.operations.coordinator, camera, start, {
			listener: (event, path) => this.#reported(capture, event, path),
			framePath: (frame) => this.#framePath(capture, frame),
		})

		const { operationId } = this.operations.track('camera.capture', [{ connectionId, deviceId }], handle.result)
		capture.handle = handle
		this.#update(capture, { sessionId: handle.id, operationId })

		void handle.result.then((result) => {
			if (this.#active.get(key) === capture) this.#active.delete(key)
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
		capture.frames.set(generation, { time, path, saved: false })
		capture.frames.delete(generation - FRAME_HISTORY)
		this.#writes.set(path, { capture, generation })
		return path
	}

	// Follows the presentation events of a capture. A path marks a frame that finished processing.
	#reported(capture: ActiveCapture, event: CameraCaptureEvent, path?: string) {
		if (event.generation > capture.generation) {
			capture.generation = event.generation
			// A frame that is not saved resolves no path, so its record starts when its exposure is commanded.
			if (!capture.frames.has(event.generation)) capture.frames.set(event.generation, { time: Date.now(), saved: false })
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
			preview = { decoding: false }
			this.#previews.set(key, preview)
		}

		const pending = { bytes: new Uint8Array(frame), generation, time: resolved?.time ?? Date.now(), path: resolved?.path, session: capture }

		if (preview.decoding) preview.next = pending
		else void this.#preview(key, preview, pending)
	}

	// Decodes frames of a camera into the image store one at a time, ending with the newest one received, and
	// replaces the camera's previewed frame with each, closing the previous document.
	async #preview(key: string, preview: CameraPreview, first: PendingFrame & { readonly session: ActiveCapture }) {
		preview.decoding = true
		let next: (PendingFrame & { readonly session: ActiveCapture }) | undefined = first

		while (next) {
			const { bytes, generation, time, path, session: capture } = next
			preview.next = undefined
			const { sessionId, connectionId, deviceId, cameraName } = capture.session

			try {
				const info = await this.images.openCapture(bytes, path === undefined ? `${cameraName} #${generation}` : basename(path), { connectionId, deviceId, frameId: `${sessionId}:${generation}`, time, path })
				const previous = preview.frame
				preview.frame = { imageId: info.id, sessionId, connectionId, deviceId, generation, time, path, saved: capture.frames.get(generation)?.saved === true }
				if (previous) this.images.close(previous.imageId)
				this.listener({ type: 'capture:frame', frame: preview.frame })
				if (capture.session.previewError !== undefined) this.#update(capture, { previewError: undefined })
			} catch (error) {
				this.#update(capture, { previewError: `Unable to decode the frame: ${Error.isError(error) ? error.message : String(error)}` })
			}

			next = preview.next
		}

		preview.decoding = false
	}

	// Writes a saved frame exclusively, and counts it once the write completed.
	async #write(path: string, data: Buffer) {
		await writeFrameExclusively(path, data)

		const write = this.#writes.get(path)
		if (!write) return
		this.#writes.delete(path)

		const { capture, generation } = write
		const record = capture.frames.get(generation)
		if (record) record.saved = true
		this.#update(capture, { saved: capture.session.saved + 1 })

		const preview = this.#previews.get(resourceKey(capture.camera))

		if (preview?.frame?.path === path) {
			preview.frame = { ...preview.frame, saved: true }
			this.listener({ type: 'capture:frame', frame: preview.frame })
		}
	}

	// Stops routing camera callbacks; running captures end by their own cleanup or the registry's disposal.
	[Symbol.dispose]() {
		this.#capturer.dispose()
	}
}
