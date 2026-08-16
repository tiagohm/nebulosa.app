import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { sep } from 'path'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { flatWizardBus, flatWizard as flatWizardEndpoints, FlatWizardHandler } from 'src/api/flatwizard'
import { ImageProcessor } from 'src/api/image.processor'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import { DEFAULT_FLAT_WIZARD_START } from '#/flatwizard'
import type { FlatWizardEvent, FlatWizardStart } from '#/flatwizard'
import { successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import { captureHandle, json, noContent, SocketMessager, waitUntil } from './util'

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
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, new NotificationHandler(wsm), cameraCapturer, new CameraCommander(cameraManager), operationCoordinator)
const flatWizardHandler = new FlatWizardHandler(wsm, cameraHandler, imageProcessor, operationCoordinator)
const endpoints = flatWizardEndpoints(flatWizardHandler)
const handler = new IndiClientHandlerSet([cameraManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager })
Bun.env.capturesDir = await mkdtemp(tmpdir() + sep)

const socket = new SocketMessager()

afterAll(async () => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
	await rm(Bun.env.capturesDir, { recursive: true, force: true })
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	cameraManager.disconnect(getCamera())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
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

function startRun(request: Bun.BunRequest) {
	return endpoints['/flatwizard/:camera/start'].POST(request).then((response) => json<string>(response))
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

function waitForFlatWizardState(state: FlatWizardEvent['state'], id: string, timeout = 10000) {
	return waitUntil(() => flatWizardEvents().some((event) => event.id === id && event.state === state), timeout)
}

describe('flat wizard handler', () => {
	test('normalizes the capture into a single flat exposure without rewriting the caller request', async () => {
		const camera = connectCamera()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = flatWizardStartRequest({
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

			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('capturing', id)
			expect(capture).toHaveBeenCalledTimes(1)
			expect(capture.mock.calls[0][1]).toBe(camera)

			const normalized = capture.mock.calls[0][2]

			expect(normalized.delay).toBe(0)
			expect(normalized.count).toBe(1)
			expect(normalized.autoSave).toBeFalse()
			expect(normalized.savePath).toBeUndefined()
			expect(normalized.exposureTime).toBe(200)
			expect(normalized.exposureTimeUnit).toBe('millisecond')
			expect(normalized.frameType).toBe('FLAT')
			expect(normalized.exposureMode).toBe('single')

			// The caller's own request is left as it was handed in.
			expect(request.capture.count).toBe(10)
			expect(request.capture.frameType).toBe('DARK')

			expect(flatWizardEvents()[0]).toEqual({ id: id, camera: camera.id, state: 'capturing', median: 0, message: 'exposure of 200 ms' })
		} finally {
			capture.mockRestore()
		}
	})

	test('captures inside its own operation, holding the camera across the search', async () => {
		const camera = connectCamera()
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300, meanTarget: 0, meanTolerance: 0 })

		await waitUntil(() => camera.connected)
		resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
		wsm.open(socket)

		const id = await startRun(startRequest(camera, request))
		await waitForFlatWizardState('capturing', id)

		// The run owns the camera for its whole search, so an unrelated capture is refused rather than
		// slipping between two exposures of the bisection.
		const intruder = cameraHandler.capture(operationCoordinator, camera, structuredClone(DEFAULT_CAMERA_CAPTURE_START))
		const started = await intruder.started

		expect(started.ok).toBeFalse()
		expect(started.ok || started.reason).toBe('busy')

		await noContent(await endpoints['/flatwizard/:id/stop'].POST(stopRequest(id)))
		await waitForFlatWizardState('idle', id)
	}, 20000)

	test('stops an active run through the endpoint and reports it once', async () => {
		const camera = connectCamera()
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300, meanTarget: 0, meanTolerance: 0 })

		await waitUntil(() => camera.connected)
		resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
		wsm.open(socket)

		const id = await startRun(startRequest(camera, request))
		await waitForFlatWizardState('capturing', id)

		await noContent(await endpoints['/flatwizard/:id/stop'].POST(stopRequest(id)))

		await waitForFlatWizardState('idle', id)
		expect(flatWizardEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
		expect(flatWizardEvents().at(-1)?.message).toBe('stopped')
	}, 20000)

	test('refuses a second run over the same camera without disturbing the live one', async () => {
		const camera = connectCamera()
		// The first run stays in flight until this settles, so the second one meets a live run.
		const inFlight = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: inFlight.promise }))
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300 })
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, request))
			const refused = await startRun(startRequest(camera, request))

			expect(refused).not.toBe(id)
			expect(capture).toHaveBeenCalledTimes(1)

			await waitForFlatWizardState('idle', refused)
			expect(flatWizardEvents().some((event) => event.id === id && event.state === 'idle')).toBeFalse()
		} finally {
			inFlight.resolve(successfulOperationResult({ paths: [], frameCount: 0 }))
			await flatWizardHandler.stop(id)
			capture.mockRestore()
		}
	})

	test('stop is idempotent for an unknown run id', async () => {
		wsm.open(socket)

		await noContent(await endpoints['/flatwizard/:id/stop'].POST(stopRequest('missing')))

		expect(flatWizardMessages()).toHaveLength(0)
	})

	test('reports a camera already owned by another operation instead of failing silently', async () => {
		const camera = connectCamera()
		const manualRequest = { ...structuredClone(DEFAULT_CAMERA_CAPTURE_START), exposureMode: 'loop' as const, exposureTime: 200, exposureTimeUnit: 'millisecond' as const }
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300 })

		wsm.open(socket)
		await waitUntil(() => camera.connected)
		resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })

		const manual = cameraHandler.capture(operationCoordinator, camera, manualRequest)

		expect((await manual.started).ok).toBeTrue()

		try {
			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('idle', id)
			expect(flatWizardEvents().at(-1)?.message).toBe('the camera is in use by another operation')

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

	test('tells a camera that cannot be used apart from one someone else is using', async () => {
		const camera = connectCamera()
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300 })

		wsm.open(socket)
		await waitUntil(() => camera.connected)

		// Nobody owns the camera here; it is the device itself that is not in a state to be acquired, which
		// the coordinator reports under the same busy reason as an active owner.
		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })

		try {
			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('idle', id)
			expect(flatWizardEvents().at(-1)?.message).toBe('the camera is not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
		}
	})

	test('ends the run with the cause when the capture never produces a frame', async () => {
		const camera = connectCamera()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('idle', id)
			expect(flatWizardEvents().at(-1)?.message).toBe('the capture produced no frame')
		} finally {
			capture.mockRestore()
		}
	})

	test('ends the run when the captured frame cannot be loaded', async () => {
		const camera = connectCamera()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve(successfulOperationResult({ paths: ['flat.fit'], frameCount: 1 })) }))
		const transform = spyOn(imageProcessor, 'transform').mockImplementation(() => Promise.resolve(undefined))
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('idle', id)
			expect(transform).toHaveBeenCalledWith('flat.fit', false, camera.name)
			expect(flatWizardEvents().map((event) => event.state)).toEqual(['capturing', 'computing', 'idle'])
			expect(flatWizardEvents().at(-1)?.message).toBe('failed to load captured flat frame')
		} finally {
			transform.mockRestore()
			capture.mockRestore()
		}
	})

	test('gives up once the exposure interval is finer than a millisecond', async () => {
		const camera = connectCamera()
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 101, meanTarget: 0, meanTolerance: 0 })

		await waitUntil(() => camera.connected)
		resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
		wsm.open(socket)

		const id = await startRun(startRequest(camera, request))

		await waitForFlatWizardState('idle', id)
		expect(flatWizardEvents().at(-1)?.message).toBe('unable to find an optimal exposure time')
	}, 20000)

	test('exports the captured frame when its median lands inside the window', async () => {
		const camera = connectCamera()
		const request = flatWizardStartRequest({ minExposure: 100, maxExposure: 300, meanTarget: 32768, meanTolerance: 100 })

		await waitUntil(() => camera.connected)
		resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
		wsm.open(socket)

		const exported = spyOn(imageProcessor, 'export')

		try {
			const id = await startRun(startRequest(camera, request))

			await waitForFlatWizardState('idle', id)
			expect(flatWizardEvents().at(-1)?.message).toStartWith('saved at ')
			expect(exported).toHaveBeenCalledTimes(1)

			// The frame that was captured is the source of the export; the timestamped path is the destination.
			const [source, , , saveAt] = exported.mock.calls[0]

			expect(source).not.toBe(saveAt)
			expect(saveAt).toStartWith(Bun.env.capturesDir)
		} finally {
			exported.mockRestore()
		}
	}, 20000)
})
