import { describe, expect, spyOn, test } from 'bun:test'
import { tmpdir } from 'os'
import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureDecodeAndWrite, CameraCaptureOptions, CameraCaptureResult } from 'src/api/camera.capture'
import type { ImageProcessor } from 'src/api/image.processor'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureEvent, CameraCaptureStart } from '#/camera'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import { waitUntil } from './util'

interface HarnessOptions {
	readonly capture?: CameraCaptureOptions
	readonly io?: CameraCaptureDecodeAndWrite
	readonly notifyStartState?: boolean
	readonly startState?: 'Idle' | 'Busy' | 'Alert'
	readonly stopState?: 'Idle' | 'Ok'
	readonly stopQuiesces?: boolean
}

function createHarness(options: HarnessOptions = {}) {
	const cameraManager = new CameraManager()
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const client = { id: 'camera-client' }
	const camera = {
		id: 'camera-id',
		name: 'Camera',
		type: 'camera',
		client,
		[CLIENT]: client,
		connected: true,
		exposuring: false,
		exposure: { value: 0, state: 'Idle' },
		frame: {
			width: { max: 1280 },
			height: { max: 1024 },
		},
	} as unknown as Camera
	const saved: string[] = []
	const imageProcessor = {
		save(_data: Buffer, path: string) {
			saved.push(path)
		},
	} as unknown as ImageProcessor
	const enableBlob = spyOn(cameraManager, 'enableBlob').mockImplementation(() => {})
	const disableBlob = spyOn(cameraManager, 'disableBlob').mockImplementation(() => {})
	const mocks = [
		enableBlob,
		disableBlob,
		spyOn(cameraManager, 'frame').mockImplementation(() => {}),
		spyOn(cameraManager, 'frameType').mockImplementation(() => {}),
		spyOn(cameraManager, 'frameFormat').mockImplementation(() => {}),
		spyOn(cameraManager, 'bin').mockImplementation(() => {}),
		spyOn(cameraManager, 'gain').mockImplementation(() => {}),
		spyOn(cameraManager, 'offset').mockImplementation(() => {}),
		spyOn(cameraManager, 'transferFormat').mockImplementation(() => {}),
		spyOn(cameraManager, 'compression').mockImplementation(() => {}),
	]
	const startExposure = spyOn(cameraManager, 'startExposure').mockImplementation((target) => {
		const state = options.startState ?? 'Busy'
		target.exposuring = state === 'Busy'
		target.exposure.state = state
		if (options.notifyStartState !== false) queueMicrotask(() => capturer.updated(target, 'exposure', state))
	})
	const stopExposure = spyOn(cameraManager, 'stopExposure').mockImplementation((target) => {
		if (options.stopQuiesces === false) return
		const state = options.stopState ?? 'Ok'
		target.exposuring = false
		target.exposure.state = state
		queueMicrotask(() => capturer.updated(target, 'exposure', state))
	})
	mocks.push(startExposure, stopExposure)
	const capturer = new CameraCapturer(cameraManager, imageProcessor, arbiter, undefined, { frameGraceTime: 10, quiesceTimeout: 10, lateBlobDrainTime: 0, ...options.capture }, options.io)

	return {
		arbiter,
		camera,
		coordinator,
		cameraManager,
		capturer,
		disableBlob,
		saved,
		startExposure,
		stopExposure,
		restore() {
			for (const mock of mocks) mock.mockRestore()
		},
	}
}

function request(overrides: Partial<CameraCaptureStart> = {}): CameraCaptureStart {
	const value = structuredClone(DEFAULT_CAMERA_CAPTURE_START)
	Object.assign(value, { exposureTime: 1, exposureTimeUnit: 'millisecond', width: 16, height: 16, frameFormat: 'MONO' }, overrides)
	return value
}

function savingRequest() {
	return request({ autoSave: true, savePath: tmpdir(), autoSubFolderMode: 'off' })
}

