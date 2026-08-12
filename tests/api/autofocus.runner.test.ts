import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { sep } from 'path'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import { CameraManager, FocuserManager, MountManager, RotatorManager, WheelManager } from 'nebulosa/src/devices/indi/manager'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import type { DetectedStar } from 'nebulosa/src/imaging/stars/detector'
import { AutoFocusRunner } from 'src/api/autofocus.runner'
import { cameraBus, CameraHandler } from 'src/api/camera'
import { CameraCapturer } from 'src/api/camera.capture'
import { CameraCommander } from 'src/api/camera.commander'
import { FocuserHandler } from 'src/api/focuser'
import { FocuserCommander } from 'src/api/focuser.commander'
import { ImageProcessor } from 'src/api/image.processor'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { StarDetectionHandler } from 'src/api/stardetection'
import { DEFAULT_AUTO_FOCUS_START } from '#/autofocus'
import type { AutoFocusEvent } from '#/autofocus'
import { successfulOperationResult } from '#/orchestration'
import { captureHandle, waitUntil } from './util'

cameraBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const imageProcessor = new ImageProcessor()
const cameraManager = new CameraManager()
const mountManager = new MountManager()
const wheelManager = new WheelManager()
const focuserManager = new FocuserManager()
const rotatorManager = new RotatorManager()
const arbiter = new ResourceArbiter()
const coordinator = new OperationCoordinator(arbiter)
const cameraCapturer = new CameraCapturer(cameraManager, imageProcessor, arbiter)
const cameraHandler = new CameraHandler(wsm, cameraManager, mountManager, wheelManager, focuserManager, rotatorManager, new NotificationHandler(wsm), cameraCapturer, new CameraCommander(cameraManager), coordinator)
const focuserHandler = new FocuserHandler(wsm, focuserManager, new NotificationHandler(wsm), new FocuserCommander(focuserManager), coordinator)
const starDetectionHandler = new StarDetectionHandler(imageProcessor)
const handlerSet = new IndiClientHandlerSet([cameraManager, focuserManager])
const client = new ClientSimulator('Client Simulator', handlerSet)
const simulators = [new CameraSimulator('Camera Simulator', client, { mountManager, focuserManager, rotatorManager, wheelManager }), new FocuserSimulator('Focuser Simulator', client)] as const
Bun.env.capturesDir = await mkdtemp(tmpdir() + sep)

const events: AutoFocusEvent[] = []
const runner = new AutoFocusRunner(cameraHandler, focuserHandler, starDetectionHandler, (event) => events.push(structuredClone(event)))
const silentRunner = new AutoFocusRunner(cameraHandler, focuserHandler, starDetectionHandler)

afterAll(async () => {
	for (const simulator of simulators) simulator.dispose()
	await rm(Bun.env.capturesDir, { recursive: true, force: true })
})

beforeEach(() => {
	events.length = 0
	cameraManager.disconnect(getCamera())
	focuserManager.disconnect(getFocuser())
})

