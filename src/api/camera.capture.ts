import { mkdir } from 'fs/promises'
import { join } from 'path'
import { formatTemporal, TIMEZONE, temporalAdd, temporalGet, temporalSubtract } from 'nebulosa/src/astronomy/time/temporal'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { CameraManager } from 'nebulosa/src/devices/indi/manager'
import type { BlobEncoding, PropertyState } from 'nebulosa/src/devices/indi/types'
import { base64Source, bufferSource } from 'nebulosa/src/io/io'
import { DEFAULT_CAMERA_CAPTURE_EVENT, exposureTimeInMicroseconds, exposureTimeInSeconds } from '#/camera'
import type { CameraCaptureEvent, CameraCaptureStart } from '#/camera'
import type { GuiderDither, GuiderDitherPhase } from '#/guider'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import type { ImageProcessor } from './image'
import type { OperationContext, OperationScope } from './operation'
import { abortableDelay, abortReason } from './operation.wait'
import { ResourceArbiter, resourceKey } from './resource'
import { directoryExists, errorMessage } from './util'

// Minimum inter-frame delay that produces progress updates, in microseconds.
const MINIMUM_WAITING_TIME = 1000000

// Default time allowed for an exposure and its BLOB to finish beyond the requested exposure, in milliseconds.
const DEFAULT_FRAME_GRACE_TIME = 30000

// Default time allowed for a canceled exposure to become physically idle, in milliseconds.
const DEFAULT_QUIESCE_TIMEOUT = 5000

// Default window retained after quiescence before a missing BLOB quarantines the camera, in milliseconds.
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
	// Resolves after terminal cleanup and camera lease release; never rejects.
	readonly result: Promise<OperationResult<CameraCaptureResult>>
	// Cancels this exact capture and waits for quiescence and lease release.
	readonly cancel: () => Promise<void>
}

// Optional integration used to dither before frames without coupling capture to HTTP transport. The
// capture only passes its signal: the guider session stays the owner of its own devices and serializes
// the command, so cancelling a dither never disconnects the session that ran it.
export interface CameraDitherer {
	// Whether the named guider session is currently able to dither.
	readonly running: (guider: string) => boolean
	// Requests dither on one session and settles only after it reports its terminal result. Progress comes
	// back through this call, so the capture never observes the dither of a session it did not ask for.
	readonly dither: (guider: string, request: GuiderDither, options?: CameraDitherOptions) => Promise<OperationResult<void>>
}

// Per-call collaborators handed to the guider when a capture dithers.
export interface CameraDitherOptions {
	// Cancels the dither when the capture stops, without ending the guider session that runs it.
	readonly signal?: AbortSignal
	// Receives the phases of this dither only.
	readonly onPhase?: (phase: GuiderDitherPhase) => void
}

// Tunable physical timeouts used by deterministic tests and device-specific integration.
export interface CameraCaptureOptions {
	// Additional milliseconds allowed after the requested exposure for state and BLOB rendezvous.
	readonly frameGraceTime?: number
	// Maximum milliseconds to wait for exposure quiescence during cleanup.
	readonly quiesceTimeout?: number
	// Milliseconds retained after idle before a missing BLOB requires an explicit safety boundary.
	readonly lateBlobDrainTime?: number
}

// Asynchronous payload boundary whose completion controls camera lease retention.
export interface CameraCaptureDecodeAndWrite {
	// Decodes a base64 transport payload into its binary camera frame.
	readonly decode: (data: Buffer) => Promise<Buffer>
	// Persists an auto-save frame and resolves only after the write has completed.
	readonly write: (path: Bun.BunFile | Bun.PathLike, data: Buffer) => Promise<number>
}

// Production payload I/O backed by the streaming decoder and Bun filesystem writer.
const DEFAULT_CAMERA_CAPTURE_DECODE_AND_WRITE: CameraCaptureDecodeAndWrite = {
	decode: decodeCameraBlobFromBase64,
	write: Bun.write,
}

// Callback receiving presentation-state updates and processed frame paths.
export type CameraCaptureListener = (event: CameraCaptureEvent, path?: string) => void

// Optional collaborators supplied per capture by the transport that started it.
export interface CameraCaptureListeners {
	// Receives presentation events emitted by the accepted session.
	readonly listener?: CameraCaptureListener
	// Runs inside the operation once the camera has been acquired and before the first exposure.
	readonly prepare?: VoidFunction
	// Receives the terminal events of a capture rejected before a session exists; defaults to listener.
	readonly rejectedListener?: CameraCaptureListener
}

