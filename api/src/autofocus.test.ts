import { afterAll, afterEach, describe, expect, spyOn, test } from 'bun:test'
import { mkdtempSync, readdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { failedOperationResult, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { AutoFocusFittingMode } from 'nebulosa/src/observation/focus/autofocus'
import { type AutoFocusEvent, type AutoFocusRequest, type AutoFocusSession, AutoFocusSessions, type AutoFocusSessionSummary } from './autofocus'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures, type CaptureRequest } from './captures'
import { ConnectionManager } from './connection'
import { ExternalToolsStore } from './externaltools'
import { FocuserBacklashStore } from './focuserbacklash'
import { FocuserCommands } from './focusers'
import { ImageStore } from './images'
import { type OperationEvent, OperationRegistry } from './operations'
import { PlateSolvingService } from './platesolving'
import { DEFAULT_BUILTIN_SETTINGS, DEFAULT_STAR_ACCEPTANCE, StarDetectionService } from './stars'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-autofocus-test-'))
const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

async function waitUntil(condition: () => boolean, timeout = 30000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(10)
	}
}

// Best focus of the simulated optics, in steps; the simulator defocuses relative to ±50000 steps, so the sampled
// steps are large.
const BEST_FOCUS = 50000

// Start position of every session, in steps.
const START = BEST_FOCUS + 1500

let tokens = 0

// An Auto Focus request around the start position, measuring the brightest stars of short subframes, with fields
// replaced.
function request(focuser: { connectionId: string; deviceId: string }, patch: Partial<AutoFocusRequest> = {}): AutoFocusRequest {
	return {
		token: `token-${tokens++}`,
		focuser,
		capture: { exposureTime: 0.2, gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 512, height: 512, frameFormat: '' },
		detection: { detector: { ...DEFAULT_BUILTIN_SETTINGS, maxStars: 20, maximumRadius: 32 }, acceptance: DEFAULT_STAR_ACCEPTANCE },
		fittingMode: 'HYPERBOLIC',
		initialOffsetSteps: 4,
		stepSize: 3000,
		reversed: false,
		rmsdThreshold: 0,
		settleDelay: 0,
		measureTimeout: 30,
		...patch,
	}
}

// A request whose exposures last long enough to act during one.
function slow(focuser: { connectionId: string; deviceId: string }) {
	const body = request(focuser)
	return { ...body, capture: { ...body.capture, exposureTime: 3 } }
}

// A small preview-only capture request.
function captureRequest(patch: Partial<CaptureRequest> = {}): CaptureRequest {
	return { exposureMode: 'single', count: 1, delay: 0, exposureTime: 0.05, frameType: 'LIGHT', gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 32, height: 32, frameFormat: '', output: { mode: 'preview-only', format: 'FITS' }, ...patch }
}

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const images = new ImageStore()
	const tools = new ExternalToolsStore(join(mkdtempSync(join(root, 'settings-')), 'settings.json'))
	const stars = new StarDetectionService(images, tools, () => {})
	const capturesDir = mkdtempSync(join(root, 'captures-'))
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		stars,
		new PlateSolvingService(images, tools, () => {}),
		new CaptureFrameRegistry(images, () => {}, { file: join(mkdtempSync(join(root, 'frames-')), 'capture-frames.json') }),
		() => {},
		capturesDir,
	)
	disposables.push(captures)
	const focusers = new FocuserCommands(manager.devices, (connectionId) => manager.client(connectionId), operations, new FocuserBacklashStore(join(mkdtempSync(join(root, 'focusers-')), 'focusers.json')))
	disposables.push(focusers)
	const events: AutoFocusEvent[] = []
	const auxiliaryDir = mkdtempSync(join(root, 'auxiliary-'))
	const autoFocus = new AutoFocusSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		captures.capturer,
		focusers.mover,
		images,
		stars,
		(event) => events.push(event),
		auxiliaryDir,
	)

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const focuserId = devices.find((device) => device.type === 'focuser')!.id
	manager.devices.switch(client, cameraId, true)
	manager.devices.switch(client, focuserId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const focuser = manager.devices.device(client, 'focuser', focuserId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && focuser.connected && focuser.canAbsoluteMove && operations.available(camera) && operations.available(focuser))

	expect(await focusers.mover.moveTo(operations.coordinator, focuser, START)).toEqual({ ok: true, value: undefined })

	// Latest published summary.
	const summary = () => events.at(-1)?.session
	const ended = () => summary()?.endedAt !== undefined
	// Complete record of a session.
	const session = async (sessionId: string) => (await autoFocus.session(sessionId).json()) as AutoFocusSession
	// Whether the camera and the focuser are free for a new operation.
	const released = () => operations.available(camera) && operations.available(focuser)

	return { manager, client, id, operations, operationEvents, images, captures, capturesDir, autoFocus, auxiliaryDir, events, camera, cameraId, focuser, focuserDevice: { connectionId: id, deviceId: focuserId }, summary, ended, session, released }
}

