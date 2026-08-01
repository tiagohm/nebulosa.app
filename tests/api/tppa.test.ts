import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { ConfirmationHandler } from 'src/api/confirmation'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { PlateSolverHandler } from 'src/api/platesolver'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { tppaBus, tppa as tppaEndpoints, TppaHandler } from 'src/api/tppa'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { OperationResult } from '#/orchestration'
import { DEFAULT_TPPA_START } from '#/tppa'
import type { TppaStart, TppaEvent } from '#/tppa'
import { captureHandle, noContent, SocketMessager, waitUntil } from './util'

type TppaStartOverrides = Omit<Partial<TppaStart>, 'capture' | 'solver' | 'refraction'> & {
	readonly capture?: Partial<TppaStart['capture']>
	readonly solver?: Partial<TppaStart['solver']>
	readonly refraction?: Partial<TppaStart['refraction']>
}

tppaBus.forceSync = true
cameraBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const cameraCapturer = new CameraCapturer(cameraManager, imageProcessor, resourceArbiter)
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, cameraCapturer, operationCoordinator)
const mountCommander = new MountCommander(mountManager)
const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new NotificationHandler(wsm), mountCommander, operationCoordinator)
const solver = new PlateSolverHandler(new NotificationHandler(wsm), imageProcessor)
const tppaHandler = new TppaHandler(wsm, cameraHandler, mountHandler, solver, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(cameraManager)
deviceLifecycle.observe(mountManager)
const endpoints = tppaEndpoints(tppaHandler)
const handler = new IndiClientHandlerSet([cameraManager, mountManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulators = [new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }), new MountSimulator('Mount Simulator', client)] as const
const socket = new SocketMessager()

afterAll(() => {
	for (const simulator of simulators) simulator.dispose()

	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	cameraManager.disconnect(getCamera())
	mountManager.disconnect(getMount())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	cameraManager.disconnect(getCamera())
	mountManager.disconnect(getMount())
})

function getCamera() {
	const device = cameraManager.get(client, 'Camera Simulator')!
	expect(device).toBeDefined()
	return device
}

function getMount() {
	const device = mountManager.get(client, 'Mount Simulator')!
	expect(device).toBeDefined()
	return device
}

async function connectedDevices() {
	const camera = getCamera()
	const mount = getMount()

	cameraManager.connect(camera)
	mountManager.connect(mount)

	expect(await waitUntil(() => camera.connected && mount.connected)).toBeTrue()
	resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
	resourceArbiter.markAvailable({ key: resourceKey(mount), device: mount })

	return { camera, mount }
}

function tppaStartRequest(overrides: TppaStartOverrides = {}) {
	const request = structuredClone(DEFAULT_TPPA_START)
	Object.assign(request, overrides)
	Object.assign(request.capture, overrides.capture)
	Object.assign(request.solver, overrides.solver)
	Object.assign(request.refraction, overrides.refraction)

	return request
}

function startRequest(camera: Camera, mount: Mount, body: TppaStart) {
	return {
		url: `http://localhost/tppa/${encodeURIComponent(camera.id)}/${encodeURIComponent(mount.id)}/start`,
		params: { camera: camera.id, mount: mount.id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function stopRequest(id: string) {
	return {
		url: `http://localhost/tppa/${encodeURIComponent(id)}/stop`,
		params: { id },
	} as unknown as Bun.BunRequest
}

function tppaMessages() {
	return socket.filter<TppaEvent>((message) => message.type === 'tppa:update')
}

function tppaEvents() {
	return tppaMessages().map((message) => message.body)
}

function waitForTppaState(state: TppaEvent['state'], id: string, timeout?: number) {
	return waitUntil(() => tppaEvents().some((event) => event.id === id && event.state === state), timeout)
}

function plateSolution(overrides: Partial<PlateSolution> = {}): PlateSolution {
	return {
		orientation: 0,
		scale: 1,
		rightAscension: 0.1,
		declination: 0.2,
		width: 1,
		height: 1,
		parity: 'NORMAL',
		radius: 1,
		widthInPixels: 100,
		heightInPixels: 100,
		...overrides,
	}
}

function solvedFrame(path = 'plate.fit'): Promise<OperationResult<CameraCaptureResult>> {
	return Promise.resolve({ ok: true, value: { paths: [path], frameCount: 1 } })
}

describe('tppa handler', () => {
	test('normalizes the capture into a full frame light exposure and enables tracking', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest({
			id: 'tppa-start',
			capture: {
				autoSave: true,
				count: 10,
				delay: 5,
				exposureMode: 'fixed',
				frameType: 'DARK',
				savePath: '/tmp/not-used.fit',
				mount: undefined,
				x: 10,
				y: 20,
				width: 30,
				height: 40,
			},
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('capturing', request.id)).toBeTrue()
			expect(capture).toHaveBeenCalledTimes(1)
			expect(capture.mock.calls[0][1]).toBe(camera)
			expect(mount.tracking).toBeTrue()

			const normalized = capture.mock.calls[0][2]

			expect(normalized.autoSave).toBeFalse()
			expect(normalized.count).toBe(1)
			expect(normalized.delay).toBe(0)
			expect(normalized.savePath).toBeUndefined()
			expect(normalized.frameType).toBe('LIGHT')
			expect(normalized.exposureMode).toBe('single')
			expect(normalized.mount).toBe(mount.name)
			expect(normalized.x).toBe(0)
			expect(normalized.y).toBe(0)
			expect(normalized.width).toBe(camera.frame.width.max)
			expect(normalized.height).toBe(camera.frame.height.max)

			expect(request.capture.count).toBe(10)
			expect(request.capture.frameType).toBe('DARK')
			expect(request.capture.width).toBe(30)

			expect(tppaEvents()).toEqual([
				{
					id: request.id,
					camera: camera.id,
					mount: mount.id,
					step: 0,
					state: 'capturing',
					attempts: 0,
					solved: false,
					aligned: false,
					count: 1,
					solver: { rightAscension: 0, declination: 0 },
					error: { azimuth: 0, altitude: 0 },
				},
			])
		} finally {
			pending.resolve({ ok: true, value: { paths: [], frameCount: 0 } })
			await tppaHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('holds the camera and the mount for the whole session', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest({ id: 'tppa-owns' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			expect(await waitForTppaState('capturing', request.id)).toBeTrue()

			const cameraIntruder = operationCoordinator.start('cameraCapture', [{ key: resourceKey(camera), device: camera }], () => ({ ok: true, value: undefined }))
			const mountIntruder = operationCoordinator.start('mountGoTo', [{ key: resourceKey(mount), device: mount }], () => ({ ok: true, value: undefined }))

			expect((await cameraIntruder.result).ok).toBeFalse()
			expect((await mountIntruder.result).ok).toBeFalse()
		} finally {
			pending.resolve({ ok: true, value: { paths: [], frameCount: 0 } })
			await tppaHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('stops an active session through the endpoint and reports it once', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest({ id: 'tppa-stop' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('capturing', request.id)).toBeTrue()

			const stopping = endpoints['/tppa/:id/stop'].POST(stopRequest(request.id))

			pending.resolve({ ok: false, reason: 'aborted' })

			await noContent(await stopping)

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(tppaEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(tppaEvents().at(-1)?.message).toBe('stopped')
			expect(mount.slewing).toBeFalse()
		} finally {
			pending.resolve({ ok: false, reason: 'aborted' })
			capture.mockRestore()
		}
	})

	test('ignores a duplicate session for the same request id', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest({ id: 'tppa-duplicate' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			expect(await waitForTppaState('capturing', request.id)).toBeTrue()

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(capture).toHaveBeenCalledTimes(1)
		} finally {
			pending.resolve({ ok: true, value: { paths: [], frameCount: 0 } })
			await tppaHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('stop is idempotent for an unknown session id', async () => {
		wsm.open(socket)

		await noContent(await endpoints['/tppa/:id/stop'].POST(stopRequest('missing')))

		expect(tppaMessages()).toHaveLength(0)
	})

	test('reports devices already owned by another operation instead of failing silently', async () => {
		const { camera, mount } = await connectedDevices()
		const request = tppaStartRequest({ id: 'tppa-busy' })
		const owner = operationCoordinator.start(
			'cameraCapture',
			[{ key: resourceKey(camera), device: camera }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }), { once: true })
				}),
		)

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('the camera or the mount is in use by another operation')
		} finally {
			await owner.cancel()
		}
	})

	test('names each device that cannot be used apart from one someone else is using', async () => {
		const { camera, mount } = await connectedDevices()
		const request = tppaStartRequest({ id: 'tppa-unavailable' })

		wsm.open(socket)

		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })
		resourceArbiter.markUnavailable({ key: resourceKey(mount), device: mount })

		try {
			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('the camera and the mount are not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
			resourceArbiter.markAvailable({ key: resourceKey(mount), device: mount })
		}
	})

	test('ends the session with the cause when the capture never produces a frame', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = tppaStartRequest({ id: 'tppa-noframe' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('the capture produced no frame')
		} finally {
			capture.mockRestore()
		}
	})

	test('fails the session when the capture reports a terminal failure', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve({ ok: false, reason: 'timeout', error: 'capture cleanup failed' }) }))
		const request = tppaStartRequest({ id: 'tppa-capture-failure' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('capture cleanup failed')
		} finally {
			capture.mockRestore()
		}
	})

	test('gives up after the configured number of failed solves', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: solvedFrame() }))
		const solve = spyOn(solver, 'start').mockImplementation(() => Promise.resolve(undefined))
		const request = tppaStartRequest({ id: 'tppa-solving', maxAttempts: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(solve.mock.calls[0][0]).toEqual({ ...request.solver, ...mount.equatorialCoordinate, radius: 8, path: 'plate.fit', id: request.id, blind: false })
			expect(solve.mock.calls[0][1]).toBeInstanceOf(AbortSignal)
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'solving', 'idle'])
			expect(tppaEvents().at(-1)?.attempts).toBe(1)
			expect(tppaEvents().at(-1)?.solved).toBeFalse()
			expect(tppaEvents().at(-1)?.message).toBe('solving failed')
		} finally {
			solve.mockRestore()
			capture.mockRestore()
		}
	})

	test('cancels the solve in flight when the session is stopped', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: solvedFrame() }))
		let solverAborted = false
		const solve = spyOn(solver, 'start').mockImplementation(
			(_, signal) =>
				new Promise((resolve) => {
					signal?.addEventListener(
						'abort',
						() => {
							solverAborted = true
							resolve(undefined)
						},
						{ once: true },
					)
				}),
		)
		const request = tppaStartRequest({ id: 'tppa-solve-cancel' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('solving', request.id)).toBeTrue()

			await noContent(await endpoints['/tppa/:id/stop'].POST(stopRequest(request.id)))

			expect(solverAborted).toBeTrue()
			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('stopped')
		} finally {
			solve.mockRestore()
			capture.mockRestore()
		}
	})

	test('solves the first point and moves the mount before the next one', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: solvedFrame() }))
		const solve = spyOn(solver, 'start').mockImplementation(() => Promise.resolve(plateSolution({ rightAscension: 0.3, declination: 0.4 })))
		const request = tppaStartRequest({ id: 'tppa-moving', direction: 'west', moveDuration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('moving', request.id, 5000)).toBeTrue()

			const events = tppaEvents()

			expect(events.map((event) => event.state)).toEqual(['capturing', 'solving', 'aligning', 'moving'])
			expect(events.at(-1)?.step).toBe(1)
			expect(events.at(-1)?.solved).toBeTrue()
			expect(events.at(-1)?.solver).toEqual({ rightAscension: 0.3, declination: 0.4 })
			expect(mountCommander.manualMoveOf(mount)?.directions()).toEqual(['WEST'])

			// The motion ends by itself once the configured duration is over, releasing the nested scope that
			// held the mount while the axis was moving.
			expect(await waitForTppaState('settling', request.id, 5000)).toBeTrue()
			expect(mountCommander.manualMoveOf(mount)).toBeUndefined()

			await noContent(await endpoints['/tppa/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().at(-1)?.message).toBe('stopped')
		} finally {
			solve.mockRestore()
			capture.mockRestore()
		}
	}, 20000)
})