// Availability transitions a session applies to the camera resource it owns.
interface CameraAvailability {
	// Blocks new acquisitions without releasing the current owner.
	readonly markUnavailable: VoidFunction
	// Blocks the camera until its outstanding BLOB is observed and discarded.
	readonly quarantine: VoidFunction
}

// Collaborators a session needs beyond its context, camera, and request.
interface CameraCaptureSessionContext {
	// Issues the physical camera commands.
	readonly cameraManager: CameraManager
	// Buffers and persists processed frames.
	readonly imageProcessor: ImageProcessor
	// Dithers before a frame when the guider is guiding.
	readonly ditherer?: CameraDitherer
	// Physical timeouts governing rendezvous and quiescence.
	readonly options: CameraCaptureOptions
	// Payload decoding and auto-save boundary.
	readonly io: CameraCaptureDecodeAndWrite
	// Receives presentation events.
	readonly listener: CameraCaptureListener
	// Runs once before the first exposure.
	readonly prepare?: VoidFunction
	// Settles the exposure-start milestone exactly once.
	readonly settleStarted: (result: OperationResult<void>) => void
	// Applies availability transitions to the owned camera.
	readonly availability: CameraAvailability
}

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
	// Whether the exposure command returned successfully, even if Busy was never observed.
	dispatched: boolean
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
	// Accepted session per physical camera key. Device callbacks carry no operation id, so this is what
	// routes an update or a BLOB to the one session entitled to it.
	readonly #sessions = new Map<string, CameraCaptureSession>()
	// Camera keys blocked until a stale BLOB is discarded or the transport resets.
	readonly #quarantined = new Set<string>()

	// Creates a capturer over camera commands, image processing, and resource availability.
	constructor(
		readonly cameraManager: CameraManager,
		readonly imageProcessor: ImageProcessor,
		readonly arbiter: ResourceArbiter,
		readonly ditherer?: CameraDitherer,
		readonly options: CameraCaptureOptions = {},
		readonly io: CameraCaptureDecodeAndWrite = DEFAULT_CAMERA_CAPTURE_DECODE_AND_WRITE,
	) {}

	// Starts one capture in the given scope, routing accepted-session events to its listener and reporting
	// pre-session rejection separately. A composite feature passes its own context so the capture nests
	// inside the operation that already owns the camera.
	start(scope: OperationScope, camera: Camera, request: CameraCaptureStart, { listener = () => {}, rejectedListener = listener, prepare }: CameraCaptureListeners = {}): CameraCaptureHandle {
		const key = resourceKey(camera)
		const started = Promise.withResolvers<OperationResult<void>>()
		let session: CameraCaptureSession | undefined

		let startedSettled = false
		const settleStarted = (result: OperationResult<void>) => {
			if (startedSettled) return
			startedSettled = true
			started.resolve(result)
		}

		const operation = scope.start<CameraCaptureResult>('cameraCapture', [{ key, device: camera }], (context) => {
			const current = new CameraCaptureSession(context, camera, structuredClone(request), {
				cameraManager: this.cameraManager,
				imageProcessor: this.imageProcessor,
				ditherer: this.ditherer,
				options: this.options,
				io: this.io,
				listener,
				prepare,
				settleStarted,
				availability: {
					markUnavailable: () => this.arbiter.markUnavailable({ key, device: camera }),
					quarantine: () => this.#quarantine(camera, key),
				},
			})

			session = current
			this.#sessions.set(key, current)

			context.onCleanup(async () => {
				await current.cleanup()
				if (this.#sessions.get(key) === current) this.#sessions.delete(key)
			})

			return current.run()
		})

		// The session records its own expected cleanup failures, which the coordinator cannot see.
		const result = operation.result.then((value): OperationResult<CameraCaptureResult> => session?.resultAfterCleanup(value) ?? value)

		void result.then((result) => {
			if (!startedSettled) settleStarted(result.ok ? { ok: false, reason: 'unexpectedState', error: 'capture completed before exposure became busy' } : result)

			if (session === undefined && !result.ok) {
				const event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)
				event.operation = operation.id
				event.session = Bun.randomUUIDv7()
				event.camera = camera.id
				event.state = 'error'
				rejectedListener(structuredClone(event))
				event.state = 'idle'
				event.stopped = true
				rejectedListener(event)
			}
		})

		return Object.freeze({
			id: operation.id,
			started: started.promise,
			result,
			cancel: () => operation.cancel('aborted'),
		})
	}

	// Routes a camera property update only to the session currently owning its physical key.
	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		const key = resourceKey(camera)
		this.#sessions.get(key)?.updated(camera, property, state)

		// A disconnected camera cannot deliver the pending payload, and lifecycle owns its availability from here.
		if (property === 'connected' && !camera.connected) this.#endQuarantine(camera, key)
		// Alert and Idle are the driver reporting an exposure that produced no frame, which can arrive long
		// after the session gave up on it. Only Ok promises a payload, so any other terminal state ends the
		// quarantine instead of blocking the camera until it is reconnected.
		else if (property === 'exposure' && (state === 'Alert' || state === 'Idle')) this.#endQuarantine(camera, key)
	}

	// Discards a quarantined stale BLOB before allowing a connected camera to capture again.
	blobReceived(camera: Camera, data: Buffer, encoding: BlobEncoding) {
		const key = resourceKey(camera)
		if (this.#quarantined.has(key)) return this.#endQuarantine(camera, key)
		this.#sessions.get(key)?.blobReceived(data, encoding)
	}

	// Reports device removal to the current session before lifecycle cleanup removes the device.
	removed(camera: Camera) {
		const key = resourceKey(camera)
		this.#sessions.get(key)?.deviceUnavailable('removed')
		this.#endQuarantine(camera, key)
	}

	// Blocks the camera until the payload left behind by a terminated exposure has been observed.
	#quarantine(camera: Camera, key: string) {
		this.#quarantined.add(key)
		this.arbiter.markUnavailable({ key, device: camera }, 'quarantine')
	}

	// Releases the quarantine cause; any lifecycle cause keeps the camera blocked on its own.
	#endQuarantine(camera: Camera, key: string) {
		if (!this.#quarantined.delete(key)) return
		this.arbiter.markAvailable({ key, device: camera }, 'quarantine')
	}
}

