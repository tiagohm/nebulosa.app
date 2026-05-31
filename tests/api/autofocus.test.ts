import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator, FocuserSimulator } from 'nebulosa/src/indi.simulator'
import type { DetectedStar } from 'nebulosa/src/star.detector'
import { autoFocus as autoFocusEndpoints, AutoFocusHandler } from 'src/api/autofocus'
import { CameraHandler } from 'src/api/camera'
import { FocuserHandler } from 'src/api/focuser'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { StarDetectionHandler } from 'src/api/stardetection'
import { DEFAULT_AUTO_FOCUS_START, DEFAULT_CAMERA_CAPTURE_EVENT, type AutoFocusEvent, type AutoFocusStart, type CameraCaptureEvent } from 'src/shared/types'
import { noContent, SocketMessager, waitUntil } from './util'

type AutoFocusStartOverrides = Omit<Partial<AutoFocusStart>, 'capture' | 'starDetection'> & {
	readonly capture?: Partial<AutoFocusStart['capture']>
	readonly starDetection?: Partial<AutoFocusStart['starDetection']>
}

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager)
const focuserHandler = new FocuserHandler(wsm, focuserManager)
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const autoFocusHandler = new AutoFocusHandler(wsm, cameraHandler, focuserHandler, starDetectionHandler)
const endpoints = autoFocusEndpoints(autoFocusHandler)
const handler = new IndiClientHandlerSet([cameraManager, focuserManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulators = [new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }), new FocuserSimulator('Focuser Simulator', client)] as const
const socket = new SocketMessager()

afterAll(() => {
	for (const simulator of simulators) simulator.dispose()

	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	cameraManager.disconnect(getCamera())
	focuserManager.disconnect(getFocuser())
})

afterEach(() => {
	autoFocusHandler.stop('autofocus-start')
	autoFocusHandler.stop('autofocus-stop')
	autoFocusHandler.stop('autofocus-duplicate')
	autoFocusHandler.stop('autofocus-stopped')
	autoFocusHandler.stop('autofocus-error')
	autoFocusHandler.stop('autofocus-nostars')
	autoFocusHandler.stop('autofocus-moving')
	cameraManager.disconnect(getCamera())
	focuserManager.disconnect(getFocuser())
})

function getCamera() {
	const device = cameraManager.get(client, 'Camera Simulator')!
	expect(device).toBeDefined()
	return device
}

function getFocuser() {
	const device = focuserManager.get(client, 'Focuser Simulator')!
	expect(device).toBeDefined()
	return device
}

function connectDevices() {
	const camera = getCamera()
	const focuser = getFocuser()

	cameraManager.connect(camera)
	focuserManager.connect(focuser)

	return { camera, focuser }
}

function autoFocusStartRequest(overrides: AutoFocusStartOverrides = {}) {
	const request = structuredClone(DEFAULT_AUTO_FOCUS_START)
	Object.assign(request, overrides)
	Object.assign(request.capture, overrides.capture)
	Object.assign(request.starDetection, overrides.starDetection)
	return request
}