function finishExposure(harness: ReturnType<typeof createHarness>, blob = true) {
	const { camera, capturer } = harness
	camera.exposuring = false
	camera.exposure.state = 'Ok'
	camera.exposure.value = 0
	capturer.updated(camera, 'exposure', 'Ok')
	if (blob) capturer.blobReceived(camera, Buffer.from('frame'), 'raw')
}

describe('camera capture session failures', () => {
	test('times out when exposure completion never arrives', async () => {
		const harness = createHarness()
		const events: CameraCaptureEvent[] = []

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request(), { listener: (event) => events.push(event) })
			expect(await handle.started).toEqual(successfulOperationResult(undefined))
			expect(await handle.result).toEqual(failedOperationResult('timeout'))
			expect(events.map((event) => event.state).slice(-2)).toEqual(['error', 'idle'])
			expect(events.filter((event) => event.state === 'error')).toHaveLength(1)
			expect(events.filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(harness.stopExposure).toHaveBeenCalledTimes(1)
			expect(harness.disableBlob).toHaveBeenCalledTimes(1)
		} finally {
			harness.restore()
		}
	})

	test('quarantines a dispatched exposure when Busy was not observed', async () => {
		const harness = createHarness({ notifyStartState: false })

		try {
			const key = resourceKey(harness.camera)
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())

			expect(await handle.started).toEqual(failedOperationResult('timeout'))
			expect(await handle.result).toEqual(failedOperationResult('timeout'))
			expect(harness.arbiter.availability(key)).toBe('unavailable')

			harness.arbiter.markAvailable({ key, device: harness.camera })
			const blocked = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await blocked.result).toMatchObject(failedOperationResult('busy'))

			harness.capturer.blobReceived(harness.camera, Buffer.from('stale frame'), 'raw')
			expect(harness.arbiter.availability(key)).toBe('available')
		} finally {
			harness.restore()
		}
	})

	test('fails both milestones when the exposure command is rejected', async () => {
		const harness = createHarness({ startState: 'Alert' })

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await handle.started).toEqual(failedOperationResult('alert'))
			expect(await handle.result).toEqual(failedOperationResult('alert'))
			expect(harness.saved).toHaveLength(0)
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('available')
		} finally {
			harness.restore()
		}
	})

	test('times out when exposure completes without a BLOB', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness, false)

			expect(await handle.result).toEqual(failedOperationResult('timeout'))
			expect(harness.saved).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('fails immediately when an active exposure becomes idle', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			harness.camera.exposuring = false
			harness.camera.exposure.state = 'Idle'
			harness.capturer.updated(harness.camera, 'exposure', 'Idle')

			expect(await handle.result).toEqual({
				ok: false,
				reason: 'unexpectedState',
				error: 'exposure became idle before completion',
			})
			expect(harness.stopExposure).not.toHaveBeenCalled()
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('available')
		} finally {
			harness.restore()
		}
	})

	test('fails the active session when the camera disconnects', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			harness.camera.connected = false
			harness.capturer.updated(harness.camera, 'connected')

			expect(await handle.result).toEqual(failedOperationResult('disconnected'))
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')
			expect(harness.disableBlob).not.toHaveBeenCalled()

			harness.camera.connected = true
			harness.camera.exposure.state = 'Idle'
			harness.camera.exposuring = false
			harness.arbiter.markAvailable({ key: resourceKey(harness.camera), device: harness.camera })

			const next = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await next.started).ok).toBeTrue()
			await next.cancel()
		} finally {
			harness.restore()
		}
	})

	test('fails the active session when the camera is removed', async () => {
		const harness = createHarness()

		try {
			const key = resourceKey(harness.camera)
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			harness.capturer.removed(harness.camera)

			expect(await handle.result).toEqual(failedOperationResult('removed'))
			expect(harness.arbiter.availability(key)).toBe('unavailable')
			expect(harness.stopExposure).not.toHaveBeenCalled()
			expect(harness.disableBlob).not.toHaveBeenCalled()

			const rediscovered = {
				...harness.camera,
				exposure: { ...harness.camera.exposure, state: 'Idle' },
				exposuring: false,
			} as Camera
			harness.arbiter.markAvailable({ key, device: rediscovered })

			const next = harness.capturer.start(harness.coordinator, rediscovered, request())
			expect((await next.started).ok).toBeTrue()
			await next.cancel()
		} finally {
			harness.restore()
		}
	})

	test('does not override an external busy-state availability verdict', () => {
		const harness = createHarness()

		try {
			const key = resourceKey(harness.camera)
			harness.camera.exposuring = true
			harness.camera.exposure.state = 'Busy'
			harness.arbiter.markUnavailable({ key, device: harness.camera })

			harness.capturer.updated(harness.camera, 'connected')

			expect(harness.arbiter.availability(key)).toBe('unavailable')
		} finally {
			harness.restore()
		}
	})

	test('blocks future captures when stop never reaches quiescence', async () => {
		const harness = createHarness({ stopQuiesces: false, capture: { quiesceTimeout: 5 } })

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			await handle.cancel()

			expect(await handle.result).toEqual({
				ok: false,
				reason: 'aborted',
				error: 'cleanup failed: camera exposure did not quiesce before cleanup timeout',
			})
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')

			const next = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await next.result).toMatchObject(failedOperationResult('busy'))

			// Discarding the stale payload clears only the quarantine; the camera is still not quiescent.
			harness.capturer.blobReceived(harness.camera, Buffer.from('stale frame'), 'raw')
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')
		} finally {
			harness.restore()
		}
	})

	test('degrades a completed capture whose camera never reaches quiescence', async () => {
		const io: CameraCaptureDecodeAndWrite = { decode: (data) => Promise.resolve(data), write: (path, data) => Promise.resolve(data.byteLength) }
		const harness = createHarness({ stopQuiesces: false, capture: { quiesceTimeout: 5 }, io })

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request({ autoSave: true, savePath: tmpdir(), autoSubFolderMode: 'off' }))
			expect((await handle.started).ok).toBeTrue()

			harness.capturer.updated(harness.camera, 'exposure', 'Ok')
			harness.capturer.blobReceived(harness.camera, Buffer.from('frame'), 'raw')

			expect(await handle.result).toEqual({
				ok: false,
				reason: 'timeout',
				error: 'cleanup failed: camera exposure did not quiesce before cleanup timeout',
			})
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')
		} finally {
			harness.restore()
		}
	})

	test('emits terminal callbacks when a conflicting capture is rejected', async () => {
		const harness = createHarness()
		const events: CameraCaptureEvent[] = []

		try {
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await active.started).ok).toBeTrue()

			const conflicting = harness.capturer.start(harness.coordinator, harness.camera, request(), { listener: (event) => events.push(event) })
			expect(await conflicting.result).toMatchObject(failedOperationResult('busy'))
			expect(events.map((event) => event.state)).toEqual(['error', 'idle'])
			expect(events.every((event) => event.operation === conflicting.id)).toBeTrue()
			expect(events[0].session).not.toBeEmpty()
			expect(events[0].generation).toBe(0)

			await active.cancel()
		} finally {
			harness.restore()
		}
	})

	test('captures inside a composite operation that already owns the camera', async () => {
		const harness = createHarness()
		const key = resourceKey(harness.camera)

		try {
			const captured = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
			const feature = harness.coordinator.start('autofocus', [{ key, device: harness.camera }], async (context) => {
				const capture = harness.capturer.start(context, harness.camera, savingRequest())
				expect((await capture.started).ok).toBeTrue()
				finishExposure(harness)
				const result = await capture.result
				captured.resolve(result)

				// The nested capture released its own lease, but the feature still owns the camera.
				expect(harness.arbiter.availability(key)).toBe('leased')
				expect(context.owns(key)).toBeTrue()
				return result.ok ? successfulOperationResult(result.value.frameCount) : result
			})

			expect((await captured.promise).ok).toBeTrue()
			expect(await feature.result).toEqual(successfulOperationResult(1))
			expect(harness.arbiter.availability(key)).toBe('available')
		} finally {
			harness.restore()
		}
	})

	test('refuses a second capture nested in the same composite operation', async () => {
		const harness = createHarness()
		const key = resourceKey(harness.camera)

		try {
			const feature = harness.coordinator.start('autofocus', [{ key, device: harness.camera }], async (context) => {
				const first = harness.capturer.start(context, harness.camera, savingRequest())
				expect((await first.started).ok).toBeTrue()

				// A sibling scope must not take a camera the tree is already exposing with.
				const second = harness.capturer.start(context, harness.camera, savingRequest())
				expect(await second.result).toMatchObject(failedOperationResult('busy'))

				finishExposure(harness)
				return await first.result
			})

			expect((await feature.result).ok).toBeTrue()
			expect(harness.arbiter.availability(key)).toBe('available')
		} finally {
			harness.restore()
		}
	})
})

