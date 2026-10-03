import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import { plateSolutionFrom } from 'nebulosa/src/astrometry/solvers/platesolver'
import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import * as clock from 'nebulosa/src/astronomy/time/time'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { CameraManager } from 'nebulosa/src/devices/indi/manager/camera'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { WheelManager } from 'nebulosa/src/devices/indi/manager/wheel'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { vecRotateByRodrigues } from 'nebulosa/src/math/linear-algebra/vec3'
import { arcmin, deg, toDeg } from 'nebulosa/src/math/units/angle'
import { mountAdjustmentAxes } from 'nebulosa/src/observation/alignment/polaralignment'
import { applyInverseMountAdjustment, celestialPoleVector } from 'nebulosa/src/observation/alignment/polaralignment.util'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import type { CameraCaptureResult } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { ConfirmationHandler } from 'src/api/confirmation'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { ImageProcessor } from 'src/api/image.processor'
import { WebSocketMessageHandler } from 'src/api/message'
import { MountHandler } from 'src/api/mount'
import { MountCommander } from 'src/api/mount.commander'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { PlateSolverHandler } from 'src/api/platesolver'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { tppaBus, tppa as tppaEndpoints, TppaHandler } from 'src/api/tppa'
import type { CameraFrameEvent } from '#/camera'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import { DEFAULT_TPPA_START } from '#/tppa'
import type { TppaStart, TppaEvent } from '#/tppa'
import { cameraFrameEvent, captureHandle, json, noContent, SocketMessager, waitUntil } from './util'

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
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, new NotificationHandler(wsm), cameraCapturer, new CameraCommander(cameraManager), operationCoordinator)
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

	await waitUntil(() => camera.connected && mount.connected)
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