afterEach(async () => {
	await coordinator.cancelAll('aborted')
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

async function connectedDevices() {
	const camera = getCamera()
	const focuser = getFocuser()

	cameraManager.connect(camera)
	focuserManager.connect(focuser)

	await waitUntil(() => camera.connected && focuser.connected)
	arbiter.markAvailable({ key: resourceKey(camera), device: camera })
	arbiter.markAvailable({ key: resourceKey(focuser), device: focuser })

	return { camera, focuser }
}

function request(overrides: Partial<(typeof DEFAULT_AUTO_FOCUS_START)['capture']> = {}) {
	const start = structuredClone(DEFAULT_AUTO_FOCUS_START)
	Object.assign(start.capture, overrides)
	start.capture.exposureTime = 100
	start.capture.exposureTimeUnit = 'millisecond'
	start.initialOffsetSteps = 3
	start.stepSize = 25
	start.fittingMode = 'TRENDLINES'
	return start
}

function star(hfd: number): DetectedStar {
	return { x: 1, y: 2, hfd, snr: 10, flux: 100 }
}

function vCurve(focuser: Focuser, best: number, stepSize: number) {
	return () => Promise.resolve([star(Math.abs(focuser.position.value - best) / stepSize + 1)])
}

function frame() {
	return captureHandle({ result: Promise.resolve(successfulOperationResult({ paths: ['focus.fit'], frameCount: 1 })) })
}

describe('auto focus runner', () => {
	test('reports the fitted curve as a domain outcome instead of a rendered message', async () => {
		const { camera, focuser } = await connectedDevices()
		const best = focuser.position.value
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(vCurve(focuser, best, 25))

		try {
			const { handle } = runner.start(coordinator, camera, focuser, request())
			const result = await handle.result

			expect(result.ok).toBeTrue()
			if (!result.ok) return

			expect(result.value.outcome).toBe('focused')
			expect(result.value.message).toBe('best focus!')
			expect(result.value.position).toBe(best)
			expect(result.value.focusPoint?.x).toBeCloseTo(best, 0)
			expect(focuser.position.value).toBe(best)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	}, 30000)

	test('ends successfully with the no stars outcome when a frame carries no measurement', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))

		try {
			const { handle } = runner.start(coordinator, camera, focuser, request())
			const result = await handle.result

			expect(result.ok).toBeTrue()
			if (!result.ok) return

			expect(result.value.outcome).toBe('noStars')
			expect(result.value.message).toBe('no stars detected')
			expect(result.value.focusPoint).toBeUndefined()
			expect(result.value.position).toBe(focuser.position.value)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	})

	test('leaves the caller request untouched and normalizes only its own copy', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => captureHandle())
		const start = request({ count: 10, delay: 5, frameType: 'DARK', autoSave: true, savePath: '/tmp/not-used.fit' })

		try {
			const { handle } = runner.start(coordinator, camera, focuser, start)

			await handle.result

			expect(capture).toHaveBeenCalledTimes(1)

			const normalized = capture.mock.calls[0][2]

			expect(normalized.count).toBe(1)
			expect(normalized.delay).toBe(0)
			expect(normalized.frameType).toBe('LIGHT')
			expect(normalized.exposureMode).toBe('single')
			expect(normalized.autoSave).toBeFalse()
			expect(normalized.savePath).toBeUndefined()
			expect(normalized.focuser).toBe(focuser.name)

			expect(start.capture.count).toBe(10)
			expect(start.capture.frameType).toBe('DARK')
			expect(start.capture.savePath).toBe('/tmp/not-used.fit')
		} finally {
			capture.mockRestore()
		}
	})

	test('runs inside a reservation holding both devices, which refuses a run started outside it', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))
		const reserved = arbiter.reserve({ id: 'session-1', kind: 'sequencer' }, [{ key: resourceKey(camera) }, { key: resourceKey(focuser) }])

		expect(reserved.ok).toBeTrue()
		if (!reserved.ok) return

		try {
			const outside = await runner.start(coordinator, camera, focuser, request()).handle.result

			expect(outside.ok).toBeFalse()
			expect(outside.ok || outside.reason).toBe('busy')

			const inside = await runner.start(coordinator.reservedScope(reserved.reservation), camera, focuser, request()).handle.result

			expect(inside.ok).toBeTrue()
			expect(inside.ok && inside.value.outcome).toBe('noStars')
		} finally {
			reserved.reservation.release()
			detect.mockRestore()
			capture.mockRestore()
		}
	})

	test('publishes the terminal event only when the caller renders one', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))

		try {
			const { handle, finish } = runner.start(coordinator, camera, focuser, request())

			await handle.result

			expect(events.map((event) => event.state)).toEqual(['capturing', 'computing'])

			finish(handle.id, 'stopped')

			expect(events.at(-1)?.state).toBe('idle')
			expect(events.at(-1)?.message).toBe('stopped')
			expect(events.at(-1)?.id).toBe(handle.id)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	})

	test('writes every sampled frame where the caller reserved it, one destination per sample', async () => {
		const { camera, focuser } = await connectedDevices()
		const requested: (string | undefined)[] = []
		const directories: (string | undefined)[] = []
		const capture = spyOn(cameraHandler, 'capture').mockImplementation((_scope, _camera, start) => {
			requested.push(start.outputName)
			directories.push(start.outputPath)
			return frame()
		})
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(vCurve(focuser, focuser.position.value, 25))
		let ordinal = 0

		try {
			const { handle } = runner.start(coordinator, camera, focuser, request(), () => ({ directory: '/data/.auxiliary/autofocus', fileName: `autofocus-${++ordinal}.fits` }))

			await handle.result

			expect(requested.length).toBeGreaterThan(1)
			expect(new Set(requested).size).toBe(requested.length)
			expect(requested[0]).toBe('autofocus-1.fits')
			expect(new Set(directories)).toEqual(new Set(['/data/.auxiliary/autofocus']))
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	}, 30000)

	test('refuses to expose a frame the caller could not reserve a destination for', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())

		try {
			const { handle } = runner.start(coordinator, camera, focuser, request(), () => undefined)
			const result = await handle.result

			expect(result.ok).toBeFalse()
			expect(result.ok || result.reason).toBe('unexpectedState')
			expect(capture).not.toHaveBeenCalled()
		} finally {
			capture.mockRestore()
		}
	})

	test('searches without an event sink at all', async () => {
		const { camera, focuser } = await connectedDevices()
		const capture = spyOn(cameraHandler, 'capture').mockImplementation(() => frame())
		const detect = spyOn(starDetectionHandler, 'detect').mockImplementation(() => Promise.resolve([]))

		try {
			const { handle, finish } = silentRunner.start(coordinator, camera, focuser, request())
			const result = await handle.result

			finish(handle.id, 'stopped')

			expect(result.ok && result.value.outcome).toBe('noStars')
			expect(events).toHaveLength(0)
		} finally {
			detect.mockRestore()
			capture.mockRestore()
		}
	})
})
