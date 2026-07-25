import { describe, expect, spyOn, test } from 'bun:test'
import { tmpdir } from 'os'
import { CLIENT } from 'nebulosa/src/devices/indi/device'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureIO, CameraCaptureOptions } from 'src/api/camera.capture'
import type { ImageProcessor } from 'src/api/image'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureEvent, CameraCaptureStart } from '#/camera'
import { waitUntil } from './util'

interface HarnessOptions {
	readonly capture?: CameraCaptureOptions
	readonly io?: CameraCaptureIO
	readonly startState?: 'Busy' | 'Alert'
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
	const startExposure = spyOn(cameraManager, 'startExposure').mockImplementation(() => {
		const state = options.startState ?? 'Busy'
		camera.exposuring = state === 'Busy'
		camera.exposure.state = state
		queueMicrotask(() => capturer.updated(camera, 'exposure', state))
	})
	const stopExposure = spyOn(cameraManager, 'stopExposure').mockImplementation(() => {
		if (options.stopQuiesces === false) return
		camera.exposuring = false
		camera.exposure.state = 'Ok'
		queueMicrotask(() => capturer.updated(camera, 'exposure', 'Ok'))
	})
	mocks.push(startExposure, stopExposure)
	const capturer = new CameraCapturer(cameraManager, imageProcessor, coordinator, undefined, { frameGraceTime: 10, quiesceTimeout: 10, lateBlobDrainTime: 0, ...options.capture }, options.io)

	return {
		arbiter,
		camera,
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
			const handle = harness.capturer.start(harness.camera, request(), (event) => events.push(event))
			expect(await handle.started).toEqual({ ok: true, value: undefined })
			expect(await handle.result).toEqual({ ok: false, reason: 'timeout' })
			expect(events.map((event) => event.state).slice(-2)).toEqual(['error', 'idle'])
			expect(events.filter((event) => event.state === 'error')).toHaveLength(1)
			expect(events.filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(harness.stopExposure).toHaveBeenCalledTimes(1)
			expect(harness.disableBlob).toHaveBeenCalledTimes(1)
		} finally {
			harness.restore()
		}
	})

	test('fails both milestones when the exposure command is rejected', async () => {
		const harness = createHarness({ startState: 'Alert' })

		try {
			const handle = harness.capturer.start(harness.camera, request())
			expect(await handle.started).toEqual({ ok: false, reason: 'alert' })
			expect(await handle.result).toEqual({ ok: false, reason: 'alert' })
			expect(harness.saved).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('times out when exposure completes without a BLOB', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness, false)

			expect(await handle.result).toEqual({ ok: false, reason: 'timeout' })
			expect(harness.saved).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('fails immediately when an active exposure becomes idle', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.camera, request())
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
		} finally {
			harness.restore()
		}
	})

	test('fails the active session when the camera disconnects', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			harness.camera.connected = false
			harness.capturer.updated(harness.camera, 'connected')

			expect(await handle.result).toEqual({ ok: false, reason: 'disconnected' })
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')
			expect(harness.disableBlob).not.toHaveBeenCalled()
		} finally {
			harness.restore()
		}
	})

	test('fails the active session when the camera is removed', async () => {
		const harness = createHarness()

		try {
			const handle = harness.capturer.start(harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			harness.capturer.removed(harness.camera)

			expect(await handle.result).toEqual({ ok: false, reason: 'removed' })
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')
		} finally {
			harness.restore()
		}
	})

	test('blocks future captures when stop never reaches quiescence', async () => {
		const harness = createHarness({ stopQuiesces: false, capture: { quiesceTimeout: 5 } })

		try {
			const handle = harness.capturer.start(harness.camera, request())
			expect((await handle.started).ok).toBeTrue()
			await handle.cancel()

			expect(await handle.result).toEqual({
				ok: false,
				reason: 'aborted',
				error: 'cleanup failed: camera exposure did not quiesce before cleanup timeout',
			})
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('unavailable')

			const next = harness.capturer.start(harness.camera, request())
			expect(await next.result).toMatchObject({ ok: false, reason: 'busy' })
		} finally {
			harness.restore()
		}
	})

	test('emits terminal callbacks when a conflicting capture is rejected', async () => {
		const harness = createHarness()
		const events: CameraCaptureEvent[] = []

		try {
			const active = harness.capturer.start(harness.camera, request())
			expect((await active.started).ok).toBeTrue()

			const conflicting = harness.capturer.start(harness.camera, request(), (event) => events.push(event))
			expect(await conflicting.result).toMatchObject({ ok: false, reason: 'busy' })
			expect(events.map((event) => event.state)).toEqual(['error', 'idle'])
			expect(events.every((event) => event.operation === conflicting.id)).toBeTrue()
			expect(events[0].session).not.toBeEmpty()
			expect(events[0].generation).toBe(0)

			await active.cancel()
		} finally {
			harness.restore()
		}
	})
})