function startRun(request: Bun.BunRequest) {
	return endpoints['/tppa/:camera/:mount/start'].POST(request).then((response) => json<string>(response))
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

function solvedFrame(path = 'plate.fit', frame?: Partial<CameraFrameEvent>, camera?: Camera): Promise<OperationResult<CameraCaptureResult>> {
	return Promise.resolve(successfulOperationResult({ frames: [cameraFrameEvent(path, frame, camera)], frameCount: 1 }))
}

describe('tppa handler', () => {
	for (const compensateRefraction of [false, true]) {
		test(`publishes exposure-bound overlays with persistent reference and refraction=${compensateRefraction}`, async () => {
			const { camera, mount } = await connectedDevices()
			const location = geodeticLocation(deg(-45), deg(35))
			Object.assign(mount.geographicCoordinate, location)
			const time = clock.timeYMDHMS(2026, 7, 12, 2, 0, 0)
			time.location = location
			const now = spyOn(clock, 'timeNow').mockReturnValue(time)
			const request = tppaStartRequest({ compensateRefraction, moveDuration: 1, delayBeforeCapture: 0, maxAttempts: 1 })
			const axes = mountAdjustmentAxes(time, location)
			const pole = applyInverseMountAdjustment(celestialPoleVector(time, location, compensateRefraction && request.refraction), axes.upAxis, axes.eastAxis, arcmin(6), arcmin(-4))
			const reference = eraS2c(deg(120), deg(30))
			let count = 0
			const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => {
				count++
				imageProcessor.save(Buffer.alloc(0), 'plate.fit', camera)
				return captureHandle({ result: solvedFrame(undefined, { operation: `capture-operation-${count}`, session: `capture-${count}` }, camera) })
			})
			const solve = spyOn(solver, 'start').mockImplementation(() => {
				if (count > 5) return Promise.resolve(undefined)
				// Fixed clock isolates image geometry: the first three fields trace a small circle around
				// a known displaced pole, then only CRPIX changes to exercise persistent celestial reference.
				const vector = vecRotateByRodrigues(reference, pole, Math.min(count - 1, 2) * 0.15)
				const [rightAscension, declination] = eraC2s(...vector)
				if (count === 5) return Promise.resolve(plateSolution({ rightAscension, declination }))
				return Promise.resolve(plateSolutionFrom({ NAXIS: 2, NAXIS1: 800, NAXIS2: 600, CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: count === 4 ? 425.5 : 400.5, CRPIX2: 300.5, CRVAL1: toDeg(rightAscension), CRVAL2: toDeg(declination), CD1_1: -0.001, CD1_2: 0, CD2_1: 0, CD2_2: 0.001 }))
			})

			try {
				wsm.open(socket)
				const id = await startRun(startRequest(camera, mount, request))
				await waitForTppaState('idle', id, 15000)
				const events = tppaEvents().filter((event) => event.id === id)
				const aligned = events.filter((event) => event.state === 'aligning')
				expect(aligned).toHaveLength(5)
				expect(aligned[0].overlay).toBeUndefined()
				expect(aligned[1].overlay).toBeUndefined()
				const third = aligned[2].overlay!
				const fourth = aligned[3].overlay!
				expect(third.frame).toEqual({ camera: camera.id, operation: 'capture-operation-3', session: 'capture-3', generation: 1, path: 'plate.fit' })
				expect(fourth.frame.session).toBe('capture-4')
				expect(third.result.success).toBeTrue()
				expect(fourth.result.success).toBeTrue()
				if (third.result.success && fourth.result.success) {
					expect(third.result.overlay.frame).toEqual({ x: 0.5, y: 0.5, width: 800, height: 600 })
					expect(third.result.overlay.currentPoint.position.x).toBeCloseTo(400.5, 7)
					expect(fourth.result.overlay.reference).toEqual(third.result.overlay.reference)
					expect(fourth.result.overlay.currentPoint.position.x).toBeCloseTo(425.5, 7)
					expect(third.result.overlay.correction.azimuth).toBeCloseTo(arcmin(6), 7)
					expect(third.result.overlay.correction.altitude).toBeCloseTo(arcmin(-4), 7)
				}
				expect(aligned[4].overlay?.result).toEqual({ success: false, reason: 'invalidWcs', warnings: [] })
				expect(events.some((event) => event.state === 'waiting')).toBeFalse()
				expect(events.at(-1)?.overlay).toBeUndefined()
				expect(events.at(-1)?.message).toBe('solving failed')
			} finally {
				solve.mockRestore()
				capture.mockRestore()
				now.mockRestore()
			}
		}, 20000)
	}

	test('normalizes the capture into a full frame light exposure and enables tracking', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest({
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
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('capturing', id)
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
					id: id,
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
			pending.resolve(successfulOperationResult({ frames: [], frameCount: 0 }))
			await tppaHandler.stop(id)
			capture.mockRestore()
		}
	})

	test('holds the camera and the mount for the whole session', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest()
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, mount, request))
			await waitForTppaState('capturing', id)

			const cameraIntruder = operationCoordinator.start('cameraCapture', [{ key: resourceKey(camera), device: camera }], () => successfulOperationResult(undefined))
			const mountIntruder = operationCoordinator.start('mountGoTo', [{ key: resourceKey(mount), device: mount }], () => successfulOperationResult(undefined))

			expect((await cameraIntruder.result).ok).toBeFalse()
			expect((await mountIntruder.result).ok).toBeFalse()
		} finally {
			pending.resolve(successfulOperationResult({ frames: [], frameCount: 0 }))
			await tppaHandler.stop(id)
			capture.mockRestore()
		}
	})

	test('stops an active session through the endpoint and reports it once', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest()

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('capturing', id)

			const stopping = endpoints['/tppa/:id/stop'].POST(stopRequest(id))

			pending.resolve(failedOperationResult('aborted'))

			await noContent(await stopping)

			await waitForTppaState('idle', id)
			expect(tppaEvents().map((event) => event.state)).toEqual(['capturing', 'idle'])
			expect(tppaEvents().filter((event) => event.state === 'idle')).toHaveLength(1)
			expect(tppaEvents().at(-1)?.message).toBe('stopped')
			expect(mount.slewing).toBeFalse()
		} finally {
			pending.resolve(failedOperationResult('aborted'))
			capture.mockRestore()
		}
	})

	test('refuses a second session over the same devices without disturbing the live one', async () => {
		const { camera, mount } = await connectedDevices()
		const pending = Promise.withResolvers<OperationResult<CameraCaptureResult>>()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: pending.promise }))
		const request = tppaStartRequest()
		let id = ''

		try {
			wsm.open(socket)

			id = await startRun(startRequest(camera, mount, request))
			await waitForTppaState('capturing', id)

			const refused = await startRun(startRequest(camera, mount, request))

			expect(refused).not.toBe(id)
			expect(capture).toHaveBeenCalledTimes(1)

			await waitForTppaState('idle', refused)
			expect(tppaEvents().some((event) => event.id === id && event.state === 'idle')).toBeFalse()
		} finally {
			pending.resolve(successfulOperationResult({ frames: [], frameCount: 0 }))
			await tppaHandler.stop(id)
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
		const request = tppaStartRequest()
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

			await waitForTppaState('idle', id)
			expect(tppaEvents().at(-1)?.message).toBe('the camera or the mount is in use by another operation')
		} finally {
			await owner.cancel()
		}
	})

	test('names each device that cannot be used apart from one someone else is using', async () => {
		const { camera, mount } = await connectedDevices()
		const request = tppaStartRequest()

		wsm.open(socket)

		resourceArbiter.markUnavailable({ key: resourceKey(camera), device: camera })
		resourceArbiter.markUnavailable({ key: resourceKey(mount), device: mount })

		try {
			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('idle', id)
			expect(tppaEvents().at(-1)?.message).toBe('the camera and the mount are not available')
		} finally {
			resourceArbiter.markAvailable({ key: resourceKey(camera), device: camera })
			resourceArbiter.markAvailable({ key: resourceKey(mount), device: mount })
		}
	})

	test('ends the session with the cause when the capture never produces a frame', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const request = tppaStartRequest()

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('idle', id)
			expect(tppaEvents().at(-1)?.message).toBe('the capture produced no frame')
		} finally {
			capture.mockRestore()
		}
	})

	test('fails the session when the capture reports a terminal failure', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: Promise.resolve(failedOperationResult('timeout', 'capture cleanup failed')) }))
		const request = tppaStartRequest()

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('idle', id)
			expect(tppaEvents().at(-1)?.message).toBe('capture cleanup failed')
		} finally {
			capture.mockRestore()
		}
	})

	test('gives up after the configured number of failed solves', async () => {
		const { camera, mount } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle({ result: solvedFrame() }))
		const solve = spyOn(solver, 'start').mockImplementation(() => Promise.resolve(undefined))
		const request = tppaStartRequest({ maxAttempts: 1 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('idle', id)
			expect(solve.mock.calls[0][0]).toEqual({ ...request.solver, ...mount.equatorialCoordinate, radius: 8, path: 'plate.fit', id: id, blind: false })
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
		const request = tppaStartRequest()

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('solving', id)

			await noContent(await endpoints['/tppa/:id/stop'].POST(stopRequest(id)))

			expect(solverAborted).toBeTrue()
			await waitForTppaState('idle', id)
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
		const request = tppaStartRequest({ direction: 'west', moveDuration: 1 })

		try {
			wsm.open(socket)

			const id = await startRun(startRequest(camera, mount, request))

			await waitForTppaState('moving', id, 5000)

			const events = tppaEvents()

			expect(events.map((event) => event.state)).toEqual(['capturing', 'solving', 'aligning', 'moving'])
			expect(events.at(-1)?.step).toBe(1)
			expect(events.at(-1)?.solved).toBeTrue()
			expect(events.at(-1)?.solver).toEqual({ rightAscension: 0.3, declination: 0.4 })
			expect(mountCommander.manualMoveOf(mount)?.directions()).toEqual(['WEST'])

			// The motion ends by itself once the configured duration is over, releasing the nested scope that
			// held the mount while the axis was moving.
			await waitForTppaState('settling', id, 5000)
			expect(mountCommander.manualMoveOf(mount)).toBeUndefined()

			await noContent(await endpoints['/tppa/:id/stop'].POST(stopRequest(id)))

			await waitForTppaState('idle', id)
			expect(tppaEvents().at(-1)?.message).toBe('stopped')
		} finally {
			solve.mockRestore()
			capture.mockRestore()
		}
	}, 20000)
})
