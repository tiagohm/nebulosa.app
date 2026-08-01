import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { sep } from 'path'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { autoFocusBus, autoFocus as autoFocusEndpoints, AutoFocusHandler } from 'src/api/autofocus'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { FocuserHandler } from 'src/api/focuser'
import { FocuserCommander } from 'src/api/focuser.commander'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { StarDetectionHandler } from 'src/api/stardetection'
import { DEFAULT_AUTO_FOCUS_START } from '#/autofocus'
import type { AutoFocusEvent, AutoFocusStart } from '#/autofocus'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { OperationResult } from '#/orchestration'
import { captureHandle, noContent, SocketMessager, waitUntil } from './util'

type AutoFocusStartOverrides = Omit<Partial<AutoFocusStart>, 'capture' | 'starDetection'> & {
	readonly capture?: Partial<AutoFocusStart['capture']>
	readonly starDetection?: Partial<AutoFocusStart['starDetection']>
}

autoFocusBus.forceSync = true
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
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, cameraCapturer, new CameraCommander(cameraManager), operationCoordinator)
const focuserCommander = new FocuserCommander(focuserManager)
const focuserHandler = new FocuserHandler(wsm, focuserManager, new NotificationHandler(wsm), focuserCommander, operationCoordinator)
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const autoFocusHandler = new AutoFocusHandler(wsm, cameraHandler, focuserHandler, starDetectionHandler, operationCoordinator)
const endpoints = autoFocusEndpoints(autoFocusHandler)
const handler = new IndiClientHandlerSet([cameraManager, focuserManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulators = [new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }), new FocuserSimulator('Focuser Simulator', client)] as const
Bun.env.capturesDir = await mkdtemp(tmpdir() + sep)

const socket = new SocketMessager()

