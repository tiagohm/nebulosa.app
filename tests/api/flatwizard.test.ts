import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import { flatWizardBus, flatWizard as flatWizardEndpoints, FlatWizardHandler } from 'src/api/flatwizard'
import { ImageProcessor } from 'src/api/image.processor'
import { WebSocketMessageHandler } from 'src/api/message'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureEvent } from '#/camera'
import { DEFAULT_FLAT_WIZARD_START } from '#/flatwizard'
import type { FlatWizardEvent, FlatWizardStart } from '#/flatwizard'
import { captureHandle, noContent, SocketMessager, waitUntil } from './util'

type FlatWizardStartOverrides = Omit<Partial<FlatWizardStart>, 'capture'> & {
	readonly capture?: Partial<FlatWizardStart['capture']>
}

flatWizardBus.forceSync = true
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
	flatWizardHandler.stop('flatwizard-busy')
	flatWizardHandler.stop('flatwizard-release-error')
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
	return socket.filter<FlatWizardEvent>((message) => message.type === 'flatwizard:update')
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
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
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
			expect(capture).toHaveBeenCalledTimes(1)
			expect(capture.mock.calls[0][0]).toBe(camera)
			expect(capture.mock.calls[0][1]).toBe(request.capture)
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
			capture.mockRestore()
		}
	})

	test('stops active task through endpoint and emits idle event', async () => {
		const camera = connectCamera()
		let canceled = false
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ cancel: () => ((canceled = true), Promise.resolve()) }))
		const request = flatWizardStartRequest({ id: 'flatwizard-stop', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('capturing', request.id)).toBeTrue()

			await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('stopped')
		} finally {
			capture.mockRestore()
		}
	})

	test('ignores duplicate active task for same id or camera', async () => {
		const camera = connectCamera()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = flatWizardStartRequest({ id: 'flatwizard-duplicate', minExposure: 100, maxExposure: 300 })
		const duplicate = flatWizardStartRequest({ id: 'flatwizard-other', minExposure: 1, maxExposure: 2 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))
			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, duplicate)))

			expect(capture).toHaveBeenCalledTimes(1)

			await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().filter((event) => event.id === duplicate.id)).toHaveLength(0)
		} finally {
			capture.mockRestore()
		}
	})

	test('stop endpoint is idempotent for unknown task id', async () => {
		wsm.open(socket)

		await noContent(endpoints['/flatwizard/:id/stop'].POST(stopRequest('missing')))

		expect(flatWizardMessages()).toHaveLength(0)
	})

	test('emits idle stopped event when camera capture stops', async () => {
		const camera = connectCamera()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ operation: 'flatwizard-stopped-capture', camera: camera.id, state: 'idle', stopped: true }))
			return captureHandle()
		})
		const request = flatWizardStartRequest({ id: 'flatwizard-stopped', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('stopped')
		} finally {
			capture.mockRestore()
		}
	})

	test('emits idle error event when camera capture fails', async () => {
		const camera = connectCamera()
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const capture = spyOn(cameraHandler, 'capture').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ operation: 'flatwizard-error-capture', camera: camera.id, state: 'error' }))
			return captureHandle()
		})
		const request = flatWizardStartRequest({ id: 'flatwizard-error', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))

			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()

			const event = flatWizardEvents().find((event) => event.id === request.id && event.state === 'idle')

			expect(event).toBeDefined()
			expect(event!.message).toBe('flat wizard failed')
			expect(error).toHaveBeenCalled()
		} finally {
			capture.mockRestore()
			error.mockRestore()
		}
	})

	test('does not stop the active camera owner when its capture is rejected', async () => {
		const camera = connectCamera()
		const manualRequest = { ...structuredClone(DEFAULT_CAMERA_CAPTURE_START), exposureMode: 'loop' as const, exposureTime: 200, exposureTimeUnit: 'millisecond' as const }
		const request = flatWizardStartRequest({ id: 'flatwizard-busy', minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)
			expect(await waitUntil(() => camera.connected)).toBeTrue()
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })

			const manual = cameraHandler.capture(camera, manualRequest)
			const started = await manual.started
			expect(started.ok).toBeTrue()

			await noContent(await endpoints['/flatwizard/:camera/start'].POST(startRequest(camera, request)))
			expect(await waitForFlatWizardState('idle', request.id)).toBeTrue()

			let manualSettled = false
			void manual.result.then(() => {
				manualSettled = true
			})
			await Bun.sleep(10)
			expect(manualSettled).toBeFalse()

			await manual.cancel()
		} finally {
			flatWizardHandler.stop(request.id)
		}
	})

	test('processes captured frame path from camera callback', async () => {
		const camera = connectCamera()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const capture = spyOn(cameraHandler, 'capture').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return captureHandle()
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
			capture.mockRestore()
		}
	})
})