// Starts a session and returns its ids.
async function start(autoFocus: AutoFocusSessions, connectionId: string, cameraId: string, body: AutoFocusRequest) {
	const response = await autoFocus.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string }
}

describe('fitting modes', () => {
	const series: Record<AutoFocusFittingMode, readonly string[]> = {
		HYPERBOLIC: ['hyperbolic'],
		PARABOLIC: ['parabolic'],
		TRENDLINES: ['trendLeft', 'trendRight'],
		TREND_HYPERBOLIC: ['trendLeft', 'trendRight', 'hyperbolic'],
		TREND_PARABOLIC: ['trendLeft', 'trendRight', 'parabolic'],
	}

	test.each(Object.keys(series) as AutoFocusFittingMode[])(
		'%s finds the best focus of the simulated optics, verifies it there, and saves nothing',
		async (fittingMode) => {
			const { id, cameraId, autoFocus, focuserDevice, focuser, ended, summary, session, operationEvents, capturesDir, auxiliaryDir, images, released } = await setup()
			const { sessionId, operationId } = await start(autoFocus, id, cameraId, request(focuserDevice, { fittingMode }))
			await waitUntil(ended, 120000)

			const final = summary()!
			expect(final).toMatchObject({ sessionId, operationId, state: 'completed', initialPosition: START, verification: 'measured', provider: 'builtin' })
			// Within one and a half steps: the trend lines intersect less precisely than the curves place their vertex.
			expect(Math.abs(final.estimatedPosition! - BEST_FOCUS)).toBeLessThanOrEqual(4500)
			expect(final.finalPosition).toBe(final.estimatedPosition)
			expect(focuser.position.value).toBe(final.finalPosition!)
			expect(final.verifiedHfd).toBeGreaterThan(0)

			const record = await session(sessionId)
			expect(record.measurements).toHaveLength(final.measurementCount)
			expect(record.measurements.map((measurement) => measurement.capture)).toEqual(record.measurements.map((_, i) => i + 1))
			expect(record.measurements.every((measurement) => measurement.observedPosition === measurement.requestedPosition && measurement.hfd! > 0)).toBeTrue()
			expect(record.curve!.fittingMode).toBe(fittingMode)
			expect(record.curve!.series.map((curve) => curve.kind as string)).toEqual([...series[fittingMode]])

			// Only the latest frame (the verification) stays open; earlier ones were closed.
			expect(images.name(final.verificationImageId!)).toBeDefined()
			expect(final.latestFrame).toMatchObject({ imageId: final.verificationImageId, capture: final.measurementCount + 1, width: 512, height: 512 })
			expect(images.name(record.measurements[0].imageId!)).toBeUndefined()

			expect(operationEvents.findLast((event) => event.operation.operationId === operationId)!.operation).toMatchObject({ kind: 'focuser.autofocus', state: 'succeeded', devices: [{ connectionId: id, deviceId: cameraId }, focuserDevice] })
			expect(readdirSync(capturesDir)).toEqual([])
			expect(readdirSync(auxiliaryDir)).toEqual([])
			expect(released()).toBeTrue()
		},
		180000,
	)
})