describe('camera capture session cancellation', () => {
	test('retains ownership until a canceled decode settles', async () => {
		const decoding = Promise.withResolvers<Buffer>()
		let decodeStarted = false
		const io: CameraCaptureIO = {
			decode() {
				decodeStarted = true
				return decoding.promise
			},
			write: () => Promise.resolve(),
		}
		const harness = createHarness({ io })
		const paths: string[] = []

		try {
			const handle = harness.capturer.start(harness.camera, request(), (_, path) => path && paths.push(path))
			expect((await handle.started).ok).toBeTrue()
			harness.camera.exposuring = false
			harness.camera.exposure.state = 'Ok'
			harness.capturer.blobReceived(harness.camera, Buffer.from('ZnJhbWU='), 'base64')
			harness.capturer.updated(harness.camera, 'exposure', 'Ok')
			expect(await waitUntil(() => decodeStarted)).toBeTrue()

			let canceled = false
			const cancellation = handle.cancel().then(() => {
				canceled = true
			})
			await Bun.sleep(5)
			expect(canceled).toBeFalse()
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('leased')

			decoding.resolve(Buffer.from('frame'))
			await cancellation
			expect(await handle.result).toEqual({ ok: false, reason: 'aborted' })
			expect(paths).toHaveLength(0)
			expect(harness.saved).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('retains ownership until a canceled auto-save write settles', async () => {
		const writing = Promise.withResolvers<void>()
		let writeStarted = false
		const io: CameraCaptureIO = {
			decode: (data) => Promise.resolve(data),
			write() {
				writeStarted = true
				return writing.promise
			},
		}
		const harness = createHarness({ io })
		const paths: string[] = []
		try {
			const handle = harness.capturer.start(harness.camera, request({ autoSave: true, savePath: tmpdir() }), (_, path) => path && paths.push(path))
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness)
			expect(await waitUntil(() => writeStarted)).toBeTrue()

			let canceled = false
			const cancellation = handle.cancel().then(() => {
				canceled = true
			})
			await Bun.sleep(5)
			expect(canceled).toBeFalse()
			expect(harness.arbiter.availability(resourceKey(harness.camera))).toBe('leased')

			writing.resolve()
			await cancellation
			expect(await handle.result).toEqual({ ok: false, reason: 'aborted' })
			expect(paths).toHaveLength(0)
		} finally {
			harness.restore()
		}
	})

	test('cancels an inter-frame delay before dispatching another exposure', async () => {
		const harness = createHarness({
			io: {
				decode: (data) => Promise.resolve(data),
				write: () => Promise.resolve(),
			},
		})
		const events: CameraCaptureEvent[] = []
		const waiting = Promise.withResolvers<void>()

		try {
			const handle = harness.capturer.start(harness.camera, request({ exposureMode: 'fixed', count: 2, delay: 1, autoSave: true, autoSubFolderMode: 'off', savePath: tmpdir() }), (event) => {
				events.push(event)
				if (event.state === 'waiting') waiting.resolve()
			})
			expect((await handle.started).ok).toBeTrue()
			finishExposure(harness)
			await waiting.promise

			await handle.cancel()
			expect(await handle.result).toEqual({ ok: false, reason: 'aborted' })
			expect(harness.startExposure).toHaveBeenCalledTimes(1)
			expect(events.map((event) => event.state).slice(-2)).toEqual(['error', 'idle'])
		} finally {
			harness.restore()
		}
	})
})
