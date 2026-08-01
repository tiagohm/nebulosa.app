import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { ConfirmationHandler } from 'src/api/confirmation'
import { darvBus, darv as darvEndpoints, DarvHandler } from 'src/api/darv'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { GuideOutputHandler } from 'src/api/guideoutput'
import { GuideOutputCommander } from 'src/api/guideoutput.commander'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { DEFAULT_DARV_START } from '#/darv'
import type { DarvStart, DarvEvent } from '#/darv'
import type { OperationResult } from '#/orchestration'
import { captureHandle, noContent, SocketMessager, waitUntil } from './util'

type DarvStartOverrides = Omit<Partial<DarvStart>, 'capture'> & {
	readonly capture?: Partial<DarvStart['capture']>
}

darvBus.forceSync = true
cameraBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const guideOutputManager = new GuideOutputManager({
	get: (client, name) => mountManager.get(client, name) ?? cameraManager.get(client, name),
})
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const cameraCapturer = new CameraCapturer(cameraManager, imageProcessor, resourceArbiter)
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, cameraCapturer, operationCoordinator)
const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new NotificationHandler(wsm), new MountCommander(mountManager), operationCoordinator)
const guideOutputCommander = new GuideOutputCommander(guideOutputManager)
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, guideOutputCommander)
const darvHandler = new DarvHandler(wsm, cameraHandler, mountHandler, guideOutputHandler, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(cameraManager)
deviceLifecycle.observe(mountManager)
const endpoints = darvEndpoints(darvHandler)
const handler = new IndiClientHandlerSet([cameraManager, mountManager, guideOutputManager])
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

function darvStartRequest(overrides: DarvStartOverrides) {
	const request = structuredClone(DEFAULT_DARV_START)
	Object.assign(request, overrides)
	Object.assign(request.capture, overrides.capture)
	return request
}

function startRequest(camera: Camera, mount: Mount, body: DarvStart) {
	return {
		url: `http://localhost/darv/${encodeURIComponent(camera.id)}/${encodeURIComponent(mount.id)}/start`,
		params: { camera: camera.id, mount: mount.id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function stopRequest(id: string) {
	return {
		url: `http://localhost/darv/${encodeURIComponent(id)}/stop`,
		params: { id },
	} as unknown as Bun.BunRequest
}

function darvMessages() {
	return socket.filter<DarvEvent>((message) => message.type === 'darv:update')
}

function darvEvents() {
	return darvMessages().map((message) => message.body)
}

function waitForDarvState(state: DarvEvent['state'], id: string, timeout?: number) {
	return waitUntil(() => darvEvents().some((event) => event.id === id && event.state === state), timeout)
}

describe('darv handler', () => {
	test('normalizes the capture and draws both legs of the trail', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const request = darvStartRequest({
			id: 'darv',
			initialPause: 0,
			duration: 0.02,
			hemisphere: 'northern',
			capture: {
				autoSave: true,
				count: 10,
				delay: 5,
				exposureMode: 'fixed',
				frameType: 'DARK',
				mount: undefined,
				x: 10,
				y: 20,
				width: 30,
				height: 40,
				exposureTime: 99,
				exposureTimeUnit: 'minute',
			},
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id, 5000)).toBeTrue()
			expect(capture).toHaveBeenCalledTimes(1)
			expect(capture.mock.calls[0][0]).toHaveProperty('kind', 'darv')
			expect(capture.mock.calls[0][1]).toBe(camera)

			const normalized = capture.mock.calls[0][2]

			expect(normalized.autoSave).toBeFalse()
			expect(normalized.count).toBe(1)
			expect(normalized.delay).toBe(0)
			expect(normalized.frameType).toBe('LIGHT')
			expect(normalized.exposureMode).toBe('single')
			expect(normalized.mount).toBe(mount.name)
			expect(normalized.x).toBe(0)
			expect(normalized.y).toBe(0)
			expect(normalized.width).toBe(camera.frame.width.max)
			expect(normalized.height).toBe(camera.frame.height.max)
			expect(normalized.exposureTime).toBe(6)
			expect(normalized.exposureTimeUnit).toBe('second')

			expect(request.capture.count).toBe(10)
			expect(request.capture.frameType).toBe('DARK')

			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'backwarding', 'idle'])
			expect(darvEvents().every((event) => event.id === request.id && event.camera === camera.id && event.mount === mount.id)).toBeTrue()
			expect(darvEvents().at(-1)?.message).toBeUndefined()
			expect(pulseWest.mock.calls.map((call) => call[1])).toEqual([10, 0, 0, 0])
			expect(pulseEast.mock.calls.map((call) => call[1])).toEqual([0, 0, 10, 0])
		} finally {
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('uses the southern hemisphere direction order', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const request = darvStartRequest({ id: 'darv-southern', initialPause: 0, duration: 0.02, hemisphere: 'southern' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id, 5000)).toBeTrue()
			expect(pulseEast.mock.calls.map((call) => call[1])).toEqual([10, 0, 0, 0])
			expect(pulseWest.mock.calls.map((call) => call[1])).toEqual([0, 0, 10, 0])
		} finally {
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('does not pulse before the exposure has started', async () => {
		const { camera, mount } = await connectedDevices()
		const started = Promise.withResolvers<OperationResult<void>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ started: started.promise }))
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const request = darvStartRequest({ id: 'darv-not-started', initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(capture).toHaveBeenCalledTimes(1)
			expect(darvMessages()).toHaveLength(0)
			expect(pulseEast).not.toHaveBeenCalled()
			expect(pulseWest).not.toHaveBeenCalled()

			started.resolve({ ok: false, reason: 'alert', error: 'the camera refused the exposure' })

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().map((event) => event.state)).toEqual(['idle'])
			expect(darvEvents().at(-1)?.message).toBe('the camera refused the exposure')
			expect(pulseEast).not.toHaveBeenCalled()
			expect(pulseWest).not.toHaveBeenCalled()
		} finally {
			started.resolve({ ok: false, reason: 'aborted' })
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	})

	test('holds the camera and the mount for the whole run', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ id: 'darv-owns', initialPause: 5, duration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			expect(await waitForDarvState('waiting', request.id)).toBeTrue()

			const cameraIntruder = operationCoordinator.start('cameraCapture', [{ key: resourceKey(camera), device: camera }], () => ({ ok: true, value: undefined }))
			const mountIntruder = operationCoordinator.start('mountGoTo', [{ key: resourceKey(mount), device: mount }], () => ({ ok: true, value: undefined }))

			expect((await cameraIntruder.result).ok).toBeFalse()
			expect((await mountIntruder.result).ok).toBeFalse()
		} finally {
			await darvHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('stops an active run through the endpoint and reports it once', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ id: 'darv-stop', initialPause: 5, duration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('waiting', request.id)).toBeTrue()

			await noContent(await endpoints['/darv/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'idle'])
			expect(darvEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(darvEvents().at(-1)?.message).toBe('stopped')
			expect(mount.pulsing).toBeFalse()
		} finally {
			capture.mockRestore()
		}
	})

	test('ignores a duplicate run for the same request id', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ id: 'darv-duplicate', initialPause: 5, duration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			expect(await waitForDarvState('waiting', request.id)).toBeTrue()

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(capture).toHaveBeenCalledTimes(1)
		} finally {
			await darvHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('stop is idempotent for an unknown run id', async () => {
		wsm.open(socket)

		await noContent(await endpoints['/darv/:id/stop'].POST(stopRequest('missing')))

		expect(darvMessages()).toHaveLength(0)
	})

	test('reports devices already owned by another operation instead of failing silently', async () => {
		const { camera, mount } = await connectedDevices()
		const request = darvStartRequest({ id: 'darv-busy', initialPause: 0, duration: 0.02 })
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

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().at(-1)?.message).toBe('the camera or the mount is in use by another operation')
		} finally {
			await owner.cancel()
		}
	})

	test('names each device that cannot be used apart from one someone else is using', async () => {
		const { camera, mount } = await connectedDevices()
		const request = darvStartRequest({ id: 'darv-unavailable', initialPause: 0, duration: 0.02 })

		wsm.open(socket)

		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })
		resourceArbiter.markUnavailable({ key: resourceKey(mount), device: mount })

		try {
			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().at(-1)?.message).toBe('the camera and the mount are not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
			resourceArbiter.markAvailable({ key: resourceKey(mount), device: mount })
		}
	})

	test('ends the run with the cause when the capture reports a terminal failure', async () => {
		const { camera, mount } = await connectedDevices()
		const failed: Promise<OperationResult<CameraCaptureResult>> = Promise.resolve({ ok: false, reason: 'timeout', error: 'capture cleanup failed' })
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: failed }))
		const request = darvStartRequest({ id: 'darv-capture-failure', initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id, 5000)).toBeTrue()
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'idle'])
			expect(darvEvents().at(-1)?.message).toBe('capture cleanup failed')
		} finally {
			capture.mockRestore()
		}
	}, 10000)

	test('stops drawing the trail as soon as the exposure fails mid leg', async () => {
		const { camera, mount } = await connectedDevices()
		const failed = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: failed.promise }))
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const request = darvStartRequest({ id: 'darv-capture-mid-leg', initialPause: 0, duration: 4, hemisphere: 'northern' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('forwarding', request.id)).toBeTrue()

			failed.resolve({ ok: false, reason: 'alert', error: 'the exposure was aborted by the driver' })

			expect(await waitForDarvState('idle', request.id, 5000)).toBeTrue()
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'idle'])
			expect(darvEvents().at(-1)?.message).toBe('the exposure was aborted by the driver')
			expect(pulseEast.mock.calls.filter((call) => call[1] > 0)).toHaveLength(0)
			expect(mount.pulsing).toBeFalse()
		} finally {
			failed.resolve({ ok: false, reason: 'aborted' })
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('gives each leg only the settle latency the exposure still allows', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const pulse = spyOn(guideOutputCommander, 'pulse').mockImplementation(() => Promise.resolve({ ok: true, value: undefined }))
		const request = darvStartRequest({ id: 'darv-settle-budget', initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id, 5000)).toBeTrue()
			expect(pulse).toHaveBeenCalledTimes(2)

			const exposure = capture.mock.calls[0][2].exposureTime * 1000
			const forward = pulse.mock.calls[0][4]!.settleTimeout!
			const backward = pulse.mock.calls[1][4]!.settleTimeout!

			expect(forward).toBeGreaterThan(0)
			expect(forward + 10 + 10).toBeLessThanOrEqual(exposure)
			expect(backward).toBeGreaterThan(0)
			expect(backward + 10).toBeLessThanOrEqual(exposure)
		} finally {
			pulse.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('ends the run when a leg leaves no exposure for the one after it', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const pulse = spyOn(guideOutputCommander, 'pulse').mockImplementation(async () => {
			await Bun.sleep(6100)
			return { ok: true, value: undefined }
		})
		const request = darvStartRequest({ id: 'darv-settle-exhausted', initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id, 10000)).toBeTrue()
			expect(pulse).toHaveBeenCalledTimes(1)
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'backwarding', 'idle'])
			expect(darvEvents().at(-1)?.message).toBe('the exposure ends before the trail can be finished')
		} finally {
			pulse.mockRestore()
			capture.mockRestore()
		}
	}, 20000)
})