describe('sessions', () => {
	test('a curve the runner rejects fails, keeps its measurements, places no best focus, and restores the start', async () => {
		const { id, cameraId, autoFocus, focuserDevice, focuser, ended, summary, session, released } = await setup()
		// No fitted curve is that close to its samples, so every curve is rejected.
		const { sessionId } = await start(autoFocus, id, cameraId, request(focuserDevice, { rmsdThreshold: 1e-12 }))
		await waitUntil(ended, 120000)

		expect(summary()).toMatchObject({ state: 'failed', reason: 'commandFailed', verification: 'skipped' })
		expect(summary()!.estimatedPosition).toBeUndefined()
		expect(summary()!.finalPosition).toBeUndefined()
		expect((await session(sessionId)).measurements.length).toBeGreaterThan(0)
		expect(focuser.position.value).toBe(START)
		expect(released()).toBeTrue()
	}, 180000)

	test('every frame snoops the focuser of the session with the mount, filter wheel and rotator of the request', async () => {
		const { manager, client, id, cameraId, autoFocus, camera, focuser, focuserDevice, summary, ended } = await setup()
		const snoop = spyOn(manager.devices.cameras, 'snoop')
		const devices = manager.devices.list(client)
		const device = (type: string) => devices.find((device) => device.type === type)!
		const { sessionId } = await start(autoFocus, id, cameraId, request(focuserDevice, { snoop: { mount: device('mount').id, wheel: device('wheel').id, rotator: device('rotator').id } }))
		await waitUntil(() => summary()?.state === 'measuring')
		await autoFocus.stop(sessionId)
		await waitUntil(ended)

		const [mount, wheel, rotator] = (['mount', 'wheel', 'rotator'] as const).map((type) => manager.devices.get(client, device(type).id))
		expect(snoop).toHaveBeenCalledWith(camera, mount, focuser, wheel, rotator)
		snoop.mockRestore()
	}, 60000)

	test('a stop during an exposure cancels the session where it stands and releases both devices', async () => {
		const { id, cameraId, autoFocus, focuserDevice, focuser, ended, summary, events, released } = await setup()
		const { sessionId } = await start(autoFocus, id, cameraId, slow(focuserDevice))
		await waitUntil(() => summary()?.state === 'exposing')
		const position = focuser.position.value

		expect((await autoFocus.stop(sessionId)).status).toBe(204)
		await waitUntil(ended)

		expect(events.some((event) => event.session.state === 'stopping')).toBeTrue()
		expect(summary()).toMatchObject({ state: 'cancelled', verification: 'skipped' })
		expect(focuser.position.value).toBe(position)
		expect(released()).toBeTrue()
		expect((await autoFocus.stop(sessionId)).status).toBe(404)
	}, 60000)

	test('a stop of the focuser from Equipment Control cancels the session holding it', async () => {
		const { id, cameraId, autoFocus, focuserDevice, focuser, operations, ended, summary, released } = await setup()
		await start(autoFocus, id, cameraId, slow(focuserDevice))
		await waitUntil(() => summary()?.state === 'exposing')

		await operations.coordinator.cancelByDevice(resourceKey(focuser))
		await waitUntil(ended)

		expect(summary()!.state).toBe('cancelled')
		expect(released()).toBeTrue()
	}, 60000)

	test('a camera capture cannot start while a session holds the camera, and a session cannot start on a capturing camera', async () => {
		const { id, cameraId, autoFocus, captures, focuserDevice, ended, summary } = await setup()
		const { sessionId } = await start(autoFocus, id, cameraId, slow(focuserDevice))
		await waitUntil(() => summary()?.state === 'exposing')

		expect((await captures.start(id, cameraId, captureRequest())).status).toBe(409)

		await autoFocus.stop(sessionId)
		await waitUntil(ended)

		expect((await captures.start(id, cameraId, captureRequest({ exposureMode: 'loop', exposureTime: 0.5 }))).status).toBe(202)
		const busy = await autoFocus.start(id, cameraId, request(focuserDevice))
		expect(busy.status).toBe(409)
		expect(await busy.json()).toMatchObject({ code: 'busy' })
		await captures.abort(id, cameraId)
	}, 60000)

	test('a session cannot start on a focuser another operation holds', async () => {
		const { id, cameraId, autoFocus, focuserDevice, focuser, operations, events } = await setup()
		const hold = operations.coordinator.start(
			'hold',
			[{ key: resourceKey(focuser), device: focuser }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		expect((await autoFocus.start(id, cameraId, request(focuserDevice))).status).toBe(409)
		expect(events).toEqual([])
		await hold.cancel()
	}, 60000)

	test('a repeated token answers the session it started instead of starting another', async () => {
		const { id, cameraId, autoFocus, focuserDevice, ended, summary } = await setup()
		const body = slow(focuserDevice)
		const first = await start(autoFocus, id, cameraId, body)
		const second = await start(autoFocus, id, cameraId, body)

		expect(second).toEqual(first)
		expect(autoFocus.snapshot().sessions).toHaveLength(1)
		await autoFocus.stop(first.sessionId)
		await waitUntil(ended)
		expect(summary()!.state).toBe('cancelled')
	}, 60000)

	test('ASTAP without its executable configured is refused before anything starts', async () => {
		const { id, cameraId, autoFocus, focuserDevice, events } = await setup()
		const response = await autoFocus.start(id, cameraId, request(focuserDevice, { detection: { detector: { provider: 'astap', maxStars: 0, minSNR: 10 }, acceptance: DEFAULT_STAR_ACCEPTANCE } }))

		expect(response.status).toBe(422)
		expect(events).toEqual([])
	}, 60000)

	test('the snapshot lists the latest session of the camera without its measurements, and an unknown session is 404', async () => {
		const { id, cameraId, autoFocus, focuserDevice, ended } = await setup()
		const { sessionId } = await start(autoFocus, id, cameraId, slow(focuserDevice))

		const listed: readonly AutoFocusSessionSummary[] = autoFocus.snapshot().sessions
		expect(listed.map((session) => session.sessionId)).toEqual([sessionId])
		expect('measurements' in listed[0]).toBeFalse()
		expect(autoFocus.session('unknown').status).toBe(404)

		await autoFocus.stop(sessionId)
		await waitUntil(ended)
	}, 60000)
})
