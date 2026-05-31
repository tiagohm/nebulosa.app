import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/indi.manager'
import { CameraSimulator, ClientSimulator, MountSimulator } from 'nebulosa/src/indi.simulator'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import { CacheManager } from 'src/api/cache'
import { CameraHandler } from 'src/api/camera'
import { ConfirmationHandler } from 'src/api/confirmation'
import { ImageProcessor } from 'src/api/image'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { NotificationHandler } from 'src/api/notification'
import { PlateSolverHandler } from 'src/api/platesolver'
import { tppa as tppaEndpoints, TppaHandler } from 'src/api/tppa'
import { DEFAULT_CAMERA_CAPTURE_EVENT, DEFAULT_TPPA_START, type CameraCaptureEvent, type TppaEvent, type TppaStart } from 'src/shared/types'
import { noContent, SocketMessager, waitUntil } from './util'

type TppaStartOverrides = Omit<Partial<TppaStart>, 'capture' | 'solver' | 'refraction'> & {
	readonly capture?: Partial<TppaStart['capture']>
	readonly solver?: Partial<TppaStart['solver']>
	readonly refraction?: Partial<TppaStart['refraction']>
}

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const cameraHandler = new CameraHandler(wsm, imageProcessor, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager)
const mountHandler = new MountHandler(wsm, mountManager, new ConfirmationHandler(wsm), new CacheManager())
const solver = new PlateSolverHandler(new NotificationHandler(wsm), imageProcessor)
const tppaHandler = new TppaHandler(wsm, cameraHandler, mountHandler, solver)
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

