import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, sep } from 'path'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator, FocuserSimulator, MountSimulator, RotatorSimulator, WheelSimulator } from 'nebulosa/src/indi.simulator'
import { CameraCaptureTask, CameraHandler } from 'src/api/camera'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import type { PHD2Handler } from 'src/api/phd2'
import { DEFAULT_CAMERA_CAPTURE_START, type CameraCaptureEvent, type CameraCaptureStart } from 'src/shared/types'

type CameraCaptureStartOverrides = Omit<Partial<CameraCaptureStart>, 'dither'> & {
	dither?: Partial<CameraCaptureStart['dither']>
}

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager)

const handler = new IndiClientHandlerSet([cameraManager, mountManager, wheelManager, focuserManager, rotatorManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulators = [new CameraSimulator('Camera Simulator', client), new MountSimulator('Mount Simulator', client), new WheelSimulator('Wheel Simulator', client), new FocuserSimulator('Focuser Simulator', client), new RotatorSimulator('Rotator Simulator', client)] as const

Bun.env.capturesDir = await mkdtemp(tmpdir() + sep)

afterAll(async () => {
	for (const simulator of simulators) simulator.dispose()

	await rm(Bun.env.capturesDir, { recursive: true, force: true })
})

function captureStartRequest(overrides: CameraCaptureStartOverrides) {
	const request = structuredClone(DEFAULT_CAMERA_CAPTURE_START)
	Object.assign(request, overrides)
	request.dither = { ...DEFAULT_CAMERA_CAPTURE_START.dither, ...overrides.dither }
	return request
}

function getCamera() {
	const camera = cameraManager.get(client, 'Camera Simulator')!
	expect(camera).toBeDefined()
	return camera
}

async function capture(request: CameraCaptureStart) {
	const camera = getCamera()
	const events: CameraCaptureEvent[] = []
	const paths: string[] = []

	try {
		cameraManager.connect(camera)

		const success = await cameraHandler.start(camera, request, (event, path) => {
			events.push(event)
			path && paths.push(path)
		})

		return { camera, events, paths, success } as const
	} finally {
		cameraManager.disconnect(camera)
	}
}

describe('camera capture start request', () => {
	test('computes exposure timing from mode, count, delay, and units', () => {
		const camera = getCamera()
		const requests = [
			[captureStartRequest({ exposureMode: 'single', exposureTime: 2, exposureTimeUnit: 'second', count: 7, delay: 5 }), 1, false, 2000000, 2000000],
			[captureStartRequest({ exposureMode: 'fixed', exposureTime: 250, exposureTimeUnit: 'millisecond', count: 3, delay: 2 }), 3, false, 250000, 4750000],
			[captureStartRequest({ exposureMode: 'loop', exposureTime: 1000, exposureTimeUnit: 'microsecond', count: 3, delay: 1 }), Number.MAX_SAFE_INTEGER, true, 1000, 0],
			[captureStartRequest({ exposureMode: 'fixed', exposureTime: 1, exposureTimeUnit: 'minute', count: 2, delay: 0 }), 2, false, 60000000, 120000000],
		] as const

		for (const [request, count, loop, frameExposureTime, totalRemainingTime] of requests) {
			const task = new CameraCaptureTask(cameraHandler, request, camera, () => {})

			expect(task.event.count).toBe(count)
			expect(task.event.remainingCount).toBe(count)
			expect(task.event.loop).toBe(loop)
			expect(task.event.frameExposureTime).toBe(frameExposureTime)
			expect(task.event.totalProgress.remainingTime).toBe(totalRemainingTime)
		}
	})

	test('applies camera, device, save, transfer, and compression options', async () => {
		const savePath = await mkdtemp(join(Bun.env.capturesDir, 'capture-'))
		const camera = getCamera()
		const mount = mountManager.get(client, 'Mount Simulator')
		const wheel = wheelManager.get(client, 'Wheel Simulator')
		const focuser = focuserManager.get(client, 'Focuser Simulator')
		const rotator = rotatorManager.get(client, 'Rotator Simulator')
		const snoop = spyOn(cameraManager, 'snoop')
		const compression = spyOn(cameraManager, 'compression')

		const request = captureStartRequest({
			exposureTime: 25,
			exposureTimeUnit: 'millisecond',
			frameType: 'DARK',
			x: 11,
			y: 13,
			width: 64,
			height: 48,
			subframe: true,
			binX: 2,
			binY: 3,
			frameFormat: 'RGB',
			gain: 42,
			offset: 7,
			autoSave: true,
			savePath,
			autoSubFolderMode: 'midnight',
			mount: 'Mount Simulator',
			wheel: 'Wheel Simulator',
			focuser: 'Focuser Simulator',
			rotator: 'Rotator Simulator',
			transferFormat: 'XISF',
			compressed: true,
		})

		try {
			const result = await capture(request)

			await Bun.sleep(100)

			expect(result.success).toBeTrue()
			expect(result.paths).toHaveLength(1)
			expect(result.paths[0].endsWith('.xisf')).toBeTrue()
			expect(dirname(result.paths[0])).not.toBe(savePath)
			expect(dirname(result.paths[0]).startsWith(savePath)).toBeTrue()
			expect(await Bun.file(result.paths[0]).exists()).toBeTrue()
			expect(imageProcessor.get(result.paths[0])).toBeDefined()

			expect(snoop).toHaveBeenCalledWith(camera, mount, focuser, wheel, rotator)
			expect(compression).toHaveBeenCalledWith(camera, true)
			expect(camera.frameType).toBe(request.frameType)
			expect(camera.frameFormat).toBe(request.frameFormat)
			expect(camera.frame.x.value).toBe(request.x)
			expect(camera.frame.y.value).toBe(request.y)
			expect(camera.frame.width.value).toBe(request.width)
			expect(camera.frame.height.value).toBe(request.height)
			expect(camera.bin.x.value).toBe(request.binX)
			expect(camera.bin.y.value).toBe(request.binY)
			expect(camera.gain.value).toBe(request.gain)
			expect(camera.offset.value).toBe(request.offset)
		} finally {
			snoop.mockRestore()
			compression.mockRestore()
		}
	}, 5000)

	test('single capture emits only one frame', async () => {
		const { paths, success } = await capture(captureStartRequest({ exposureMode: 'single', exposureTime: 10, exposureTimeUnit: 'millisecond', count: 100, autoSave: false }))

		await Bun.sleep(100)

		expect(success).toBeTrue()
		expect(paths).toHaveLength(1)
		expect(paths.every((path) => imageProcessor.get(path))).toBeTrue()
	}, 5000)

	test('fixed capture emits the requested frame count', async () => {
		const { paths, success } = await capture(captureStartRequest({ exposureMode: 'fixed', exposureTime: 10, exposureTimeUnit: 'millisecond', count: 2, autoSave: false }))

		await Bun.sleep(100)

		expect(success).toBeTrue()
		expect(paths).toHaveLength(2)
		expect(paths.every((path) => imageProcessor.get(path))).toBeTrue()
	}, 5000)

	test('loop capture can be stopped', async () => {
		const camera = getCamera()
		const events: CameraCaptureEvent[] = []
		const request = captureStartRequest({ exposureMode: 'loop', exposureTime: 200, exposureTimeUnit: 'millisecond' })

		try {
			cameraManager.connect(camera)

			const promise = cameraHandler.start(camera, request, (event) => {
				events.push(structuredClone(event))
			})

			while (!events.some((event) => event.state === 'exposureStarted')) {
				await Bun.sleep(10)
			}

			cameraHandler.stop(camera)

			expect(await promise).toBeFalse()
		} finally {
			cameraManager.disconnect(camera)
		}

		expect(events[0].loop).toBeTrue()
		expect(events[0].count).toBe(Number.MAX_SAFE_INTEGER)
		expect(events.some((event) => event.state === 'idle' && event.stopped)).toBeTrue()
	}, 5000)

	test('dithers before exposure when guiding is running', async () => {
		let dithered: CameraCaptureStart['dither'] | undefined
		let signal: AbortSignal | undefined

		const phd2Handler = {
			isRunning: true,
			dither: (request: CameraCaptureStart['dither'], abortSignal: AbortSignal) => {
				dithered = request
				signal = abortSignal
			},
			settleDone: () => {},
		} as unknown as PHD2Handler

		const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, phd2Handler)
		const camera = getCamera()
		const events: CameraCaptureEvent[] = []

		const request = captureStartRequest({
			exposureTime: 10,
			exposureTimeUnit: 'millisecond',
			dither: { enabled: true, amount: 3, raOnly: true },
		})

		try {
			cameraManager.connect(camera)

			const success = await cameraHandler.start(camera, request, (event) => {
				events.push(structuredClone(event))
			})

			expect(success).toBeTrue()
		} finally {
			cameraManager.disconnect(camera)
		}

		expect(dithered).toEqual(request.dither)
		expect(signal).toBeInstanceOf(AbortSignal)
		expect(events[0].state).toBe('dithering')
		expect(events.some((event) => event.state === 'exposureStarted')).toBeTrue()
	}, 5000)
})
