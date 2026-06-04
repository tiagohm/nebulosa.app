import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Camera } from 'nebulosa/src/indi.device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator } from 'nebulosa/src/indi.simulator'
import { CameraHandler } from 'src/api/camera'
import { flatWizard as flatWizardEndpoints, FlatWizardHandler } from 'src/api/flatwizard'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_FLAT_WIZARD_START, type CameraCaptureEvent, type FlatWizardEvent, type FlatWizardStart } from 'src/shared/types'
import { noContent, SocketMessager, waitUntil } from './util'

type FlatWizardStartOverrides = Omit<Partial<FlatWizardStart>, 'capture'> & {
	readonly capture?: Partial<FlatWizardStart['capture']>
}

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager)
const flatWizardHandler = new FlatWizardHandler(wsm, cameraHandler)
const endpoints = flatWizardEndpoints(flatWizardHandler)
const handler = new IndiClientHandlerSet([cameraManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager })
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	cameraManager.disconnect(getCamera())
})

afterEach(() => {
	flatWizardHandler.stop('flatwizard-start')
	flatWizardHandler.stop('flatwizard-stop')
	flatWizardHandler.stop('flatwizard-duplicate')
	flatWizardHandler.stop('flatwizard-stopped')
	flatWizardHandler.stop('flatwizard-error')
	flatWizardHandler.stop('flatwizard-frame')
	cameraManager.disconnect(getCamera())
})

function getCamera() {
	const device = cameraManager.get(client, 'Camera Simulator')!
	expect(device).toBeDefined()
	return device
}

function connectCamera() {
	const camera = getCamera()
	cameraManager.connect(camera)
	return camera
}

function flatWizardStartRequest(overrides: FlatWizardStartOverrides) {
	const request = structuredClone(DEFAULT_FLAT_WIZARD_START)
	Object.assign(request, overrides)
	Object.assign(request.capture, overrides.capture)
	return request
}

function startRequest(camera: Camera, body: FlatWizardStart) {
	return {
		url: `http://localhost/flatwizard/${encodeURIComponent(camera.id)}/start`,
		params: { camera: camera.id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function stopRequest(id: string) {
	return {
		url: `http://localhost/flatwizard/${encodeURIComponent(id)}/stop`,
		params: { id },
	} as unknown as Bun.BunRequest
}

function flatWizardMessages() {
	return socket.filter<FlatWizardEvent>((message) => message.type === 'flatwizard')
}

function flatWizardEvents() {
	return flatWizardMessages().map((message) => message.body)
}

function waitForFlatWizardState(state: FlatWizardEvent['state'], id: string) {
	return waitUntil(() => flatWizardEvents().some((event) => event.id === id && event.state === state))
}

function cameraCaptureEvent(overrides: Partial<CameraCaptureEvent>) {
	return Object.assign(structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT), overrides)
}

describe('flat wizard handler', () => {
	test('starts through endpoint and emits capturing event through wsm', async () => {
		const camera = connectCamera()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = flatWizardStartRequest({
			id: 'flatwizard-start',
			minExposure: 100,
			maxExposure: 300,
			capture: {
				autoSave: true,
				count: 10,
				delay: 5,
				exposureMode: 'fixed',
				frameType: 'DARK',
				savePath: '/tmp/not-used.fit',
				exposureTime: 99,
				exposureTimeUnit: 'second',
			},
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('capturing', request.id)).toBeTrue()
			expect(start).toHaveBeenCalledTimes(1)
			expect(start.mock.calls[0][0]).toBe(camera)
			expect(start.mock.calls[0][1]).toBe(request.capture)
			expect(request.capture.delay).toBe(0)
			expect(request.capture.count).toBe(1)
			expect(request.capture.autoSave).toBeFalse()
			expect(request.capture.savePath).toBeUndefined()
			expect(request.capture.exposureTime).toBe(200)
			expect(request.capture.exposureTimeUnit).toBe('millisecond')
			expect(request.capture.frameType).toBe('FLAT')
			expect(request.capture.exposureMode).toBe('single')
			expect(flatWizardEvents()).toEqual([
				{
					id: request.id,
					camera: camera.id,
					state: 'capturing',
					median: 0,
					message: 'exposure of 200 ms',
				},
			])
		} finally {
			start.mockRestore()
		}
	})

	test('stops active task through endpoint and emits idle event', async () => {
		const camera = connectCamera()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const stop = spyOn(cameraHandler, 'stop')
		const request = flatWizardStartRequest({ id: 'flatwizard-stop', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('capturing', request.id)).toBeTrue()

			await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('stopped')
			expect(stop).toHaveBeenCalledWith(camera)
		} finally {
			stop.mockRestore()
			start.mockRestore()
		}
	})

	test('ignores duplicate active task for same id or camera', async () => {
		const camera = connectCamera()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = flatWizardStartRequest({ id: 'flatwizard-duplicate', minExposure: 100, maxExposure: 300 })
		const duplicate = flatWizardStartRequest({ id: 'flatwizard-other', minExposure: 1, maxExposure: 2 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))
			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, duplicate)))

			expect(start).toHaveBeenCalledTimes(1)

			await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().filter((event) => event.id === duplicate.id)).toHaveLength(0)
		} finally {
			start.mockRestore()
		}
	})

	test('stop endpoint is idempotent for unknown task id', async () => {
		wsm.open(socket)

		await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest('missing')))

		expect(flatWizardMessages()).toHaveLength(0)
	})

	test('emits idle stopped event when camera capture stops', async () => {
		const camera = connectCamera()
		const stop = spyOn(cameraHandler, 'stop')
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'idle', stopped: true }))
			return Promise.resolve(true)
		})
		const request = flatWizardStartRequest({ id: 'flatwizard-stopped', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('stopped')
			expect(stop).toHaveBeenCalledWith(camera)
		} finally {
			start.mockRestore()
			stop.mockRestore()
		}
	})

	test('emits idle error event when camera capture fails', async () => {
		const camera = connectCamera()
		const stop = spyOn(cameraHandler, 'stop')
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'error' }))
			return Promise.resolve(true)
		})
		const request = flatWizardStartRequest({ id: 'flatwizard-error', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()

			const event = flatWizardEvents().find((event) => event.id === request.id && event.state === 'idle')

			expect(event).toBeDefined()
			expect(event!.message).toBe('flat wizard failed')
			expect(stop).toHaveBeenCalledWith(camera)
			expect(error).toHaveBeenCalled()
		} finally {
			start.mockRestore()
			error.mockRestore()
			stop.mockRestore()
		}
	})

	test('processes captured frame path from camera callback', async () => {
		const camera = connectCamera()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return Promise.resolve(true)
		})
		const transform = spyOn(imageProcessor, 'transform').mockImplementation(() => Promise.resolve(undefined))
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const request = flatWizardStartRequest({ id: 'flatwizard-frame', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(captureEvent).toBeDefined()
			socket.clear()
			captureEvent!(cameraCaptureEvent({ camera: camera.id, state: 'idle' }), 'flat.fit')

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(transform).toHaveBeenCalledWith('flat.fit', false, camera.name)
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['computing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('flat wizard failed')
		} finally {
			error.mockRestore()
			transform.mockRestore()
			start.mockRestore()
		}
	})
})
