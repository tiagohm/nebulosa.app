import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager/camera'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { WheelManager } from 'nebulosa/src/devices/indi/manager/wheel'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { ConfirmationHandler } from 'src/api/confirmation'
import { darvBus, darv as darvEndpoints, DarvHandler } from 'src/api/darv'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { GuideOutputHandler } from 'src/api/guideoutput'
import { GuideOutputCommander } from 'src/api/guideoutput.commander'
import { ImageProcessor } from 'src/api/image.processor'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { DEFAULT_DARV_START } from '#/darv'
import type { DarvStart, DarvEvent } from '#/darv'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import { captureHandle, json, noContent, SocketMessager, waitUntil } from './util'

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
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, new NotificationHandler(wsm), cameraCapturer, new CameraCommander(cameraManager), operationCoordinator)
const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new NotificationHandler(wsm), new MountCommander(mountManager), operationCoordinator)
const guideOutputCommander = new GuideOutputCommander(guideOutputManager)
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager, new NotificationHandler(wsm), guideOutputCommander, operationCoordinator)
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

	await waitUntil(() => camera.connected && mount.connected)
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

function startRun(request: Bun.BunRequest) {
	return endpoints['/darv/:camera/:mount/start'].POST(request).then((response) => json<string>(response))
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

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id, 5000)
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
			expect(darvEvents().every((event) => event.id === id && event.camera === camera.id && event.mount === mount.id)).toBeTrue()
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
		const request = darvStartRequest({ initialPause: 0, duration: 0.02, hemisphere: 'southern' })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id, 5000)
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
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			expect(capture).toHaveBeenCalledTimes(1)
			expect(darvMessages()).toHaveLength(0)
			expect(pulseEast).not.toHaveBeenCalled()
			expect(pulseWest).not.toHaveBeenCalled()

			started.resolve(failedOperationResult('alert', 'the camera refused the exposure'))

			await waitForDarvState('idle', id)
			expect(darvEvents().map((event) => event.state)).toEqual(['idle'])
			expect(darvEvents().at(-1)?.message).toBe('the camera refused the exposure')
			expect(pulseEast).not.toHaveBeenCalled()
			expect(pulseWest).not.toHaveBeenCalled()
		} finally {
			started.resolve(failedOperationResult('aborted'))
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	})

	test('holds the camera and the mount for the whole run', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ initialPause: 5, duration: 1 })
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, mount, request))
			await waitForDarvState('waiting', id)

			const cameraIntruder = operationCoordinator.start('cameraCapture', [{ key: resourceKey(camera), device: camera }], () => successfulOperationResult(undefined))
			const mountIntruder = operationCoordinator.start('mountGoTo', [{ key: resourceKey(mount), device: mount }], () => successfulOperationResult(undefined))

			expect((await cameraIntruder.result).ok).toBeFalse()
			expect((await mountIntruder.result).ok).toBeFalse()
		} finally {
			await darvHandler.stop(id)
			capture.mockRestore()
		}
	})

	test('stops an active run through the endpoint and reports it once', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ initialPause: 5, duration: 1 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('waiting', id)

			await noContent(await endpoints['/darv/:id/stop'].POST(stopRequest(id)))

			await waitForDarvState('idle', id)
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'idle'])
			expect(darvEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(darvEvents().at(-1)?.message).toBe('stopped')
			expect(mount.pulsing).toBeFalse()
		} finally {
			capture.mockRestore()
		}
	})

	test('refuses a second run over the same devices without disturbing the live one', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = darvStartRequest({ initialPause: 5, duration: 1 })
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, mount, request))
			await waitForDarvState('waiting', id)

			const refused = await startRun(startRequest(camera, mount, request))

			expect(refused).not.toBe(id)
			expect(capture).toHaveBeenCalledTimes(1)

			await waitForDarvState('idle', refused)
			expect(darvEvents().some((event) => event.id === id && event.state === 'idle')).toBeFalse()
		} finally {
			await darvHandler.stop(id)
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
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })
		const owner = operationCoordinator.start(
			'cameraCapture',
			[{ key: resourceKey(camera), device: camera }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id)
			expect(darvEvents().at(-1)?.message).toBe('the camera or the mount is in use by another operation')
		} finally {
			await owner.cancel()
		}
	})

	test('names each device that cannot be used apart from one someone else is using', async () => {
		const { camera, mount } = await connectedDevices()
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })

		wsm.open(socket)

		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })
		resourceArbiter.markUnavailable({ key: resourceKey(mount), device: mount })

		try {
			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id)
			expect(darvEvents().at(-1)?.message).toBe('the camera and the mount are not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
			resourceArbiter.markAvailable({ key: resourceKey(mount), device: mount })
		}
	})

	test('ends the run with the cause when the capture reports a terminal failure', async () => {
		const { camera, mount } = await connectedDevices()
		const failed: Promise<OperationResult<CameraCaptureResult>> = Promise.resolve(failedOperationResult('timeout', 'capture cleanup failed'))
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: failed }))
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id, 5000)
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
		const request = darvStartRequest({ initialPause: 0, duration: 4, hemisphere: 'northern' })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('forwarding', id)

			failed.resolve(failedOperationResult('alert', 'the exposure was aborted by the driver'))

			await waitForDarvState('idle', id, 5000)
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'idle'])
			expect(darvEvents().at(-1)?.message).toBe('the exposure was aborted by the driver')
			expect(pulseEast.mock.calls.filter((call) => call[1] > 0)).toHaveLength(0)
			expect(mount.pulsing).toBeFalse()
		} finally {
			failed.resolve(failedOperationResult('aborted'))
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('gives each leg only the settle latency the exposure still allows', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const pulse = spyOn(guideOutputCommander, 'pulse').mockImplementation(() => Promise.resolve(successfulOperationResult(undefined)))
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id, 5000)
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
			return successfulOperationResult(undefined)
		})
		const request = darvStartRequest({ initialPause: 0, duration: 0.02 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForDarvState('idle', id, 10000)
			expect(pulse).toHaveBeenCalledTimes(1)
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'backwarding', 'idle'])
			expect(darvEvents().at(-1)?.message).toBe('the exposure ends before the trail can be finished')
		} finally {
			pulse.mockRestore()
			capture.mockRestore()
		}
	}, 20000)
})
