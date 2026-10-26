import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import { DEFAULT_GUIDING_CALIBRATOR_CONFIG, type GuidingCalibrationDiagnostics } from 'nebulosa/src/observation/guiding/calibrator'
import type { StarTracker } from 'nebulosa/src/observation/guiding/tracker.star'
import { type CaptureFrameEvent, CaptureFrameRegistry } from './captureframes'
import { ConnectionManager } from './connection'
import { ExternalToolsStore } from './externaltools'
import { calibrationProgressOf, GUIDING_REGION_RADIUS, GUIDING_REGION_STARS, type GuidingEventRecord, type GuidingPage, type GuidingServerEvent, GuidingSessions, type GuidingSessionSummary, type GuidingStartRequest, guidingRegions } from './guiding'
import { ImageStore } from './images'
import { type OperationEvent, OperationRegistry } from './operations'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-guiding-test-'))
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

let tokens = 0

const SETTLE = { pixels: 1.5, time: 1, timeout: 10 }

// The simulator connection with its camera and mount connected, and the guiding sessions over it, guiding through the
// mount's ST4 port.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const images = new ImageStore()
	const frameEvents: CaptureFrameEvent[] = []
	const frames = new CaptureFrameRegistry(images, (event) => frameEvents.push(event), { file: join(mkdtempSync(join(root, 'frames-')), 'capture-frames.json') })
	disposables.push(frames)
	const commander = new GuideOutputCommander(manager.devices.guideOutputs, operations.arbiter)
	disposables.push(commander)
	const events: GuidingServerEvent[] = []
	const guiding = new GuidingSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		commander,
		images,
		frames,
		// A settings file of its own, where ASTAP is not configured.
		new ExternalToolsStore(join(mkdtempSync(join(root, 'tools-')), 'tools.json')),
		(event) => events.push(event),
	)
	disposables.push(guiding)

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const mountId = devices.find((device) => device.type === 'mount')!.id
	manager.devices.switch(client, cameraId, true)
	manager.devices.switch(client, mountId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const mount = manager.devices.device(client, 'mount', mountId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && mount.connected && mount.canPulseGuide && operations.available(camera) && operations.available(mount))
	await waitUntil(() => manager.devices.list(client).some((device) => device.type === 'guideOutput' && device.name === mount.name))
	const guideOutputId = manager.devices.list(client).find((device) => device.type === 'guideOutput' && device.name === mount.name)!.id

	// Latest published record of the session.
	const summary = (): GuidingSessionSummary | undefined => events.findLast((event) => event.type === 'guiding:updated')?.session
	// Running operation records of a kind.
	const running = (kind: string) => {
		const states = new Map<string, OperationEvent['operation']>()
		for (const { operation } of operationEvents) if (operation.kind === kind) states.set(operation.operationId, operation)
		return [...states.values()].filter((operation) => operation.state === 'running')
	}

	return { manager, client, id, operations, operationEvents, images, frames, frameEvents, guiding, events, camera, cameraId, mount, mountId, guideOutputId, summary, running }
}

type Setup = Awaited<ReturnType<typeof setup>>

// A request looping on small, short subframes and guiding through the mount.
function request({ id, guideOutputId }: Setup, patch: Partial<GuidingStartRequest> = {}): GuidingStartRequest {
	return {
		token: `token-${tokens++}`,
		guideOutput: { connectionId: id, deviceId: guideOutputId },
		exposure: 200,
		camera: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 256, height: 256, frameFormat: '' },
		trackingMode: 'singleStar',
		...patch,
	}
}

// Starts a session and waits until it loops; returns its ids.
async function start(context: Setup, patch: Partial<GuidingStartRequest> = {}) {
	const response = await context.guiding.start(context.id, context.cameraId, request(context, patch))
	expect(response.status).toBe(202)
	const accepted = (await response.json()) as { sessionId: string; operationId: string }
	await waitUntil(() => context.summary()?.active === true)
	return accepted
}