function startRequest(camera: Camera, focuser: Focuser, body: AutoFocusStart) {
	return {
		url: `http://localhost/autofocus/${encodeURIComponent(camera.id)}/${encodeURIComponent(focuser.id)}/start`,
		params: { camera: camera.id, focuser: focuser.id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function stopRequest(id: string) {
	return {
		url: `http://localhost/autofocus/${encodeURIComponent(id)}/stop`,
		params: { id },
	} as unknown as Bun.BunRequest
}

function autoFocusMessages() {
	return socket.filter<AutoFocusEvent>((message) => message.type === 'autofocus')
}

function autoFocusEvents() {
	return autoFocusMessages().map((message) => message.body)
}

function waitForAutoFocusState(state: AutoFocusEvent['state'], id: string) {
	return waitUntil(() => autoFocusEvents().some((event) => event.id === id && event.state === state))
}

function cameraCaptureEvent(overrides: Partial<CameraCaptureEvent>) {
	return Object.assign(structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT), overrides)
}

function star(hfd: number): DetectedStar {
	return { x: 1, y: 2, hfd, snr: 10, flux: 100 }
}

describe('auto focus handler', () => {
	test('starts through endpoint and emits capturing event through wsm', async () => {
		const { camera, focuser } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = autoFocusStartRequest({
			id: 'autofocus-start',
			maxPosition: 0,
			capture: {
				autoSave: true,
				count: 10,
				delay: 5,
				exposureMode: 'fixed',
				frameType: 'DARK',
				savePath: '/tmp/not-used.fit',
				focuser: undefined,
			},
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('capturing', request.id)).toBeTrue()
			expect(start).toHaveBeenCalledTimes(1)
			expect(start.mock.calls[0][0]).toBe(camera)
			expect(start.mock.calls[0][1]).toBe(request.capture)
			expect(request.maxPosition).toBe(focuser.position.max)
			expect(request.capture.delay).toBe(0)
			expect(request.capture.count).toBe(1)
			expect(request.capture.autoSave).toBeFalse()
			expect(request.capture.savePath).toBeUndefined()
			expect(request.capture.focuser).toBe(focuser.name)
			expect(request.capture.frameType).toBe('LIGHT')
			expect(request.capture.exposureMode).toBe('single')
			expect(autoFocusEvents()).toEqual([
				{
					id: request.id,
					camera: camera.id,
					focuser: focuser.id,
					state: 'capturing',
					starCount: 0,
					hfd: 0,
					x: [],
					y: [],
					message: '',
				},
			])
		} finally {
			start.mockRestore()
		}
	})

	test('stops active task through endpoint and emits idle event', async () => {
		const { camera, focuser } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const cameraStop = spyOn(cameraHandler, 'stop')
		const focuserStop = spyOn(focuserHandler, 'stop')
		const request = autoFocusStartRequest({ id: 'autofocus-stop' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('capturing', request.id)).toBeTrue()

			await noContent(endpoints['/autofocus/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(autoFocusEvents().at(-1)?.message).toBe('stopped')
			expect(cameraStop).toHaveBeenCalledWith(camera)
			expect(focuserStop).toHaveBeenCalledWith(focuser)
		} finally {
			focuserStop.mockRestore()
			cameraStop.mockRestore()
			start.mockRestore()
		}
	})

	test('ignores duplicate active task for same id, camera, or focuser', async () => {
		const { camera, focuser } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = autoFocusStartRequest({ id: 'autofocus-duplicate' })
		const duplicate = autoFocusStartRequest({ id: 'autofocus-other' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))
			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, duplicate)))

			expect(start).toHaveBeenCalledTimes(1)

			await noContent(endpoints['/autofocus/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().filter((event) => event.id === duplicate.id)).toHaveLength(0)
		} finally {
			start.mockRestore()
		}
	})

	test('stop endpoint is idempotent for unknown task id', async () => {
		wsm.open(socket)

		await noContent(endpoints['/autofocus/:id/stop'].POST(stopRequest('missing')))

		expect(autoFocusMessages()).toHaveLength(0)
	})

	test('emits idle stopped event when camera capture stops', async () => {
		const { camera, focuser } = connectDevices()
		const cameraStop = spyOn(cameraHandler, 'stop')
		const focuserStop = spyOn(focuserHandler, 'stop')
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'idle', stopped: true }))
			return Promise.resolve(true)
		})
		const request = autoFocusStartRequest({ id: 'autofocus-stopped' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(autoFocusEvents().at(-1)?.message).toBe('stopped')
			expect(cameraStop).toHaveBeenCalledWith(camera)
			expect(focuserStop).toHaveBeenCalledWith(focuser)
		} finally {
			start.mockRestore()
			focuserStop.mockRestore()
			cameraStop.mockRestore()
		}
	})

	test('emits idle stopped event when camera capture fails', async () => {
		const { camera, focuser } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'error' }))
			return Promise.resolve(true)
		})
		const request = autoFocusStartRequest({ id: 'autofocus-error' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(autoFocusEvents().at(-1)?.message).toBe('stopped')
		} finally {
			start.mockRestore()
		}
	})

	test('detects no stars from captured frame and emits idle message', async () => {
		const { camera, focuser } = connectDevices()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return Promise.resolve(true)
		})
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))
		const request = autoFocusStartRequest({ id: 'autofocus-nostars' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(captureEvent).toBeDefined()
			captureEvent!(cameraCaptureEvent({ camera: camera.id, state: 'idle' }), 'focus.fit')

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(detect).toHaveBeenCalledWith({ ...request.starDetection, path: 'focus.fit' })
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'computing', 'idle'])
			expect(autoFocusEvents().at(-1)?.message).toBe('no stars detected')
		} finally {
			detect.mockRestore()
			start.mockRestore()
		}
	})

	test('detects stars, updates HFD, and moves focuser', async () => {
		const { camera, focuser } = connectDevices()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return Promise.resolve(true)
		})
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([star(4), star(2), star(6)]))
		const moveTo = spyOn(focuserHandler, 'moveTo')
		const request = autoFocusStartRequest({ id: 'autofocus-moving', initialOffsetSteps: 2, stepSize: 25 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(captureEvent).toBeDefined()
			captureEvent!(cameraCaptureEvent({ camera: camera.id, state: 'idle' }), 'focus.fit')

			expect(await waitForAutoFocusState('moving', request.id)).toBeTrue()
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'computing', 'moving'])
			expect(autoFocusEvents().at(-1)?.starCount).toBe(3)
			expect(autoFocusEvents().at(-1)?.hfd).toBe(4)
			expect(autoFocusEvents().at(-1)?.message).toBe(`moving to position ${focuser.position.value + 50}`)
			expect(moveTo).toHaveBeenCalledWith(focuser, focuser.position.value + 50)
		} finally {
			moveTo.mockRestore()
			detect.mockRestore()
			start.mockRestore()
		}
	})
})