// Owns frame generations, device rendezvous, processing, and terminal quiescence for one capture.
class CameraCaptureSession {
	// Mutable presentation snapshot; every emission clones it so listeners cannot retain a live reference.
	readonly #event = structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT)
	// Caller request copied at construction, so a mutation by the transport cannot alter a running capture.
	readonly #request: CameraCaptureStart
	// Inter-frame delay in microseconds.
	readonly #waitingTime: number
	// Aggregate exposure progress in microseconds as [remaining, elapsed].
	readonly #totalExposureProgress = [0, 0]
	// Paths of fully processed frames, in capture order.
	readonly #paths: string[] = []
	// Losing racer that releases a pending rendezvous when a device failure arrives outside it.
	readonly #terminalFailure = Promise.withResolvers<OperationResult<never>>()
	// Internal lifecycle position; terminal values never transition back into active work.
	#state: CameraCaptureSessionState = 'created'
	// Rendezvous of the exposure currently in flight, absent before the first frame.
	#attempt?: FrameAttempt
	// Monotonic frame counter used to discard callbacks belonging to a superseded exposure.
	#generation = 0
	// Whether the session stopped accepting device callbacks and frame emissions.
	#terminal = false
	// Exactly-once guard for #fail, so the first cause is the one reported.
	#failureSettled = false
	// First recorded failure, replayed by run() when it was detected outside a rendezvous.
	#failureResult?: OperationResult<never>
	// Exactly-once guard for cleanup, which the coordinator and a terminal path can both reach.
	#cleaned = false
	// Transport loss that makes the session's camera instance unsafe to command or quarantine.
	#deviceUnavailableReason?: Extract<OperationFailureReason, 'disconnected' | 'removed'>
	// Callbacks woken by any non-Busy exposure update, so cleanup can observe quiescence without polling.
	readonly #quiescenceWaiters = new Set<VoidFunction>()
	// Resolves when the canceled generation's outstanding BLOB is observed and discarded.
	readonly #lateBlob = Promise.withResolvers<void>()
	// Whether cleanup has observed the BLOB expected from a physically started exposure.
	#lateBlobObserved = false
	// Whether cancellation observed the driver's explicit abort-to-Idle boundary.
	#abortIdleObserved = false
	// Expected cleanup failure folded into the session result instead of thrown.
	#cleanupFailure?: Extract<OperationResult<never>, { readonly ok: false }>