describe('calibration progress', () => {
	test('the RA return keeps the distance it ended at while the DEC legs report the current one', () => {
		const base = { startX: 100, startY: 100, raSteps: 6, decSteps: 0, clearingSteps: 3, decReturnSteps: 0, raNetDistancePx: 12, decNetDistancePx: 0, decMotionDetected: false, backlash: 0, badFrames: 0 }
		const progress = (diagnostics: object) => calibrationProgressOf(diagnostics as GuidingCalibrationDiagnostics, DEFAULT_GUIDING_CALIBRATOR_CONFIG)

		// While clearing, the distance is the current one.
		expect(progress({ ...base, phase: 'raClearMeasure', clearingDistancePx: 6.5 })).toMatchObject({ clearingDistance: 6.5, decReturnDistance: 6.5 })
		// Once the DEC leg began 3 px from the start, the RA return keeps that distance as the star moves north and back.
		const dec = { ...base, decStartX: 103, decStartY: 100, decSteps: 4, decNetDistancePx: 10 }
		expect(progress({ ...dec, phase: 'decForwardMeasure', clearingDistancePx: 10.4 })).toMatchObject({ clearingDistance: 3, decReturnDistance: 10.4 })
		expect(progress({ ...dec, phase: 'decReturnMeasure', decReturnSteps: 2, clearingDistancePx: 4.2 })).toMatchObject({ clearingDistance: 3, decReturnSteps: 2, decReturnDistance: 4.2 })
	})
})

describe('start', () => {
	test('refuses an unknown camera or guide output and a busy camera', async () => {
		const context = await setup()
		expect((await context.guiding.start(context.id, 'nope', request(context))).status).toBe(404)
		expect((await context.guiding.start(context.id, context.cameraId, request(context, { guideOutput: { connectionId: context.id, deviceId: 'nope' } }))).status).toBe(404)

		await start(context)
		expect((await context.guiding.start(context.id, context.cameraId, request(context))).status).toBe(409)
	})

	test('refuses ASTAP while it is not configured', async () => {
		const context = await setup()
		const response = await context.guiding.start(context.id, context.cameraId, request(context, { detection: { provider: 'astap', maxStars: 0, minSNR: 10 } }))
		expect(response.status).toBe(422)
		expect(context.operations.available(context.camera)).toBeTrue()
	})

	test('detects the stars with the built-in settings of the request', async () => {
		const context = await setup()
		const { sessionId } = await start(context, { detection: { provider: 'builtin', maxStars: 3, minSNR: 0, searchRegion: 0 } })
		await waitUntil(() => context.events.some((event) => event.type === 'guiding:frame'))
		const frame = context.events.find((event): event is Extract<GuidingServerEvent, { type: 'guiding:frame' }> => event.type === 'guiding:frame')!
		expect(frame.overlay.stars.length).toBeLessThanOrEqual(3)
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
	})

	test('passes the client settings, follows the exposure countdown, and profiles the measured guide star', async () => {
		const context = await setup()
		const { sessionId } = await start(context, { exposure: 1000, client: { searchRegion: 40, ditherMode: 'spiral', stickyLockPosition: true, fastRecenter: false, reverseDecOutputAfterMeridianFlip: true } })
		await waitUntil(() => context.events.some((event) => event.type === 'guiding:frame'))
		const frame = context.events.find((event): event is Extract<GuidingServerEvent, { type: 'guiding:frame' }> => event.type === 'guiding:frame')!
		expect(frame.overlay.searchRegion).toBe(40)
		// Every star carries its size, which the viewer draws its marker from at high zoom.
		expect(frame.overlay.stars.length).toBeGreaterThan(0)
		for (const star of frame.overlay.stars) expect(star.hfd).toBeGreaterThan(0)

		const progress = context.events.flatMap((event) => (event.type === 'guiding:updated' && event.session.exposureProgress ? [event.session.exposureProgress] : []))
		expect(progress.length).toBeGreaterThan(0)
		for (const { elapsedTime, remainingTime, progress: percent } of progress) {
			expect(elapsedTime + remainingTime).toBe(1e6)
			expect(percent).toBeGreaterThanOrEqual(0)
			expect(percent).toBeLessThanOrEqual(100)
		}

		const target = (await context.guiding.selectTarget(sessionId, {}).json()) as { lockPosition: [number, number] }
		await waitUntil(() => context.summary()?.star !== undefined)
		const star = context.summary()!.star!
		expect(Math.hypot(star.x - target.lockPosition[0], star.y - target.lockPosition[1])).toBeLessThan(3)
		expect(star.horizontal.values.length).toBeGreaterThan(0)
		expect(star.vertical.values.length).toBeGreaterThan(0)

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(context.summary()?.exposureProgress).toBeUndefined()
	}, 60000)

	test('loops under one camera.guiding operation, snoops the devices of the request, and previews the frames as guiding frames of the camera', async () => {
		const context = await setup()
		const body = request(context, { snoop: { mount: context.mountId } })
		const first = (await (await context.guiding.start(context.id, context.cameraId, body)).json()) as { sessionId: string; operationId: string }
		// A repeated token answers its first session.
		expect(await (await context.guiding.start(context.id, context.cameraId, body)).json()).toEqual(first)

		await waitUntil(() => context.events.some((event) => event.type === 'guiding:frame'))
		const frame = context.events.find((event) => event.type === 'guiding:frame')!
		expect(frame).toMatchObject({ sessionId: first.sessionId, overlay: { state: 'looping' } })
		expect(context.frameEvents.some((event) => event.type === 'captureFrame:updated' && event.frame.origin === 'guiding' && event.frame.sessionId === first.sessionId)).toBeTrue()
		expect(context.summary()).toMatchObject({ sessionId: first.sessionId, operationId: first.operationId, active: true, state: 'looping', guideOutputHeld: false, exposure: 200 })
		expect(context.running('camera.guiding').map((operation) => operation.operationId)).toEqual([first.operationId])
		expect(context.operations.available(context.camera)).toBeFalse()
		expect(context.operations.available(context.mount)).toBeTrue()
		// The mount is snooped, so a simulated camera renders the sky it points at.
		expect(context.manager.devices.cameras.properties.get(context.camera)?.ACTIVE_DEVICES?.elements.ACTIVE_TELESCOPE.value).toBe(context.mount.name)

		expect((await context.guiding.stop(first.sessionId)).status).toBe(204)
		expect(context.summary()).toMatchObject({ active: false, lost: false })
		expect(context.summary()?.endedAt).toBeDefined()
		await waitUntil(() => context.running('camera.guiding').length === 0)
		expect(context.operations.available(context.camera)).toBeTrue()
		expect((await context.guiding.stop(first.sessionId)).status).toBe(404)
	})
})

