import { mkdir } from 'fs/promises'
import { join } from 'path'
import { formatTemporal, TIMEZONE, temporalAdd, temporalGet, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { CameraManager } from 'nebulosa/src/devices/indi/manager'
import type { BlobEncoding, PropertyState } from 'nebulosa/src/devices/indi/types'
import { base64Source, bufferSource } from 'nebulosa/src/io/io'
import { DEFAULT_CAMERA_CAPTURE_EVENT, exposureTimeInMicroseconds, exposureTimeInSeconds } from '#/camera'
import type { CameraCaptureEvent, CameraCaptureStart } from '#/camera'
import type { GuiderDither } from '#/guider'
import { guiderBus } from './guider'
import type { GuiderDitherEvent, GuiderDitherResult } from './guider'
import type { ImageProcessor } from './image'
import type { OperationContext, OperationFailureReason, OperationResult } from './operation'
import { OperationCoordinator } from './operation'
import { abortableDelay, abortReason } from './operation.wait'
import { resourceKey } from './resource'
import { directoryExists, errorMessage } from './util'

// Minimum inter-frame delay that produces progress updates, in microseconds.
const MINIMUM_WAITING_TIME = 1000000

// Default time allowed for an exposure and its BLOB to finish beyond the requested exposure, in milliseconds.
const DEFAULT_FRAME_GRACE_TIME = 30000

// Default time allowed for a canceled exposure to become physically idle, in milliseconds.
const DEFAULT_QUIESCE_TIMEOUT = 5000

// Default window retained after quiescence so a late BLOB is consumed by the old session, in milliseconds.
const DEFAULT_LATE_BLOB_DRAIN_TIME = 100

// Result of a camera capture after every requested frame has been processed.
export interface CameraCaptureResult {
	// Paths emitted for processed frames, in capture order.
	readonly paths: readonly string[]
	// Number of fully processed frames.
	readonly frameCount: number
}

// Operation-backed camera capture with an exposure-start milestone.
export interface CameraCaptureHandle {
	// Stable operation and session identifier.
	readonly id: string
	// Resolves after the first exposure is physically observed as Busy, or with the start failure.
	readonly started: Promise<OperationResult<void>>
	// Resolves after terminal cleanup and camera lease release.
	readonly result: Promise<OperationResult<CameraCaptureResult>>
	// Cancels this exact capture and waits for quiescence and lease release.
	readonly cancel: () => Promise<void>
}

// Optional integration used to dither before frames without coupling capture to HTTP transport.
export interface CameraDitherer {
	// Whether the guider is currently able to dither.
	readonly running: boolean
	// Requests dither and settles only after the guider reports its terminal result.
	readonly dither: (request: GuiderDither, signal?: AbortSignal) => Promise<GuiderDitherResult>
}

// Tunable physical timeouts used by deterministic tests and device-specific integration.
export interface CameraCaptureOptions {
	// Additional milliseconds allowed after the requested exposure for state and BLOB rendezvous.
	readonly frameGraceTime?: number
	// Maximum milliseconds to wait for exposure quiescence during cleanup.
	readonly quiesceTimeout?: number
	// Milliseconds retained after idle to consume and discard a late BLOB.
	readonly lateBlobDrainTime?: number
}

// Asynchronous payload boundary whose completion controls camera lease retention.
export interface CameraCaptureIO {
	// Decodes a base64 transport payload into its binary camera frame.
	readonly decode: (data: Buffer) => Promise<Buffer>
	// Persists an auto-save frame and resolves only after the write has completed.
	readonly write: (path: string, data: Buffer) => Promise<void>
}

// Production payload I/O backed by the streaming decoder and Bun filesystem writer.
const DEFAULT_CAMERA_CAPTURE_IO: CameraCaptureIO = {
	decode: decodeCameraBlobFromBase64,
	async write(path, data) {
		await Bun.write(path, data)
	},
}

// Callback receiving presentation-state updates and processed frame paths.
export type CameraCaptureListener = (event: CameraCaptureEvent, path?: string) => void

// Independent rendezvous for one exposure generation.
interface FrameAttempt {
	// Monotonic generation within the session.
	readonly generation: number
	// Terminal exposure state observed for this generation.
	readonly exposureCompleted: PromiseWithResolvers<PropertyState>
	// First BLOB observed for this generation.
	readonly blobReceived: PromiseWithResolvers<CameraBlob>
	// Raw BLOB retained until exposure completion allows processing.
	blob?: CameraBlob
	// Latest terminal exposure property state.
	exposureState?: PropertyState
	// Whether this attempt no longer accepts device callbacks.
	terminal: boolean
	// Whether physical Busy was observed after command dispatch.
	started: boolean
}

// Raw camera payload and transport encoding captured by a FrameAttempt.
interface CameraBlob {
	// Driver-owned payload received for the current frame.
	readonly data: Buffer
	// Transport encoding applied to the payload.
	readonly encoding: BlobEncoding
}

// Internal session state; terminal states never transition back into active work.
type CameraCaptureSessionState = 'created' | 'dithering' | 'startingExposure' | 'exposing' | 'awaitingFrame' | 'processingFrame' | 'interFrameDelay' | 'stopping' | 'succeeded' | 'failed' | 'cancelled'

// Starts and routes serialized camera sessions through the process-wide coordinator.
export class CameraCapturer {
	readonly #sessions = new Map<string, CameraCaptureSession>()

	// Creates a capturer over camera commands, image processing, and shared operation ownership.
	constructor(
		readonly cameraManager: CameraManager,
		readonly imageProcessor: ImageProcessor,
		readonly coordinator: OperationCoordinator,
		readonly ditherer?: CameraDitherer,
		readonly options: CameraCaptureOptions = {},
		readonly io: CameraCaptureIO = DEFAULT_CAMERA_CAPTURE_IO,
	) {}

	// Starts one top-level capture without replacing an existing owner of the physical camera.
	start(camera: Camera, request: CameraCaptureStart, listener: CameraCaptureListener = () => {}): CameraCaptureHandle {
		const key = resourceKey(camera)
		const started = Promise.withResolvers<OperationResult<void>>()
		let sessionCreated = false

		let startedSettled = false
		const settleStarted = (result: OperationResult<void>) => {
			if (startedSettled) return
			startedSettled = true
			started.resolve(result)
		}

		const operation = this.coordinator.start<CameraCaptureResult>('cameraCapture', [{ key, device: camera }], (context) => {
			sessionCreated = true
			const session = new CameraCaptureSession(context, camera, structuredClone(request), this.cameraManager, this.imageProcessor, this.ditherer, this.options, this.io, listener, settleStarted, () => this.coordinator.arbiter.markUnavailable({ key, device: camera }))

			this.#sessions.set(key, session)

			context.onCleanup(async () => {
				await session.cleanup()
				if (this.#sessions.get(key) === session) this.#sessions.delete(key)
			})

			return session.run()
		})

		void operation.result.then(
			(result) => {
				if (!startedSettled) settleStarted(result.ok ? { ok: false, reason: 'unexpectedState', error: 'capture completed before exposure became busy' } : result)
				if (!sessionCreated && !result.ok) {
					const event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)
					event.operation = operation.id
					event.session = Bun.randomUUIDv7()
					event.camera = camera.id
					event.state = 'error'
					listener(structuredClone(event))
					event.state = 'idle'
					event.stopped = true
					listener(event)
				}
			},
			(error) => settleStarted({ ok: false, reason: 'commandFailed', error: errorMessage(error) }),
		)

		return Object.freeze({
			id: operation.id,
			started: started.promise,
			result: operation.result,
			cancel: () => operation.cancel('aborted'),
		})
	}

	// Routes a camera property update only to the session currently owning its physical key.
	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		this.#sessions.get(resourceKey(camera))?.updated(camera, property, state)
	}

	// Routes a BLOB only to the current session; terminal sessions consume and discard it.
	blobReceived(camera: Camera, data: Buffer, encoding: BlobEncoding) {
		this.#sessions.get(resourceKey(camera))?.blobReceived(data, encoding)
	}

	// Reports device removal to the current session before lifecycle cleanup removes the device.
	removed(camera: Camera) {
		this.#sessions.get(resourceKey(camera))?.deviceUnavailable('removed')
	}
}