afterEach(() => {
	tppaHandler.stop('tppa-start')
	tppaHandler.stop('tppa-stop')
	tppaHandler.stop('tppa-duplicate')
	tppaHandler.stop('tppa-stopped')
	tppaHandler.stop('tppa-error')
	tppaHandler.stop('tppa-solving')
	tppaHandler.stop('tppa-moving')
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
	return socket.filter<TppaEvent>((message) => message.type === 'tppa')
}

function tppaEvents() {
	return tppaMessages().map((message) => message.body)
}

function waitForTppaState(state: TppaEvent['state'], id: string) {
	return waitUntil(() => tppaEvents().some((event) => event.id === id && event.state === state))
}

function cameraCaptureEvent(overrides: Partial<CameraCaptureEvent>) {
	return Object.assign(structuredClone(DEFAULT_CAMERA_CAPTURE_EVENT), overrides)
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

describe('tppa handler', () => {
	test('starts through endpoint and emits capturing event through wsm', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const tracking = spyOn(mountManager, 'tracking')
		const request = tppaStartRequest({
			id: 'tppa-start',
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
			},
		})

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('capturing', request.id)).toBeTrue()
			expect(start).toHaveBeenCalledTimes(1)
			expect(start.mock.calls[0][0]).toBe(camera)
			expect(start.mock.calls[0][1]).toBe(request.capture)
			expect(tracking).toHaveBeenCalledWith(mount, true)
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
			tracking.mockRestore()
			start.mockRestore()
		}
	})

	test('stops active task through endpoint and emits idle event', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const cameraStop = spyOn(cameraHandler, 'stop')
		const mountStop = spyOn(mountManager, 'stop')
		const solverStop = spyOn(solver, 'stop')
		const request = tppaStartRequest({ id: 'tppa-stop' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('capturing', request.id)).toBeTrue()

			await noContent(endpoints['/tppa/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(cameraStop).toHaveBeenCalledWith(camera)
			expect(mountStop).toHaveBeenCalledWith(mount)
			expect(solverStop).toHaveBeenCalledWith(request.id)
		} finally {
			solverStop.mockRestore()
			mountStop.mockRestore()
			cameraStop.mockRestore()
			start.mockRestore()
		}
	})

	test('ignores duplicate active task for same id, camera, or mount', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation(() => Promise.resolve(true))
		const request = tppaStartRequest({ id: 'tppa-duplicate' })
		const duplicate = tppaStartRequest({ id: 'tppa-other' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))
			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, duplicate)))

			expect(start).toHaveBeenCalledTimes(1)

			await noContent(endpoints['/tppa/:id/stop'].POST(stopRequest(request.id)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().filter((event) => event.id === duplicate.id)).toHaveLength(0)
		} finally {
			start.mockRestore()
		}
	})

	test('stop endpoint is idempotent for unknown task id', async () => {
		wsm.open(socket)

		await noContent(endpoints['/tppa/:id/stop'].POST(stopRequest('missing')))

		expect(tppaMessages()).toHaveLength(0)
	})

	test('emits idle event when camera capture stops', async () => {
		const { camera, mount } = connectDevices()
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'idle', stopped: true }))
			return Promise.resolve(true)
		})
		const request = tppaStartRequest({ id: 'tppa-stopped' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
		} finally {
			start.mockRestore()
		}
	})

	test('emits idle error event when camera capture fails', async () => {
		const { camera, mount } = connectDevices()
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			handleCameraCaptureEvent?.(cameraCaptureEvent({ camera: camera.id, state: 'error' }))
			return Promise.resolve(true)
		})
		const request = tppaStartRequest({ id: 'tppa-error' })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(tppaEvents().at(-1)?.message).toBe('tppa failed')
			expect(error).toHaveBeenCalled()
		} finally {
			start.mockRestore()
			error.mockRestore()
		}
	})

	test('emits solving failure after max attempts', async () => {
		const { camera, mount } = connectDevices()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return Promise.resolve(true)
		})
		const solve = spyOn(solver, 'start').mockImplementation(() => Promise.resolve(undefined))
		const request = tppaStartRequest({ id: 'tppa-solving', maxAttempts: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(captureEvent).toBeDefined()
			captureEvent!(cameraCaptureEvent({ camera: camera.id, state: 'idle' }), 'plate.fit')

			expect(await waitForTppaState('idle', request.id)).toBeTrue()
			expect(solve).toHaveBeenCalledWith({ ...request.solver, ...mount.equatorialCoordinate, radius: 8, path: 'plate.fit', id: request.id, blind: false })
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'solving', 'idle'])
			expect(tppaEvents().at(-1)?.attempts).toBe(1)
			expect(tppaEvents().at(-1)?.solved).toBeFalse()
			expect(tppaEvents().at(-1)?.message).toBe('solving failed')
		} finally {
			solve.mockRestore()
			start.mockRestore()
		}
	})

	test('solves first frame and starts mount movement', async () => {
		const { camera, mount } = connectDevices()
		let captureEvent: ((event: CameraCaptureEvent, path?: string) => void) | undefined
		const start = spyOn(cameraHandler, 'start').mockImplementation((_, __, handleCameraCaptureEvent) => {
			captureEvent = handleCameraCaptureEvent
			return Promise.resolve(true)
		})
		const solve = spyOn(solver, 'start').mockImplementation(() => Promise.resolve(plateSolution({ rightAscension: 0.3, declination: 0.4 })))
		const moveWest = spyOn(mountManager, 'moveWest')
		const request = tppaStartRequest({ id: 'tppa-moving', direction: 'west', moveDuration: 1 })

		try {
			wsm.open(socket)

			await noContent(await endpoints['/tppa/:camera/:mount/start'].POST(startRequest(camera, mount, request)))

			expect(captureEvent).toBeDefined()
			captureEvent!(cameraCaptureEvent({ camera: camera.id, state: 'idle' }), 'plate.fit')

			expect(await waitForTppaState('moving', request.id)).toBeTrue()

			const events = tppaEvents()

			expect(events.map((event) => event.state)).toEqual(['capturing', 'solving', 'aligning', 'moving'])
			expect(events.at(-1)?.step).toBe(1)
			expect(events.at(-1)?.solved).toBeTrue()
			expect(events.at(-1)?.solver).toEqual({ rightAscension: 0.3, declination: 0.4 })
			expect(moveWest).toHaveBeenCalledWith(mount, true)
		} finally {
			moveWest.mockRestore()
			solve.mockRestore()
			start.mockRestore()
		}
	})
})