describe('guiding', () => {
	test('guiding holds the mount in a guideOutput.guiding operation; stopping guiding frees it and keeps looping', async () => {
		const context = await setup()
		const { sessionId } = await start(context)

		expect(await context.guiding.selectTarget(sessionId, { position: [128, 128] }).json()).toEqual({ lockPosition: [128, 128] })

		const body = { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }
		const accepted = await context.guiding.startGuiding(sessionId, body).json()
		expect(await context.guiding.startGuiding(sessionId, body).json()).toEqual(accepted)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect(context.running('guideOutput.guiding')).toHaveLength(1)
		// While it calibrates, the record follows the legs with the limits of the calibration settings.
		const progress = () => context.events.findLast((event) => event.type === 'guiding:updated' && event.session.calibrating !== undefined)
		await waitUntil(() => progress() !== undefined)
		expect(progress()).toMatchObject({ session: { calibrating: { maxRaSteps: 20, raTarget: 12, decTarget: 10, clearingTarget: 4, decReturn: true, maxBadFrames: 3 } } })
		expect(context.summary()?.runOperationId).toBe(context.running('guideOutput.guiding')[0].operationId)
		expect(context.operations.available(context.mount)).toBeFalse()
		// The target is in use while guiding.
		expect(context.guiding.clearTarget(sessionId).status).toBe(422)

		const stopped = await context.guiding.stopGuiding(sessionId, { token: `token-${tokens++}` }).json()
		await waitUntil(() => context.summary()?.command?.commandId === stopped.commandId && context.summary()?.command?.state !== 'running')
		expect(context.summary()).toMatchObject({ command: { command: 'stopGuiding', state: 'succeeded' }, guideOutputHeld: false, active: true })
		// The progress belongs to the calibration that ran, and goes with it.
		expect(context.summary()?.calibrating).toBeUndefined()
		await waitUntil(() => context.running('guideOutput.guiding').length === 0)
		expect(context.operations.available(context.mount)).toBeTrue()
		expect(context.guiding.clearTarget(sessionId).status).toBe(204)

		// The control events are kept in order, and the page says when the requested position is still covered.
		const page = (await context.guiding.events(sessionId, 0).json()) as GuidingPage<GuidingEventRecord>
		expect(page.truncated).toBeFalse()
		expect(page.items.map((record) => record.sequence)).toEqual(page.items.map((_, index) => index + 1))
		expect(page.items.map((record) => record.event.type)).toContain('calibrationStarted')

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(context.operations.available(context.mount)).toBeTrue()
		expect(context.operations.available(context.camera)).toBeTrue()
	}, 60000)

	test('commands of an ended or unknown session are refused', async () => {
		const context = await setup()
		const { sessionId } = await start(context)
		expect((await context.guiding.stop(sessionId)).status).toBe(204)

		expect(context.guiding.startGuiding(sessionId, { token: 'x', recalibrate: false, settle: SETTLE }).status).toBe(404)
		expect(context.guiding.setExposure(sessionId, { exposure: 1000 }).status).toBe(404)
		expect(context.guiding.session('unknown').status).toBe(404)
		expect(context.guiding.session(sessionId).status).toBe(200)
	})

	test('losing the mount while guiding ends the session as lost and finishes its operations', async () => {
		const context = await setup()
		const { sessionId, operationId } = await start(context)
		await context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).json()
		await waitUntil(() => context.summary()?.guideOutputHeld === true)

		context.manager.devices.switch(context.client, context.mountId, false)
		await waitUntil(() => context.summary()?.endedAt !== undefined)
		expect(context.summary()).toMatchObject({ active: false, lost: true, failure: { reason: 'disconnected' } })
		await waitUntil(() => context.running('camera.guiding').length === 0 && context.running('guideOutput.guiding').length === 0)
		const finished = context.operationEvents.findLast((event) => event.operation.operationId === operationId)!.operation
		expect(finished).toMatchObject({ state: 'failed', reason: 'disconnected' })
		await waitUntil(() => context.operations.available(context.camera))
	}, 60000)
})

