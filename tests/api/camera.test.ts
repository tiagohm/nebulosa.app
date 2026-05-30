import { afterAll, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { dirname, join, sep } from 'path'
import { deg, hour } from 'nebulosa/src/angle'
import { meter } from 'nebulosa/src/distance'
import { isFits } from 'nebulosa/src/fits'
import { readImageFromBuffer, readImageFromPath } from 'nebulosa/src/image'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator, FocuserSimulator, MountSimulator, RotatorSimulator, FilterWheelSimulator } from 'nebulosa/src/indi.simulator'
import { bufferSource } from 'nebulosa/src/io'
import { isXisf, readXisf } from 'nebulosa/src/xisf'
import { CameraCaptureTask, CameraHandler } from 'src/api/camera'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import type { PHD2Handler } from 'src/api/phd2'
import { DEFAULT_CAMERA_CAPTURE_START, type CameraCaptureEvent, type CameraCaptureStart } from 'src/shared/types'

type CameraCaptureStartOverrides = Omit<Partial<CameraCaptureStart>, 'dither'> & {
	dither?: Partial<CameraCaptureStart['dither']>
}

type CameraCaptureEventRecord = {
	readonly event: CameraCaptureEvent
	readonly path?: string
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

const simulators = [
	new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }),
	new MountSimulator('Mount Simulator', client),
	new FilterWheelSimulator('Wheel Simulator', client),
	new FocuserSimulator('Focuser Simulator', client),
	new RotatorSimulator('Rotator Simulator', client),
] as const

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
	const records: CameraCaptureEventRecord[] = []
	const paths: string[] = []

	try {
		cameraManager.connect(camera)

		const success = await cameraHandler.start(camera, request, (event, path) => {
			event = structuredClone(event)
			events.push(event)
			records.push({ event, path })
			path && paths.push(path)
		})

		return { camera, events, records, paths, success } as const
	} finally {
		cameraManager.disconnect(camera)
	}
}

function expectSuccessfulEventFlow(records: readonly CameraCaptureEventRecord[], frameCount: number) {
	const states = records.map(({ event }) => event.state)

	expect(records.filter(({ path }) => path !== undefined)).toHaveLength(frameCount)
	expect(states[0]).toBe('exposureStarted')
	expect(states).toContain('exposing')
	expect(states).toContain('exposureFinished')
	expect(states.at(-1)).toBe('idle')

	const finalEvent = records.at(-1)!.event

	expect(finalEvent.elapsedCount).toBe(frameCount)
	expect(finalEvent.remainingCount).toBe(0)
	expect(finalEvent.stopped).toBeFalse()
}

async function readBufferedImage(path: string) {
	const buffer = imageProcessor.get(path)!

	expect(buffer).toBeDefined()

	const image = (await readImageFromBuffer(buffer, 32))!

	expect(image).toBeDefined()

	return { buffer, image } as const
}