// Owns frame generations, device rendezvous, processing, and terminal quiescence for one capture.
class CameraCaptureSession {
	readonly #event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)
	readonly #request: CameraCaptureStart
	readonly #waitingTime: number
	readonly #totalExposureProgress = [0, 0]
	readonly #paths: string[] = []
	readonly #terminalFailure = Promise.withResolvers<OperationResult<never>>()
	#state: CameraCaptureSessionState = 'created'
	#attempt?: FrameAttempt
	#generation = 0
	#terminal = false
	#failureSettled = false
	#failureResult?: OperationResult<never>
	#cleaned = false
	readonly #quiescenceWaiters = new Set<VoidFunction>()

	// Creates an immutable request session bound to one operation context and physical camera.
	constructor(
		readonly context: OperationContext,
		readonly camera: Camera,
		request: CameraCaptureStart,
		readonly cameraManager: CameraManager,
		readonly imageProcessor: ImageProcessor,
		readonly ditherer: CameraDitherer | undefined,
		readonly options: CameraCaptureOptions,
		readonly io: CameraCaptureIO,
		readonly listener: CameraCaptureListener,
		readonly settleStarted: (result: OperationResult<void>) => void,
		readonly markUnavailable: VoidFunction,
	) {
		this.#request = request
		this.#event.operation = context.id
		this.#event.session = Bun.randomUUIDv7()
		this.#event.loop = request.exposureMode === 'loop'
		this.#event.camera = camera.id
		this.#event.count = request.exposureMode === 'single' ? 1 : request.exposureMode === 'fixed' ? request.count : Number.MAX_SAFE_INTEGER
		this.#event.remainingCount = this.#event.count
		this.#event.frameExposureTime = exposureTimeInMicroseconds(request.exposureTime, request.exposureTimeUnit)
		this.#event.totalExposureTime = this.#event.loop ? 0 : this.#event.frameExposureTime * this.#event.count + exposureTimeInMicroseconds(request.delay, 'second') * (this.#event.count - 1)
		this.#waitingTime = exposureTimeInMicroseconds(request.delay, 'second')
		this.#totalExposureProgress[0] = this.#event.totalExposureTime
		this.#event.totalProgress.remainingTime = this.#event.totalExposureTime
	}