	// Creates an immutable request session bound to one operation context and physical camera.
	constructor(
		readonly operationContext: OperationContext,
		readonly camera: Camera,
		request: CameraCaptureStart,
		readonly sessionContext: CameraCaptureSessionContext,
	) {
		this.#request = request
		this.#event.operation = operationContext.id
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

	// Prepares acquired devices, then executes frames through exposure+BLOB processing.
	async run(): Promise<OperationResult<CameraCaptureResult>> {
		if (!this.camera.connected) return this.#finishFailure('disconnected')
		if (this.#request.exposureTime <= 0 || this.#event.remainingCount <= 0) return this.#finishFailure('commandFailed', 'exposure time and frame count must be positive')
		try {
			this.sessionContext.prepare?.()
		} catch (error) {
			return this.#finishFailure('commandFailed', errorMessage(error))
		}

		while (this.#event.remainingCount > 0 && !this.operationContext.signal.aborted) {
			// A device failure recorded outside a rendezvous, such as during the inter-frame delay, only surfaces here.
			if (this.#failureResult !== undefined) return this.#finish(this.#failureResult)
			const dither = await this.#dither()
			if (!dither.ok) return this.#finish(dither)

			const frame = await this.#captureFrame()
			if (!frame.ok) return this.#finish(frame)

			if (this.#event.remainingCount > 0) {
				const delayed = await this.#delay()
				if (!delayed.ok) return this.#finish(delayed)
			}
		}

		if (this.operationContext.signal.aborted) {
			return this.#finish({ ok: false, reason: abortReason(this.operationContext.signal) })
		}

		return this.#finish({ ok: true, value: undefined })
	}

	// Applies camera progress and terminal property updates to the current generation.
	updated(camera: Camera, property: keyof Camera & string, state?: PropertyState) {
		if (camera !== this.camera) return

		if (property === 'exposure' && state !== 'Busy') {
			if (state === 'Idle' && this.operationContext.signal.aborted) this.#abortIdleObserved = true
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
			this.sessionContext.settleStarted({ ok: true, value: undefined })
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

	// Accepts one active-generation BLOB and records terminal BLOBs as the cleanup safety boundary.
	blobReceived(data: Buffer, encoding: BlobEncoding) {
		const attempt = this.#attempt
		if (this.#terminal) {
			if (attempt?.dispatched && attempt.blob === undefined) {
				this.#lateBlobObserved = true
				this.#lateBlob.resolve()
			}
			return
		}
		if (attempt === undefined || attempt.terminal || attempt.blob !== undefined) return

		const blob = { data, encoding }
		attempt.blob = blob
		attempt.blobReceived.resolve(blob)
	}

	// Fails pending milestones when the physical device disconnects or is removed.
	deviceUnavailable(reason: Extract<OperationFailureReason, 'disconnected' | 'removed'>) {
		this.#deviceUnavailableReason = reason
		this.sessionContext.availability.markUnavailable()
		this.#fail(reason)
	}

	// Applies a cleanup-time failure without replacing an earlier terminal cause.
	resultAfterCleanup(result: OperationResult<CameraCaptureResult>): OperationResult<CameraCaptureResult> {
		const failure = this.#cleanupFailure
		if (failure === undefined) return result
		if (result.ok) return failure
		return { ...result, error: result.error ? `${result.error}; ${failure.error}` : failure.error }
	}

	// Stops physical exposure and quarantines the camera when no boundary consumes its outstanding BLOB.
	async cleanup() {
		if (this.#cleaned) return
		this.#cleaned = true
		// A payload is owed only when the exposure was actually dispatched and nothing arrived for it. Alert
		// and Idle are the driver stating the exposure produced no frame, so those states settle the debt.
		const pendingBlob = this.#attempt?.dispatched === true && this.#attempt.blob === undefined
		const requiresBlobBoundary = pendingBlob && this.#attempt?.exposureState !== 'Alert' && this.#attempt?.exposureState !== 'Idle'
		this.#terminal = true
		this.#state = 'stopping'
		if (this.#attempt !== undefined) this.#attempt.terminal = true

		const canCommand = this.#deviceUnavailableReason === undefined && this.camera.connected
		const exposureMayBeActive = this.#attempt?.dispatched === true && this.#attempt.exposureState === undefined
		let quiescent = true

		try {
			if (canCommand && (exposureMayBeActive || this.camera.exposuring || this.camera.exposure.state === 'Busy')) {
				this.sessionContext.cameraManager.stopExposure(this.camera)
				quiescent = await this.#waitForQuiescence()
			}

			// A driver that already queued the payload usually delivers it right after the stop, so a short
			// race here consumes it in the common case and avoids quarantining a camera that is in fact fine.
			const drainTime = Math.max(0, this.sessionContext.options.lateBlobDrainTime ?? DEFAULT_LATE_BLOB_DRAIN_TIME)
			if (requiresBlobBoundary && !this.#lateBlobObserved && drainTime > 0) await Promise.race([this.#lateBlob.promise, Bun.sleep(drainTime)])
			if (canCommand) this.sessionContext.cameraManager.disableBlob(this.camera)
		} finally {
			// The payload may still arrive after the lease is gone, and BLOBs carry no operation id, so the
			// next session would read this one's frame. Quarantine blocks the camera until it is discarded.
			if (canCommand && requiresBlobBoundary && !this.#lateBlobObserved && !this.#abortIdleObserved) this.sessionContext.availability.quarantine()
			if (!quiescent) {
				this.sessionContext.availability.markUnavailable()
				this.#cleanupFailure = { ok: false, reason: 'timeout', error: 'cleanup failed: camera exposure did not quiesce before cleanup timeout' }
			}
		}
	}

	// Dithers before a frame only when requested and a guider session is actively guiding.
	async #dither(): Promise<OperationResult<void>> {
		const ditherer = this.sessionContext.ditherer
		const guider = this.#request.dither.guider

		// No guider named means none was chosen, which is a request not to dither rather than a failure.
		if (!this.#request.dither.enabled || !guider || ditherer === undefined) return { ok: true, value: undefined }

		// A named session that is gone or not guiding is a different matter: the capture asked for this
		// exact guider, so exposing without it would be pretending a dither happened.
		if (!ditherer.running(guider)) return { ok: false, reason: 'unexpectedState', error: `guider ${guider} is not guiding` }

		this.#state = 'dithering'
		this.#event.state = 'dithering'
		this.#emit()

		try {
			const result = await ditherer.dither(guider, this.#request.dither, { signal: this.operationContext.signal, onPhase: this.#guiderDithered })
			if (result.ok) return { ok: true, value: undefined }
			return { ok: false, reason: result.reason === 'aborted' ? abortReason(this.operationContext.signal) : 'commandFailed', error: result.error ?? result.reason }
		} catch (error) {
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		}
	}

	// Creates the frame attempt before dispatch and awaits exposure+BLOB rendezvous before processing.
	async #captureFrame(): Promise<OperationResult<string>> {
		if (this.operationContext.signal.aborted) return { ok: false, reason: abortReason(this.operationContext.signal) }

		const attempt: FrameAttempt = {
			generation: ++this.#generation,
			exposureCompleted: Promise.withResolvers<PropertyState>(),
			blobReceived: Promise.withResolvers<CameraBlob>(),
			terminal: false,
			dispatched: false,
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
			attempt.dispatched = true
		} catch (error) {
			return { ok: false, reason: 'commandFailed', error: errorMessage(error) }
		}

		this.#state = 'awaitingFrame'
		const timeout = exposureTimeInSeconds(this.#request.exposureTime, this.#request.exposureTimeUnit) * 1000 + Math.max(0, this.sessionContext.options.frameGraceTime ?? DEFAULT_FRAME_GRACE_TIME)
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
		this.sessionContext.listener(this.#event, processed.value)
		return this.#failureResult ?? processed
	}

	// Applies immutable request options and dispatches one exposure after the attempt exists.
	#startExposure() {
		const request = this.#request
		this.sessionContext.cameraManager.enableBlob(this.camera)
		if (request.width > 0 && request.height > 0 && request.subframe) this.sessionContext.cameraManager.frame(this.camera, request.x, request.y, request.width, request.height)
		else if (this.camera.frame.width.max > 0 && this.camera.frame.height.max > 0) this.sessionContext.cameraManager.frame(this.camera, 0, 0, this.camera.frame.width.max, this.camera.frame.height.max)
		this.sessionContext.cameraManager.frameType(this.camera, request.frameType)
		if (request.frameFormat) this.sessionContext.cameraManager.frameFormat(this.camera, request.frameFormat)
		this.sessionContext.cameraManager.bin(this.camera, request.binX, request.binY)
		this.sessionContext.cameraManager.gain(this.camera, request.gain)
		this.sessionContext.cameraManager.offset(this.camera, request.offset)
		this.sessionContext.cameraManager.transferFormat(this.camera, request.transferFormat)
		this.sessionContext.cameraManager.compression(this.camera, request.compressed)
		this.sessionContext.cameraManager.startExposure(this.camera, exposureTimeInSeconds(request.exposureTime, request.exposureTimeUnit))
	}

	// Waits for both physical completion and one BLOB, or the first terminal failure/abort/timeout.
	async #awaitRendezvous(attempt: FrameAttempt, timeout: number): Promise<OperationResult<CameraBlob>> {
		const completed = Promise.all([attempt.exposureCompleted.promise, attempt.blobReceived.promise]).then(([state, blob]): OperationResult<CameraBlob> => (state === 'Ok' ? { ok: true, value: blob } : { ok: false, reason: state === 'Alert' ? 'alert' : 'unexpectedState' }))
		const aborted = Promise.withResolvers<OperationResult<CameraBlob>>()
		const onAbort = () => aborted.resolve({ ok: false, reason: abortReason(this.operationContext.signal) })
		const timer = setTimeout(() => aborted.resolve({ ok: false, reason: 'timeout' }), Math.max(0, timeout))
		this.operationContext.signal.addEventListener('abort', onAbort, { once: true })

		try {
			return await Promise.race([completed, this.#terminalFailure.promise, aborted.promise])
		} finally {
			clearTimeout(timer)
			this.operationContext.signal.removeEventListener('abort', onAbort)
		}
	}

	// Decodes, buffers, and optionally writes one BLOB while retaining the camera lease.
	async #processBlob(blob: CameraBlob): Promise<OperationResult<string>> {
		try {
			const buffer = blob.encoding === 'raw' ? blob.data : await this.sessionContext.io.decode(blob.data)
			if (this.operationContext.signal.aborted) return { ok: false, reason: abortReason(this.operationContext.signal) }

			const name = this.#request.autoSave ? formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS') : this.camera.name
			const extension = this.#request.transferFormat === 'XISF' ? 'xisf' : 'fit'
			const path = join(await makePathFor(this.#request), `${name}.${extension}`)
			if (this.operationContext.signal.aborted) return { ok: false, reason: abortReason(this.operationContext.signal) }

			this.sessionContext.imageProcessor.save(buffer, path, this.camera)
			if (this.#request.autoSave) await this.sessionContext.io.write(path, buffer)
			if (this.operationContext.signal.aborted) return { ok: false, reason: abortReason(this.operationContext.signal) }
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
			const delayed = await abortableDelay(step / 1000, this.operationContext.signal)
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
			timer = setTimeout(() => resolve(false), Math.max(0, this.sessionContext.options.quiesceTimeout ?? DEFAULT_QUIESCE_TIMEOUT))
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

	// Mirrors the progress of the dither this capture asked for.
	//
	// The guider hands each phase back through the call itself, so there is no channel through which
	// another session could reach this one and nothing here has to be matched against a session id.
	readonly #guiderDithered = (phase: GuiderDitherPhase) => {
		if (this.#terminal || this.#state !== 'dithering') return
		this.#event.state = phase === 'settling' || phase === 'settled' ? 'settling' : 'dithering'
		this.#emit()
	}

	// Records the first session failure and releases every pending rendezvous race.
	#fail(reason: OperationFailureReason, error?: string) {
		if (this.#failureSettled) return
		this.#failureSettled = true
		const result = error === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, error } as const)
		this.#failureResult = result
		this.#terminalFailure.resolve(result)
		this.sessionContext.settleStarted(result)
	}

	// Converts an early validation failure into the shared terminal presentation and result.
	#finishFailure(reason: OperationFailureReason, error?: string): OperationResult<CameraCaptureResult> {
		const result = error === undefined ? ({ ok: false, reason } as const) : ({ ok: false, reason, error } as const)
		this.sessionContext.settleStarted(result)
		return this.#finish(result)
	}

	// Finalizes the session exactly once and emits one terminal presentation event.
	#finish(result: OperationResult<unknown>): OperationResult<CameraCaptureResult> {
		// run() is the only caller and stops at the first terminal result, so this only guards cleanup racing a late frame.
		if (this.#terminal) return this.#failureResult ?? { ok: false, reason: 'aborted' }
		this.#terminal = true
		this.#state = result.ok ? 'succeeded' : result.reason === 'aborted' ? 'cancelled' : 'failed'
		if (!result.ok) this.sessionContext.settleStarted(result)
		this.#emitTerminal(!result.ok)
		return result.ok ? { ok: true, value: { paths: this.#paths, frameCount: this.#paths.length } } : result
	}

	// Emits a cloned presentation snapshot so transport listeners cannot mutate session state.
	#emit() {
		this.sessionContext.listener(structuredClone(this.#event))
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