async function readStoredBuffer(path: string) {
	expect(await Bun.file(path).exists()).toBeTrue()
	return Buffer.from(await Bun.file(path).arrayBuffer())
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

	test('does not emit events when the task cannot start', async () => {
		const camera = getCamera()
		const zeroExposureEvents: CameraCaptureEvent[] = []
		const disconnectedEvents: CameraCaptureEvent[] = []

		const zeroExposureTask = new CameraCaptureTask(cameraHandler, captureStartRequest({ exposureTime: 0 }), camera, (_, event) => {
			zeroExposureEvents.push(structuredClone(event))
		})
		const disconnectedTask = new CameraCaptureTask(cameraHandler, captureStartRequest({ exposureTime: 1, exposureTimeUnit: 'second' }), camera, (_, event) => {
			disconnectedEvents.push(structuredClone(event))
		})

		expect(await zeroExposureTask.start()).toBeFalse()
		expect(await disconnectedTask.start()).toBeFalse()
		expect(zeroExposureEvents).toHaveLength(0)
		expect(disconnectedEvents).toHaveLength(0)
	})

	test('applies frame options only when subframe is enabled', () => {
		const camera = getCamera()
		const frame = spyOn(cameraManager, 'frame')
		const request = captureStartRequest({
			exposureTime: 1,
			exposureTimeUnit: 'millisecond',
			subframe: false,
			x: 3,
			y: 5,
			width: 17,
			height: 19,
		})

		try {
			const task = new CameraCaptureTask(cameraHandler, request, camera, () => {})

			task.startExposure(camera, request)

			expect(frame).not.toHaveBeenCalled()

			request.subframe = true
			task.startExposure(camera, request)

			expect(frame).toHaveBeenCalledWith(camera, request.x, request.y, request.width, request.height)
		} finally {
			frame.mockRestore()
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

			const storedBuffer = await readStoredBuffer(result.paths[0])
			const { buffer, image } = await readBufferedImage(result.paths[0])
			const xisf = await readXisf(bufferSource(buffer))

			expect(Buffer.compare(storedBuffer, buffer)).toBe(0)
			expect(isXisf(buffer)).toBeTrue()
			expect(xisf?.images).toHaveLength(1)
			expect(xisf?.images[0].geometry).toEqual({ width: 32, height: 16, channels: 3 })
			expect(xisf?.images[0].colorSpace).toBe('RGB')
			// TODO: CameraSimulator accepts CCD_COMPRESSION but its XISF writer currently ignores the compression switch.
			expect(xisf?.images[0].compression).toBeUndefined()
			expect(image.metadata.width).toBe(32)
			expect(image.metadata.height).toBe(16)
			expect(image.metadata.channels).toBe(3)
			expect(image.metadata.bitpix).toBe(16)
			expect(image.raw).toHaveLength(32 * 16 * 3)
			expect(image.header.SIMPLE).toBeTrue()
			expect(image.header.BITPIX).toBe(16)
			expect(image.header.NAXIS).toBe(3)
			expect(image.header.NAXIS1).toBe(32)
			expect(image.header.NAXIS2).toBe(16)
			expect(image.header.NAXIS3).toBe(3)
			expect(image.header.INSTRUME).toBe('Camera Simulator')
			expect(image.header.EXPTIME as number).toBeCloseTo(0.025, 6)
			expect(image.header.XBINNING).toBe(request.binX)
			expect(image.header.YBINNING).toBe(request.binY)
			expect(image.header.XPIXSZ).toBe(camera.pixelSize.x * request.binX)
			expect(image.header.YPIXSZ).toBe(camera.pixelSize.y * request.binY)
			expect(image.header.GAIN).toBe(request.gain)
			expect(image.header.OFFSET).toBe(request.offset)
			expect(image.header.FRAME).toBe(request.frameType)
			expect(image.header.IMAGETYP).toBe('DARK Frame')
			expect(image.header.XORGSUBF).toBe(request.x)
			expect(image.header.YORGSUBF).toBe(request.y)
			expect(image.header['DATE-OBS']).toBeDefined()
			expect(image.header['DATE-END']).toBeDefined()
			expectSuccessfulEventFlow(result.records, 1)

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

	test('writes FITS files with mono dimensions and headers', async () => {
		const savePath = await mkdtemp(join(Bun.env.capturesDir, 'fits-'))
		const request = captureStartRequest({
			exposureTime: 20,
			exposureTimeUnit: 'millisecond',
			frameType: 'FLAT',
			x: 2,
			y: 4,
			width: 40,
			height: 30,
			subframe: true,
			binX: 2,
			binY: 2,
			frameFormat: 'MONO',
			gain: 9,
			offset: 4,
			autoSave: true,
			savePath,
			autoSubFolderMode: 'off',
			transferFormat: 'FITS',
		})

		const result = await capture(request)

		await Bun.sleep(100)

		expect(result.success).toBeTrue()
		expect(result.paths).toHaveLength(1)
		expect(dirname(result.paths[0])).toBe(savePath)
		expect(result.paths[0].endsWith('.fit')).toBeTrue()
		expectSuccessfulEventFlow(result.records, 1)

		const storedBuffer = await readStoredBuffer(result.paths[0])
		const { buffer, image } = await readBufferedImage(result.paths[0])
		const storedImage = await readImageFromPath(result.paths[0], 32)

		expect(Buffer.compare(storedBuffer, buffer)).toBe(0)
		expect(isFits(buffer)).toBeTrue()
		expect(storedImage).toBeDefined()
		expect(storedImage?.metadata).toEqual(image.metadata)
		expect(image.metadata.width).toBe(20)
		expect(image.metadata.height).toBe(15)
		expect(image.metadata.channels).toBe(1)
		expect(image.raw).toHaveLength(20 * 15)
		expect(image.header.NAXIS).toBe(2)
		expect(image.header.NAXIS1).toBe(20)
		expect(image.header.NAXIS2).toBe(15)
		expect(image.header.NAXIS3).toBeUndefined()
		expect(image.header.FRAME).toBe('FLAT')
		expect(image.header.IMAGETYP).toBe('FLAT Frame')
		expect(image.header.XORGSUBF).toBe(request.x)
		expect(image.header.YORGSUBF).toBe(request.y)
		expect(image.header.BZERO).toBe(32768)
		expect(image.header.BSCALE).toBe(1)
	}, 5000)

	test('includes connected active device metadata in generated FITS headers', async () => {
		const camera = getCamera()
		const mount = mountManager.get(client, 'Mount Simulator')!
		const wheel = wheelManager.get(client, 'Wheel Simulator')!
		const focuser = focuserManager.get(client, 'Focuser Simulator')!
		const rotator = rotatorManager.get(client, 'Rotator Simulator')!

		try {
			mountManager.connect(mount)
			wheelManager.connect(wheel)
			focuserManager.connect(focuser)
			rotatorManager.connect(rotator)

			mountManager.geographicCoordinate(mount, { latitude: deg(-22), longitude: deg(-45), elevation: meter(890) })
			mountManager.syncTo(mount, hour(5), deg(-30))
			focuserManager.syncTo(focuser, 54321)
			rotatorManager.syncTo(rotator, 123.45)
			wheelManager.moveTo(wheel, 4)

			await Bun.sleep(1000)

			const result = await capture(
				captureStartRequest({
					exposureTime: 10,
					exposureTimeUnit: 'millisecond',
					width: 24,
					height: 18,
					frameFormat: 'MONO',
					autoSave: false,
					mount: mount.name,
					wheel: wheel.name,
					focuser: focuser.name,
					rotator: rotator.name,
				}),
			)
			const { image } = await readBufferedImage(result.paths[0])

			expect(result.success).toBeTrue()
			expect(image.header.TELESCOP).toBe(mount.name)
			expect(image.header.EQUINOX).toBe(2000)
			expect(image.header.SITELAT as number).toBeCloseTo(-22, 6)
			expect(image.header.SITELONG as number).toBeCloseTo(-45, 6)
			expect(image.header.FOCUSPOS).toBe(54321)
			expect(image.header.ROTATANG as number).toBeCloseTo(123.45, 6)
			expect(image.header.FILTER).toBe(wheel.names[4])
		} finally {
			cameraManager.disconnect(camera)
			rotatorManager.disconnect(rotator)
			focuserManager.disconnect(focuser)
			wheelManager.disconnect(wheel)
			mountManager.disconnect(mount)
		}
	}, 5000)

	test('single capture emits only one frame', async () => {
		const { paths, records, success } = await capture(captureStartRequest({ exposureMode: 'single', exposureTime: 10, exposureTimeUnit: 'millisecond', count: 100, width: 16, height: 16, frameFormat: 'MONO', autoSave: false }))

		await Bun.sleep(100)

		expect(success).toBeTrue()
		expect(paths).toHaveLength(1)
		expect(paths.every((path) => imageProcessor.get(path))).toBeTrue()
		expectSuccessfulEventFlow(records, 1)
	}, 5000)

	test('fixed capture emits the requested frame count', async () => {
		const { paths, records, success } = await capture(captureStartRequest({ exposureMode: 'fixed', exposureTime: 10, exposureTimeUnit: 'millisecond', count: 2, width: 16, height: 16, frameFormat: 'MONO', autoSave: false }))

		await Bun.sleep(100)

		expect(success).toBeTrue()
		expect(paths).toHaveLength(2)
		expect(paths.every((path) => imageProcessor.get(path))).toBeTrue()
		expectSuccessfulEventFlow(records, 2)
	}, 5000)

	test('emits waiting progress between delayed fixed captures', async () => {
		const result = await capture(captureStartRequest({ exposureMode: 'fixed', exposureTime: 1, exposureTimeUnit: 'millisecond', delay: 1, count: 2, width: 8, height: 8, frameFormat: 'MONO', autoSave: false }))
		const waitingEvents = result.records.filter(({ event }) => event.state === 'waiting')

		expect(result.success).toBeTrue()
		expect(result.paths).toHaveLength(2)
		expect(result.records.filter(({ event }) => event.state === 'exposureStarted')).toHaveLength(2)
		expect(waitingEvents.length).toBeGreaterThan(0)
		expect(waitingEvents[0].event.frameProgress.remainingTime).toBe(1000000)
		expectSuccessfulEventFlow(result.records, 2)
	}, 7000)

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