describe('camera capture session cancellation', () => {
	test('aborts a dispatched exposure before Busy is observed', async () => {
		const harness = createHarness({ notifyStartState: false, startState: 'Idle' })

		try {
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			await waitUntil(() => harness.startExposure.mock.calls.length === 1)
			await active.cancel()

			expect(await active.result).toEqual(failedOperationResult('aborted'))
			expect(harness.stopExposure).toHaveBeenCalledTimes(1)
		} finally {
			harness.restore()
		}
	})

	test('allows another capture after an explicit abort-to-Idle boundary', async () => {
		const harness = createHarness({ stopState: 'Idle' })

		try {
			const key = resourceKey(harness.camera)
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await active.started).ok).toBeTrue()
			await active.cancel()

			expect(await active.result).toEqual(failedOperationResult('aborted'))
			expect(harness.arbiter.availability(key)).toBe('available')

			const next = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await next.started).ok).toBeTrue()
			await next.cancel()
		} finally {
			harness.restore()
		}
	})

	test('quarantines a camera until its outstanding BLOB is discarded', async () => {
		const harness = createHarness()

		try {
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await active.started).ok).toBeTrue()
			await active.cancel()

			expect(await active.result).toEqual(failedOperationResult('aborted'))
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')

			const blocked = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await blocked.result).toMatchObject(failedOperationResult('busy'))

			harness.capturer.blobReceived(harness.camera, Buffer.from('stale frame'), 'raw')
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('available')

			const next = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await next.started).ok).toBeTrue()
			await next.cancel()
			expect(await next.result).toEqual(failedOperationResult('aborted'))
		} finally {
			harness.restore()
		}
	})

	test('releases a quarantine when the driver ends the exposure without a payload', async () => {
		const harness = createHarness()

		try {
			const key = resourceKey(harness.camera)
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			expect(await handle.result).toEqual(failedOperationResult('timeout'))
			expect(harness.arbiter.availability(key)).toBe('unavailable')

			// The driver reports a failed frame long after the session gave up, so no BLOB will ever arrive.
			harness.camera.exposuring = false
			harness.camera.exposure.state = 'Alert'
			harness.capturer.updated(harness.camera, 'exposure', 'Alert')

			expect(harness.arbiter.availability(key)).toBe('available')

			const next = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await next.started).ok).toBeTrue()
			await next.cancel()
		} finally {
			harness.restore()
		}
	})

	test('keeps an externally exposing camera unavailable after discarding a stale BLOB', async () => {
		const harness = createHarness()

		try {
			const key = resourceKey(harness.camera)
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await active.started).ok).toBeTrue()
			await active.cancel()

			// Lifecycle observed external activity while the payload was still outstanding.
			harness.camera.exposuring = true
			harness.camera.exposure.state = 'Busy'
			harness.arbiter.markUnavailable({ key, device: harness.camera })
			harness.capturer.blobReceived(harness.camera, Buffer.from('stale frame'), 'raw')

			expect(harness.arbiter.availability(key)).toBe('unavailable')
			const blocked = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await blocked.result).toMatchObject(failedOperationResult('busy'))
		} finally {
			harness.restore()
		}
	})

	test('quarantines a pending BLOB when disabling delivery fails', async () => {
		const harness = createHarness()
		harness.disableBlob.mockImplementation(() => {
			throw new Error('disable BLOB failed')
		})

		try {
			const key = resourceKey(harness.camera)
			const active = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect((await active.started).ok).toBeTrue()
			await active.cancel()

			expect(await active.result).toEqual({
				ok: false,
				reason: 'aborted',
				error: 'cleanup failed: disable BLOB failed',
			})
			expect(harness.arbiter.availability(key)).toBe('unavailable')

			harness.arbiter.markAvailable({ key, device: harness.camera })
			const blocked = harness.capturer.start(harness.coordinator, harness.camera, request())
			expect(await blocked.result).toMatchObject(failedOperationResult('busy'))
		} finally {
			harness.restore()
		}
	})

	test('retains ownership until a canceled decode settles', async () => {
		const decoding = Promise.withResolvers<Buffer>()
		let decodeStarted = false
		const io: CameraCaptureDecodeAndWrite = {
			decode() {
				decodeStarted = true
				return decoding.promise
			},
			write: (path, data) => Promise.resolve(data.byteLength),
		}
		const harness = createHarness({ io })
		const paths: string[] = []

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request(), { listener: (_, path) => path && paths.push(path) })
			expect((await handle.started).ok).toBeTrue()
			harness.camera.exposuring = false
			harness.camera.exposure.state = 'Ok'
			harness.capturer.blobReceived(harness.camera, Buffer.from('ZnJhbWU='), 'base64')
			harness.capturer.updated(harness.camera, 'exposure', 'Ok')
			await waitUntil(() => decodeStarted)

			let canceled = false
			const cancellation = handle.cancel().then(() => {
				canceled = true
			})
			await Bun.sleep(5)
			expect(canceled).toBeFalse()
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('leased')

			decoding.resolve(Buffer.from('frame'))
			await cancellation
			expect(await handle.result).toEqual(failedOperationResult('aborted'))
			expect(paths).toHaveLength(0)
			expect(harness.saved).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('retains ownership until a canceled auto-save write settles', async () => {
		const writing = Promise.withResolvers<number>()
		let writeStarted = false
		const io: CameraCaptureDecodeAndWrite = {
			decode: (data) => Promise.resolve(data),
			write() {
				writeStarted = true
				return writing.promise
			},
		}
		const harness = createHarness({ io })
		const paths: string[] = []
		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request({ autoSave: true, savePath: tmpdir() }), { listener: (_, path) => path && paths.push(path) })
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness)
			await waitUntil(() => writeStarted)

			let canceled = false
			const cancellation = handle.cancel().then(() => {
				canceled = true
			})
			await Bun.sleep(5)
			expect(canceled).toBeFalse()
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('leased')

			writing.resolve(1)
			await cancellation
			expect(await handle.result).toEqual(failedOperationResult('aborted'))
			expect(paths).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('cancels an inter-frame delay before dispatching another exposure', async () => {
		const harness = createHarness({
			io: {
				decode: (data) => Promise.resolve(data),
				write: () => Promise.resolve(1),
			},
		})
		const events: CameraCaptureEvent[] = []
		const waiting = Promise.withResolvers<void>()

		try {
			const handle = harness.capturer.start(harness.coordinator, harness.camera, request({ exposureMode: 'fixed', count: 2, delay: 1, autoSave: true, autoSubFolderMode: 'off', savePath: tmpdir() }), {
				listener: (event) => {
					events.push(event)
					if (event.state === 'waiting') waiting.resolve()
				},
			})
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness)
			await waiting.promise

			await handle.cancel()
			expect(await handle.result).toEqual(failedOperationResult('aborted'))
			expect(harness.startExposure).toHaveBeenCalledTimes(1)
			expect(events.map((event) => event.state).slice(-2)).toEqual(['error', 'idle'])
		} finally {
			harness.restore()
		}
	})
})