afterAll(async () => {
	for (const simulator of simulators) simulator.dispose()

	wsm.close(socket, 1000, 'done')
	await rm(Bun.env.capturesDir, { recursive: true, force: true })
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	cameraManager.disconnect(getCamera())
	focuserManager.disconnect(getFocuser())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
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

async function connectedDevices() {
	const { camera, focuser } = connectDevices()

	expect(await waitUntil(() => camera.connected && focuser.connected)).toBeTrue()
	resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
	resourceArbiter.markAvailable({ key: resourceKey(focuser), device: focuser })

	return { camera, focuser }
}

function autoFocusStartRequest(overrides: AutoFocusStartOverrides = {}) {
	const request = structuredClone(DEFAULT_AUTO_FOCUS_START)
	Object.assign(request, overrides)
	Object.assign(request.capture, overrides.capture)
	Object.assign(request.starDetection, overrides.starDetection)
	request.capture.exposureTime ||= 100
	request.capture.exposureTimeUnit = 'millisecond'
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
	return socket.filter<AutoFocusEvent>((message) => message.type === 'autofocus:update')
}

function autoFocusEvents() {
	return autoFocusMessages().map((message) => message.body)
}

function waitForAutoFocusState(state: AutoFocusEvent['state'], id: string, timeout?: number) {
	return waitUntil(() => autoFocusEvents().some((event) => event.id === id && event.state === state), timeout)
}

function star(hfd: number): DetectedStar {
	return { x: 1, y: 2, hfd, snr: 10, flux: 100 }
}

// V-curve centered on the given position, one HFD unit per step size away from it.
function vCurve(focuser: Focuser, best: number, stepSize: number) {
	return () => Promise.resolve([star(Math.abs(focuser.position.value - best) / stepSize + 1)])
}

describe('auto focus handler', () => {
	test('normalizes the capture into a single light exposure without rewriting the caller request', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
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
			expect(capture).toHaveBeenCalledTimes(1)
			expect(capture.mock.calls[0][1]).toBe(camera)

			const normalized = capture.mock.calls[0][2]

			expect(normalized.delay).toBe(0)
			expect(normalized.count).toBe(1)
			expect(normalized.autoSave).toBeFalse()
			expect(normalized.savePath).toBeUndefined()
			expect(normalized.focuser).toBe(focuser.name)
			expect(normalized.frameType).toBe('LIGHT')
			expect(normalized.exposureMode).toBe('single')

			// The caller's own request is left as it was handed in.
			expect(request.maxPosition).toBe(0)
			expect(request.capture.count).toBe(10)
			expect(request.capture.frameType).toBe('DARK')

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
			capture.mockRestore()
		}
	})

	test('captures inside its own operation, holding both devices across the search', async () => {
		const { camera, focuser } = await connectedDevices()
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(vCurve(focuser, 50000, 25))
		const request = autoFocusStartRequest({ id: 'autofocus-owns', initialOffsetSteps: 2, stepSize: 25 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))
			expect(await waitForAutoFocusState('capturing', request.id)).toBeTrue()

			// The run owns both devices for its whole search, so neither an unrelated capture nor an unrelated
			// focuser move can slip between two samples of the curve.
			const intruder = cameraHandler.capture(operationCoordinator, camera, structuredClone(DEFAULT_CAMERA_CAPTURE_START))
			const started = await intruder.started

			expect(started.ok).toBeFalse()
			expect(started.ok || started.reason).toBe('busy')

			const focuserIntruder = operationCoordinator.start('focuserMove', [{ key: resourceKey(focuser), device: focuser }], () => ({ ok: true, value: undefined }))

			expect((await focuserIntruder.result).ok).toBeFalse()

			await noContent(await endpoints['/autofocus/:id/stop'].POST(stopRequest(request.id)))
			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
		} finally {
			detect.mockRestore()
		}
	}, 30000)

	test('stops an active run through the endpoint and reports it once', async () => {
		const { camera, focuser } = await connectedDevices()
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(vCurve(focuser, 50000, 25))
		const request = autoFocusStartRequest({ id: 'autofocus-stop', initialOffsetSteps: 2, stepSize: 25 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))
			expect(await waitForAutoFocusState('capturing', request.id)).toBeTrue()

			await noContent(await endpoints['/autofocus/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(autoFocusEvents().at(-1)?.message).toBe('stopped')
			expect(focuser.moving).toBeFalse()
		} finally {
			detect.mockRestore()
		}
	}, 30000)

	test('ignores a duplicate run for the same request id', async () => {
		const { camera, focuser } = await connectedDevices()
		// The first run stays in flight until this settles, so the duplicate meets a live run.
		const inFlight = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: inFlight.promise }))
		const request = autoFocusStartRequest({ id: 'autofocus-duplicate' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))
			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(capture).toHaveBeenCalledTimes(1)
		} finally {
			inFlight.resolve({ ok: true, value: { paths: [], frameCount: 0 } })
			await autoFocusHandler.stop(request.id)
			capture.mockRestore()
		}
	})

	test('stop is idempotent for an unknown run id', async () => {
		wsm.open(socket)

		await noContent(await endpoints['/autofocus/:id/stop'].POST(stopRequest('missing')))

		expect(autoFocusMessages()).toHaveLength(0)
	})

	test('reports devices already owned by another operation instead of failing silently', async () => {
		const { camera, focuser } = await connectedDevices()
		const manualRequest = { ...structuredClone(DEFAULT_CAMERA_CAPTURE_START), exposureMode: 'loop' as const, exposureTime: 200, exposureTimeUnit: 'millisecond' as const }
		const request = autoFocusStartRequest({ id: 'autofocus-busy' })

		wsm.open(socket)

		const manual = cameraHandler.capture(operationCoordinator, camera, manualRequest)

		expect((await manual.started).ok).toBeTrue()

		try {
			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().at(-1)?.message).toBe('the camera or the focuser is in use by another operation')

			// The refused run leaves the owner of the camera running.
			let manualSettled = false
			void manual.result.then(() => {
				manualSettled = true
			})
			await Bun.sleep(10)
			expect(manualSettled).toBeFalse()
		} finally {
			await manual.cancel()
		}
	})

	test('names each device that cannot be used apart from one someone else is using', async () => {
		const { camera, focuser } = await connectedDevices()
		const request = autoFocusStartRequest({ id: 'autofocus-unavailable' })

		wsm.open(socket)

		// Nobody owns these devices here; they are not in a state to be acquired, which the coordinator
		// reports under the same busy reason as an active owner.
		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })
		resourceArbiter.markUnavailable({ key: resourceKey(focuser), device: focuser })

		try {
			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().at(-1)?.message).toBe('the camera and the focuser are not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
			resourceArbiter.markAvailable({ key: resourceKey(focuser), device: focuser })
		}
	})

	test('ends the run with the cause when the capture never produces a frame', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = autoFocusStartRequest({ id: 'autofocus-noframe' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().at(-1)?.message).toBe('the capture produced no frame')
		} finally {
			capture.mockRestore()
		}
	})

	test('ends the run when the captured frame shows no stars', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve({ ok: true, value: { paths: ['focus.fit'], frameCount: 1 } }) }))
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))
		const request = autoFocusStartRequest({ id: 'autofocus-nostars' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(detect).toHaveBeenCalledWith({ ...request.starDetection, path: 'focus.fit' }, AbortSignal.timeout(5000))
			expect(autoFocusEvents().map((event) => event.state)).toEqual(['capturing', 'computing', 'idle'])
			expect(autoFocusEvents().at(-1)?.message).toBe('no stars detected')
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	})

	test('measures the HFD and waits for the focuser to reach the commanded position', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve({ ok: true, value: { paths: ['focus.fit'], frameCount: 1 } }) }))
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([star(4), star(2), star(6)]))
		const request = autoFocusStartRequest({ id: 'autofocus-moving', initialOffsetSteps: 2, stepSize: 25 })
		const target = focuser.position.value + 50

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('moving', request.id)).toBeTrue()

			const moving = autoFocusEvents().find((event) => event.state === 'moving')

			expect(moving?.starCount).toBe(3)
			expect(moving?.hfd).toBe(4)
			expect(moving?.message).toBe(`moving to position ${target}`)

			// The next sample is only commanded once the focuser has stopped at the previous one, so the
			// second move is the proof that the run waited for the first instead of stacking positions.
			expect(await waitUntil(() => autoFocusEvents().some((event) => event.message === `moving to position ${target - request.stepSize}`), 5000)).toBeTrue()
			expect(focuser.position.value).toBeGreaterThanOrEqual(target - request.stepSize)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	}, 10000)

	test('fails the run when the capture reports a terminal failure', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve({ ok: false, reason: 'timeout', error: 'capture cleanup failed' }) }))
		const request = autoFocusStartRequest({ id: 'autofocus-release' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id)).toBeTrue()
			expect(autoFocusEvents().at(-1)?.message).toBe('capture cleanup failed')
		} finally {
			capture.mockRestore()
		}
	})

	test('follows the curve to best focus and leaves the focuser there', async () => {
		const { camera, focuser } = await connectedDevices()
		const best = focuser.position.value
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve({ ok: true, value: { paths: ['focus.fit'], frameCount: 1 } }) }))
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(vCurve(focuser, best, 25))
		const request = autoFocusStartRequest({ id: 'autofocus-best', initialOffsetSteps: 3, stepSize: 25, fittingMode: 'TRENDLINES' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/autofocus/:camera/:focuser/start'].POST(startRequest(camera, focuser, request)))

			expect(await waitForAutoFocusState('idle', request.id, 25000)).toBeTrue()
			expect(autoFocusEvents().at(-1)?.message).toBe('best focus!')
			expect(autoFocusEvents().at(-1)?.focusPoint?.x).toBeCloseTo(best, 0)
			expect(focuser.moving).toBeFalse()
			expect(focuser.position.value).toBe(best)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	}, 30000)
})