	// Executes frames sequentially and returns only after each exposure+BLOB pair is processed.
	async run(): Promise<OperationResult<CameraCaptureResult>> {
		if (!this.camera.connected) return this.#finishFailure('disconnected')
		if (this.#request.exposureTime <= 0 || this.#event.remainingCount <= 0) return this.#finishFailure('commandFailed', 'exposure time and frame count must be positive')

		while (this.#event.remainingCount > 0 && !this.context.signal.aborted) {
			if (this.#failureResult !== undefined) return this.#finish(this.#failureResult)
			const dither = await this.#dither()
			if (!dither.ok) return this.#finish(dither)

			const frame = await this.#captureFrame()
			if (!frame.ok) return this.#finish(frame)
			if (this.#failureResult !== undefined) return this.#finish(this.#failureResult)

			if (this.#event.remainingCount > 0) {
				const delayed = await this.#delay()
				if (!delayed.ok) return this.#finish(delayed)
			}
		}

		if (this.context.signal.aborted) return this.#finish({ ok: false, reason: abortReason(this.context.signal) })

		return this.#finish({ ok: true, value: undefined })
	}

	// Applies camera progress and terminal property updates to the current generation.
	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		if (camera !== this.camera) return

		if (property === 'exposure' && state !== 'Busy') {
			for (const waiter of this.#quiescenceWaiters) waiter()
		}

		if (this.#terminal) return

		if (property === 'connected' && !camera.connected) {
			this.deviceUnavailable('disconnected')
			return
		}

		if (property !== 'exposure' || this.#attempt === undefined || this.#attempt.terminal) return

		const attempt = this.#attempt
		const remainingTime = exposureTimeInMicroseconds(camera.exposure.value, 'second')
		const elapsedTime = Math.max(0, this.#event.frameExposureTime - remainingTime)

		if (state === 'Busy') {
			attempt.started = true
			this.#state = 'exposing'
			this.settleStarted({ ok: true, value: undefined })
			this.#event.state = 'exposing'
			this.#updateProgress(remainingTime, elapsedTime)
			this.#emit()
		} else if (state === 'Ok') {
			attempt.exposureState = state
			this.#event.state = 'exposureFinished'
			this.#updateProgress(0, this.#event.frameExposureTime)
			this.#emit()
			attempt.exposureCompleted.resolve(state)
		} else if (state === 'Alert') {
			attempt.exposureState = state
			attempt.exposureCompleted.resolve(state)
			this.#fail('alert')
		} else if (state === 'Idle') {
			attempt.exposureState = state
			attempt.exposureCompleted.resolve(state)
			this.#fail('unexpectedState', 'exposure became idle before completion')
		}
	}

	// Accepts at most one BLOB for the active generation and discards terminal or duplicate payloads.
	blobReceived(data: Buffer, encoding: BlobEncoding) {
		const attempt = this.#attempt
		if (this.#terminal || attempt === undefined || attempt.terminal || attempt.blob !== undefined) return

		const blob = { data, encoding }
		attempt.blob = blob
		attempt.blobReceived.resolve(blob)
	}

	// Fails pending milestones when the physical device disconnects or is removed.
	deviceUnavailable(reason: Extract<OperationFailureReason, 'disconnected' | 'removed'>) {
		this.markUnavailable()
		this.#fail(reason)
	}

	// Stops physical exposure, waits for idle, drains late BLOBs, and disables delivery exactly once.
	async cleanup() {
		if (this.#cleaned) return
		this.#cleaned = true
		this.#terminal = true
		this.#state = 'stopping'
		if (this.#attempt !== undefined) this.#attempt.terminal = true

		const canCommand = this.camera.connected
		let quiescent = true
		if (canCommand && (this.camera.exposuring || this.camera.exposure.state === 'Busy')) {
			this.cameraManager.stopExposure(this.camera)
			quiescent = await this.#waitForQuiescence()
		}

		const drainTime = Math.max(0, this.options.lateBlobDrainTime ?? DEFAULT_LATE_BLOB_DRAIN_TIME)
		if (drainTime > 0) await Bun.sleep(drainTime)
		if (canCommand) this.cameraManager.disableBlob(this.camera)
		if (!quiescent) {
			this.markUnavailable()
			throw new Error('camera exposure did not quiesce before cleanup timeout')
		}
	}

	// Dithers before a frame only when requested and a guider session is actively guiding.
	async #dither(): Promise<OperationResult<void>> {
		if (!this.#request.dither.enabled || !this.ditherer?.running) return { ok: true, value: undefined }

		this.#state = 'dithering'
		this.#event.state = 'dithering'
		this.#emit()
		const unsubscribe = guiderBus.subscribe('dither', this.#guiderDithered)

		try {
			const result = await this.ditherer.dither(this.#request.dither, this.context.signal)
			if (result.ok) return { ok: true, value: undefined }
			return { ok: false, reason: result.reason === 'aborted' ? abortReason(this.context.signal) : 'commandFailed', error: result.error ?? result.reason }
		} catch (error) {
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		} finally {
			unsubscribe()
		}
	}

	// Creates the frame attempt before dispatch and awaits exposure+BLOB rendezvous before processing.
	async #captureFrame(): Promise<OperationResult<string>> {
		if (this.context.signal.aborted) return { ok: false, reason: abortReason(this.context.signal) }

		const attempt: FrameAttempt = {
			generation: ++this.#generation,
			exposureCompleted: Promise.withResolvers<PropertyState>(),
			blobReceived: Promise.withResolvers<CameraBlob>(),
			terminal: false,
			started: false,
		}

		this.#attempt = attempt
		this.#event.generation = attempt.generation
		this.#state = 'startingExposure'
		this.#event.state = 'exposureStarted'
		this.#event.elapsedCount++
		this.#event.remainingCount--
		this.#event.frameProgress.remainingTime = this.#event.frameExposureTime
		this.#event.frameProgress.elapsedTime = 0
		this.#event.frameProgress.progress = 0
		this.#emit()

		try {
			this.#startExposure()
		} catch (error) {
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		}

		this.#state = 'awaitingFrame'
		const timeout = exposureTimeInSeconds(this.#request.exposureTime, this.#request.exposureTimeUnit) * 1000 + Math.max(0, this.options.frameGraceTime ?? DEFAULT_FRAME_GRACE_TIME)
		const rendezvous = await this.#awaitRendezvous(attempt, timeout)

		if (!rendezvous.ok) {
			attempt.terminal = true
			return rendezvous
		}

		if (!attempt.started) {
			attempt.terminal = true
			return { ok: false, reason: 'unexpectedState', error: 'exposure completed without a Busy state' }
		}

		this.#state = 'processingFrame'
		const processed = await this.#processBlob(rendezvous.value)
		attempt.terminal = true

		if (!processed.ok) return processed

		this.#totalExposureProgress[0] -= this.#event.frameExposureTime
		this.#totalExposureProgress[1] += this.#event.frameExposureTime
		this.#paths.push(processed.value)
		this.listener(this.#event, processed.value)
		return this.#failureResult ?? processed
	}

	// Applies immutable request options and dispatches one exposure after the attempt exists.
	#startExposure() {
		const request = this.#request
		this.cameraManager.enableBlob(this.camera)
		if (request.width > 0 && request.height > 0 && request.subframe) this.cameraManager.frame(this.camera, request.x, request.y, request.width, request.height)
		else if (this.camera.frame.width.max > 0 && this.camera.frame.height.max > 0) this.cameraManager.frame(this.camera, 0, 0, this.camera.frame.width.max, this.camera.frame.height.max)
		this.cameraManager.frameType(this.camera, request.frameType)
		if (request.frameFormat) this.cameraManager.frameFormat(this.camera, request.frameFormat)
		this.cameraManager.bin(this.camera, request.binX, request.binY)
		this.cameraManager.gain(this.camera, request.gain)
		this.cameraManager.offset(this.camera, request.offset)
		this.cameraManager.transferFormat(this.camera, request.transferFormat)
		this.cameraManager.compression(this.camera, request.compressed)
		this.cameraManager.startExposure(this.camera, exposureTimeInSeconds(request.exposureTime, request.exposureTimeUnit))
	}

	// Waits for both physical completion and one BLOB, or the first terminal failure/abort/timeout.
	async #awaitRendezvous(attempt: FrameAttempt, timeout: number): Promise<OperationResult<CameraBlob>> {
		const completed = Promise.all([attempt.exposureCompleted.promise, attempt.blobReceived.promise]).then(([state, blob]): OperationResult<CameraBlob> => (state === 'Ok' ? { ok: true, value: blob } : { ok: false, reason: state === 'Alert' ? 'alert' : 'unexpectedState' }))
		const aborted = Promise.withResolvers<OperationResult<CameraBlob>>()
		const onAbort = () => aborted.resolve({ ok: false, reason: abortReason(this.context.signal) })
		const timer = setTimeout(() => aborted.resolve({ ok: false, reason: 'timeout' }), Math.max(0, timeout))
		this.context.signal.addEventListener('abort', onAbort, { once: true })

		try {
			return await Promise.race([completed, this.#terminalFailure.promise, aborted.promise])
		} finally {
			clearTimeout(timer)
			this.context.signal.removeEventListener('abort', onAbort)
		}
	}

	// Decodes, buffers, and optionally writes one BLOB while retaining the camera lease.
	async #processBlob(blob: CameraBlob): Promise<OperationResult<string>> {
		try {
			const buffer = blob.encoding === 'raw' ? blob.data : await this.io.decode(blob.data)
			if (this.context.signal.aborted) return { ok: false, reason: abortReason(this.context.signal) }

			const name = this.#request.autoSave ? formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS') : this.camera.name
			const extension = this.#request.transferFormat === 'XISF' ? 'xisf' : 'fit'
			const path = join(await makePathFor(this.#request), `${name}.${extension}`)
			if (this.context.signal.aborted) return { ok: false, reason: abortReason(this.context.signal) }

			this.imageProcessor.save(buffer, path, this.camera)
			if (this.#request.autoSave) await this.io.write(path, buffer)
			if (this.context.signal.aborted) return { ok: false, reason: abortReason(this.context.signal) }
			return { ok: true, value: path }
		} catch (error) {
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		}
	}

	// Waits between frames with abort-aware progress updates.
	async #delay(): Promise<OperationResult<void>> {
		if (this.#waitingTime < MINIMUM_WAITING_TIME) return { ok: true, value: undefined }

		this.#state = 'interFrameDelay'
		this.#event.state = 'waiting'
		let remaining = this.#waitingTime

		while (remaining > 0) {
			const elapsed = this.#waitingTime - remaining
			this.#updateTotalProgress(elapsed)
			this.#event.frameProgress.remainingTime = remaining
			this.#event.frameProgress.elapsedTime = elapsed
			this.#event.frameProgress.progress = Math.max(0, (elapsed / this.#waitingTime) * 100)
			this.#emit()

			const step = Math.min(250_000, remaining)
			const delayed = await abortableDelay(step / 1000, this.context.signal)
			if (!delayed.ok) return delayed
			remaining -= step
		}

		this.#totalExposureProgress[0] -= this.#waitingTime
		this.#totalExposureProgress[1] += this.#waitingTime
		return { ok: true, value: undefined }
	}

	// Waits for an observed non-Busy exposure update and removes its waiter after timeout.
	async #waitForQuiescence(): Promise<boolean> {
		if (!this.camera.exposuring && this.camera.exposure.state !== 'Busy') return true

		const observed = Promise.withResolvers<boolean>()
		const onUpdate = () => {
			if (!this.camera.exposuring && this.camera.exposure.state !== 'Busy') observed.resolve(true)
		}

		this.#quiescenceWaiters.add(onUpdate)

		let timer: Timer | undefined
		const timeout = new Promise<boolean>((resolve) => {
			timer = setTimeout(() => resolve(false), Math.max(0, this.options.quiesceTimeout ?? DEFAULT_QUIESCE_TIMEOUT))
		})

		try {
			onUpdate()
			return await Promise.race([observed.promise, timeout])
		} finally {
			clearTimeout(timer)
			this.#quiescenceWaiters.delete(onUpdate)
		}
	}

	// Updates frame and total progress using microseconds.
	#updateProgress(remainingTime: number, elapsedTime: number) {
		this.#updateTotalProgress(elapsedTime)
		this.#event.frameProgress.remainingTime = remainingTime
		this.#event.frameProgress.elapsedTime = elapsedTime
		this.#event.frameProgress.progress = this.#event.frameExposureTime <= 0 ? 0 : Math.max(0, (1 - remainingTime / this.#event.frameExposureTime) * 100)
	}

	// Advances aggregate capture progress within the current exposure or delay.
	#updateTotalProgress(elapsedTime: number) {
		if (!this.#event.loop) {
			this.#event.totalProgress.remainingTime = Math.max(0, this.#totalExposureProgress[0] - elapsedTime)
			this.#event.totalProgress.progress = this.#event.totalExposureTime <= 0 ? 0 : Math.max(0, (1 - this.#event.totalProgress.remainingTime / this.#event.totalExposureTime) * 100)
		}
		this.#event.totalProgress.elapsedTime = this.#totalExposureProgress[1] + elapsedTime
	}

	// Mirrors guider progress only while this session is actively awaiting its own dither call.
	readonly #guiderDithered = (event: GuiderDitherEvent) => {
		if (this.#terminal || this.#state !== 'dithering') return
		this.#event.state = event.phase === 'settling' || event.phase === 'settled' ? 'settling' : 'dithering'
		this.#emit()
	}

	// Records the first session failure and releases every pending rendezvous race.
	#fail(reason: OperationFailureReason, error?: string) {
		if (this.#failureSettled) return
		this.#failureSettled = true
		const result = error === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, error } as const)
		this.#failureResult = result
		this.#terminalFailure.resolve(result)
		this.settleStarted(result)
	}

	// Converts an early validation failure into the shared terminal presentation and result.
	#finishFailure(reason: OperationFailureReason, error?: string): OperationResult<CameraCaptureResult> {
		const result = error === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, error } as const)
		this.settleStarted(result)
		return this.#finish(result)
	}

	// Finalizes the session exactly once and emits one terminal presentation event.
	#finish(result: OperationResult<unknown>): OperationResult<CameraCaptureResult> {
		if (this.#terminal) return { ok: false, reason: 'aborted' }
		this.#terminal = true
		this.#state = result.ok ? 'succeeded' : result.reason === 'aborted' ? 'cancelled' : 'failed'
		if (!result.ok) this.settleStarted(result)
		this.#emitTerminal(!result.ok)
		return result.ok ? { ok: true, value: { paths: this.#paths, frameCount: this.#paths.length } } : result
	}

	// Emits a cloned presentation snapshot so transport listeners cannot mutate session state.
	#emit() {
		this.listener(structuredClone(this.#event))
	}

	// Emits one final idle presentation while preserving terminal state internally.
	#emitTerminal(stopped: boolean) {
		if (stopped) {
			this.#event.state = 'error'
			this.#emit()
		}
		this.#event.state = 'idle'
		this.#event.stopped = stopped
		this.#emit()
	}
}

// Resolves the output directory while preserving existing automatic subfolder behavior.
async function makePathFor(request: CameraCaptureStart) {
	if (request.autoSave) {
		const savePath = request.savePath && (await directoryExists(request.savePath)) ? request.savePath : Bun.env.capturesDir

		if (request.autoSubFolderMode === 'off') return savePath

		const now = temporalAdd(Date.now(), TIMEZONE, 'm')
		const hour = temporalGet(now, 'h')
		const directory = request.autoSubFolderMode === 'midnight' || hour < 12 ? formatTemporal(now, 'YYYY-MM-DD') : formatTemporal(temporalSubtract(now, 12, 'h'), 'YYYY-MM-DD')
		const path = join(savePath, directory)
		await mkdir(path, { recursive: true })
		return path
	}

	return Bun.env.capturesDir
}

// Computes decoded byte length for a padded base64 payload.
function computeDecodedBase64Length(data: Uint8Array) {
	let paddingCount = 0

	if (data[data.byteLength - 1] === 61) {
		paddingCount = data[data.byteLength - 2] === 61 ? 2 : 1
	}

	return Math.floor((data.byteLength * 3) / 4) - paddingCount
}

// Removes transport whitespace without copying when the payload is already trimmed.
function trimBuffer<T extends Uint8Array>(data: T) {
	const length = data.byteLength
	let start = 0
	while (start < length && data[start] <= 32) start++
	let end = length - 1
	while (end > start && data[end] <= 32) end--
	return start !== 0 || end !== length - 1 ? data.subarray(start, end + 1) : data
}

// Decodes a base64 camera BLOB into an exact-length buffer.
async function decodeCameraBlobFromBase64(buffer: Buffer) {
	const data = trimBuffer(buffer)
	const decodedLength = computeDecodedBase64Length(data)
	const output = Buffer.allocUnsafe(decodedLength)
	const source = base64Source(bufferSource(Buffer.from(data.buffer, data.byteOffset, data.byteLength)))
	const read = await source.read(output)
	return read === decodedLength ? output : output.subarray(0, read)
}
