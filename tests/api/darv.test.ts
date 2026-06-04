import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { CameraManager, FocuserManager, GuideOutputManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator, MountSimulator } from 'nebulosa/src/indi.simulator'
import { CacheManager } from 'src/api/cache'
import { CameraHandler } from 'src/api/camera'
import { ConfirmationHandler } from 'src/api/confirmation'
import { darv as darvEndpoints, DarvHandler } from 'src/api/darv'
import { GuideOutputHandler } from 'src/api/guideoutput'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { DEFAULT_DARV_START, type DarvEvent, type DarvStart } from 'src/shared/types'
import { noContent, SocketMessager, waitUntil } from './util'

type DarvStartOverrides = Omit<Partial<DarvStart>, 'capture'> & {
	readonly capture?: Partial<DarvStart['capture']>
}

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
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager)
const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new CacheManager())
const guideOutputHandler = new GuideOutputHandler(wsm, guideOutputManager)
const darvHandler = new DarvHandler(wsm, cameraHandler, mountHandler, guideOutputHandler)
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

afterEach(() => {
	darvHandler.stop('darv')
	darvHandler.stop('darv-stop')
	darvHandler.stop('darv-duplicate')
	darvHandler.stop('darv-failed')
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

function connectDevices() {
	const camera = getCamera()
	const mount = getMount()

	cameraManager.connect(camera)
	mountManager.connect(mount)

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
	return socket.filter<DarvEvent>((message) => message.type === 'darv')
}

function darvEvents() {
	return darvMessages().map((message) => message.body)
}

function waitForDarvState(state: DarvEvent['state'], id: string) {
	return waitUntil(() => darvEvents().some((event) => event.id === id && event.state === state))
}

describe('darv handler', () => {
	test('starts through endpoint and emits lifecycle events through wsm', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const stop = spyOn(cameraHandler, 'stop')
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const mountStop = spyOn(mountManager, 'stop')
		const request = darvStartRequest({
			id: 'darv',
			initialPause: 0,
			duration: 0.002,
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

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(start).toHaveBeenCalledTimes(1)
			expect(start.mock.calls[0][0]).toBe(camera)
			expect(start.mock.calls[0][1]).toBe(request.capture)
			expect(request.capture.autoSave).toBeFalse()
			expect(request.capture.count).toBe(1)
			expect(request.capture.delay).toBe(0)
			expect(request.capture.frameType).toBe('LIGHT')
			expect(request.capture.exposureMode).toBe('single')
			expect(request.capture.mount).toBe(mount.name)
			expect(request.capture.x).toBe(0)
			expect(request.capture.y).toBe(0)
			expect(request.capture.width).toBe(camera.frame.width.max)
			expect(request.capture.height).toBe(camera.frame.height.max)
			expect(request.capture.exposureTime).toBe(1)
			expect(request.capture.exposureTimeUnit).toBe('second')
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'forwarding', 'backwarding', 'idle'])
			expect(darvEvents().every((event) => event.id === request.id && event.camera === camera.id && event.mount === mount.id)).toBeTrue()
			expect(pulseWest).toHaveBeenCalledWith(mount, 1)
			expect(pulseEast).toHaveBeenCalledWith(mount, 1)
			expect(pulseEast).toHaveBeenCalledWith(mount, 0)
			expect(pulseWest).toHaveBeenCalledWith(mount, 0)
			expect(mountStop).toHaveBeenCalledWith(mount)
			expect(stop).toHaveBeenCalledWith(camera)
		} finally {
			mountStop.mockRestore()
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			stop.mockRestore()
			start.mockRestore()
		}
	})

	test('uses southern hemisphere pulse direction order', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const pulseEast = spyOn(guideOutputManager, 'pulseEast')
		const pulseWest = spyOn(guideOutputManager, 'pulseWest')
		const request = darvStartRequest({
			id: 'darv',
			initialPause: 0,
			duration: 0.004,
			hemisphere: 'southern',
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(pulseEast.mock.calls.map((call) => call[1])).toEqual([2, 0, 0])
			expect(pulseWest.mock.calls.map((call) => call[1])).toEqual([0, 2, 0])
		} finally {
			pulseWest.mockRestore()
			pulseEast.mockRestore()
			start.mockRestore()
		}
	})

	test('ignores duplicate active task for same id, camera, or mount', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = darvStartRequest({ id: 'darv-duplicate', initialPause: 1, duration: 1 })
		const duplicate = darvStartRequest({ id: 'darv-other', initialPause: 0, duration: 0 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, duplicate)))

			expect(start).toHaveBeenCalledTimes(1)

			await noContent(endpoints['/darv/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().filter((event) => event.id === duplicate.id)).toHaveLength(0)
		} finally {
			start.mockRestore()
		}
	})

	test('stops active task through endpoint and emits idle event', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const stop = spyOn(cameraHandler, 'stop')
		const mountStop = spyOn(mountManager, 'stop')
		const request = darvStartRequest({ id: 'darv-stop', initialPause: 1, duration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('waiting', request.id)).toBeTrue()

			await noContent(endpoints['/darv/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()
			expect(darvEvents().map((event) => event.state)).toEqual(['waiting', 'idle'])
			expect(stop).toHaveBeenCalledWith(camera)
			expect(mountStop).toHaveBeenCalledWith(mount)
		} finally {
			mountStop.mockRestore()
			stop.mockRestore()
			start.mockRestore()
		}
	})

	test('stop endpoint is idempotent for unknown task id', async () => {
		wsm.open(socket)

		await noContent(endpoints['/darv/:id/stop'].POST(stopRequest('missing')))

		expect(darvMessages()).toHaveLength(0)
	})

	test('emits idle error event when task start fails', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => {
			throw new Error('camera start failed')
		})
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const request = darvStartRequest({ id: 'darv-failed', initialPause: 0, duration: 0 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/darv/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForDarvState('idle', request.id)).toBeTrue()

			const event = darvEvents().find((event) => event.id === request.id && event.state === 'idle')

			expect(event).toBeDefined()
			expect(event!.message).toBe('darv failed')
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
			start.mockRestore()
		}
	})
})