describe('detection regions', () => {
	// A tracker whose previous frame measured the star at (200, 150) among accepted stars of increasing SNR.
	function tracker(measured: boolean) {
		const accepted = Array.from({ length: 30 }, (_, index) => ({ x: 10 * index, y: 20 * index, snr: index, flux: 1, hfd: 2 }))
		return {
			lastResult: { candidateCount: 30, acceptedCount: 30, qualityScore: 1, rejectedReasons: {}, notes: [], detections: accepted, accepted, primaryInsideSearchRegion: true, matches: 30, ...(measured && { measurement: { x: 200, y: 150, confidence: 1 } }) },
			config: { filter: { minStarSnr: 5 } },
		} as unknown as StarTracker
	}

	const held = { guideOutputHeld: true, lockPosition: [201, 151] } as unknown as GuidingSessionSummary

	test('are the measured star, the lock, and the brightest accepted stars while the guide output is held', () => {
		const regions = guidingRegions({ builtin: true, tracker: tracker(true), summary: held })!
		expect(regions.radius).toBe(GUIDING_REGION_RADIUS)
		// Only detections the tracker could accept by SNR are kept.
		expect(regions.minSNR).toBe(5)
		expect(regions.centers).toHaveLength(2 + GUIDING_REGION_STARS)
		expect(regions.centers.slice(0, 2)).toEqual([
			[200, 150],
			[201, 151],
		])
		// The accepted stars of highest SNR come first.
		expect(regions.centers[2]).toEqual([290, 580])
	})

	test('cover the whole frame while looping, after a lost frame, or with ASTAP', () => {
		expect(guidingRegions({ builtin: true, tracker: tracker(true), summary: { ...held, guideOutputHeld: false } })).toBeUndefined()
		expect(guidingRegions({ builtin: true, tracker: tracker(false), summary: held })).toBeUndefined()
		expect(guidingRegions({ builtin: false, tracker: tracker(true), summary: held })).toBeUndefined()
	})
})
