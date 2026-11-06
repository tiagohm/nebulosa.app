import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { GuideOutputCommander } from 'nebulosa/src/devices/commanders/guideoutput'
import { type OperationContext, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import { deg, hour } from 'nebulosa/src/math/units/angle'
import { DEFAULT_GUIDING_CALIBRATOR_CONFIG, type GuidingCalibrationDiagnostics } from 'nebulosa/src/observation/guiding/calibrator'
import type { StarTracker } from 'nebulosa/src/observation/guiding/tracker.star'
import type { CalibrationMasterDetail, CalibrationMasterSummary } from './calibrationlibrary'
import { type CaptureFrameEvent, CaptureFrameRegistry } from './captureframes'
import { ConnectionManager } from './connection'
import { AppDatabase } from './database'
import { ExternalToolsStore } from './externaltools'
import { type GuidingDarkLibrary, calibrationProgressOf, GUIDING_REGION_RADIUS, GUIDING_REGION_STARS, type GuidingEventRecord, type GuidingPage, type GuidingServerEvent, GuidingSessions, type GuidingSessionSummary, type GuidingStartRequest, type GuidingTelemetrySample, guidingRegions } from './guiding'
import { GuidingCalibrationStore } from './guidingcalibration.store'
import { ImageStore } from './images'
import { type OperationEvent, OperationRegistry, type ToolInvocation } from './operations'

const SKIP = process.env.RUN_ALL_TESTS !== 'true'

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

// A Calibration Library without any master.
const NO_DARKS: GuidingDarkLibrary = { resolvePreview: () => Promise.resolve({ candidates: [] }), pinnedMaster: () => Promise.resolve(undefined), lease: () => () => {} }

// The simulator connection with its camera and mount connected, and the guiding sessions over it, guiding through the
// mount's ST4 port. calibrations keeps the solved calibrations, a database of its own when absent.
async function setup(calibrations = new GuidingCalibrationStore(AppDatabase.memory()), library: GuidingDarkLibrary = NO_DARKS) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operationEvents: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => operationEvents.push(event))
	disposables.push(operations)
	const images = new ImageStore()
	const frameEvents: CaptureFrameEvent[] = []
	const frames = new CaptureFrameRegistry(images, (event) => frameEvents.push(event), { database: AppDatabase.memory() })
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
		new ExternalToolsStore(AppDatabase.memory()),
		calibrations,
		library,
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

// A request guiding through the mount, whose camera renders the whole field of stars at the mount's pointing, calibrating
// in a few long steps without the returns.
function guided(context: Setup, patch: Partial<GuidingStartRequest> = {}): Partial<GuidingStartRequest> {
	return {
		mount: { connectionId: context.id, deviceId: context.mountId },
		snoop: { mount: context.mountId },
		camera: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '' },
		calibration: { clearingMoveEnabled: false, decReturnEnabled: false, settleFramesAfterMove: 1, raPulse: 2000, decPulse: 2000, minMovePerStepPx: 0.5, minNetRaTravelPx: 5, minNetDecTravelPx: 5 },
		...patch,
	}
}

// Points the mount at RA 6h, declination +20° (it starts at the pole, where an RA pulse moves nothing), a field of stars
// that does not depend on the time of day, and has it track at a
// guide rate of 1× sidereal, so a 2 s pulse moves the catalog stars the camera renders through its 50 mm lens by more
// than a pixel, and turns off the sky noise of the camera, so the detections are the stars.
async function trackStars(context: Setup) {
	const { mounts } = context.manager.devices
	mounts.syncTo(context.mount, hour(6), deg(20))
	await waitUntil(() => Math.abs(context.mount.equatorialCoordinate.declination - deg(20)) < deg(0.1))
	mounts.tracking(context.mount, true)
	context.client.sendNumber({ device: context.mount.name, name: 'GUIDE_RATE', elements: { GUIDE_RATE_WE: 1, GUIDE_RATE_NS: 1 } })
	context.client.sendSwitch({ device: context.camera.name, name: 'SIMULATOR_NOISE_FEATURES', elements: { SKY_ENABLED: false, LIGHT_POLLUTION_ENABLED: false, MOON_ENABLED: false, AMP_GLOW_ENABLED: false } })
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
	})

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
	})

	test('a hold keeps guiding through its guide output from starting, and the run holding it is seen by that guide output', async () => {
		const context = await setup()
		const { sessionId } = await start(context)
		const guideOutput = { connectionId: context.id, deviceId: context.guideOutputId }
		const another = { connectionId: context.id, deviceId: 'another' }
		expect(context.guiding.selectTarget(sessionId, { position: [128, 128] }).status).toBe(200)
		expect(context.guiding.runsOn(guideOutput)).toBeEmpty()

		// A hold of another guide output of the same connection keeps nothing from guiding through this one.
		const unrelated = context.guiding.hold(another, 'Target Centering')
		const hold = context.guiding.hold(guideOutput, 'Target Centering')
		const other = context.guiding.hold(guideOutput, 'Camera Acquisition')
		const refused = context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE })
		expect(refused.status).toBe(409)
		expect((await refused.json()) as object).toEqual({ error: 'Target Centering is moving the mount', code: 'busy' })
		expect(context.summary()?.active).toBeTrue()

		// Each hold releases its own holder once, and guiding starts only when none is left.
		hold[Symbol.dispose]()
		hold[Symbol.dispose]()
		expect((await context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).json()) as object).toEqual({ error: 'Camera Acquisition is moving the mount', code: 'busy' })
		other[Symbol.dispose]()
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect(context.guiding.runsOn(guideOutput).map((run) => run.sessionId)).toEqual([sessionId])
		expect(context.guiding.runsOn(another)).toBeEmpty()
		unrelated[Symbol.dispose]()

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(context.guiding.runsOn(guideOutput)).toBeEmpty()
	})

	test('guiding through the ST4 port of the guide camera itself starts while that camera loops', async () => {
		const context = await setup()
		const { manager, client, id, camera, mount, operations } = context
		const ownId = manager.devices.list(client).find((device) => device.type === 'guideOutput' && device.hardwareId === camera.hardwareId)!.id
		const st4 = { connectionId: id, deviceId: ownId }
		const output = manager.devices.device(client, 'guideOutput', ownId)!
		await waitUntil(() => output.canPulseGuide && operations.available(output))
		const mountDevice = { connectionId: id, deviceId: context.mountId }
		const { sessionId } = await start(context, { guideOutput: st4, mount: mountDevice })
		expect(context.guiding.selectTarget(sessionId, { position: [128, 128] }).status).toBe(200)
		// The loop holds the sensor, and leaves its ST4 port to the run.
		expect(operations.available(camera)).toBeFalse()
		expect(operations.available(output)).toBeTrue()

		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect(context.running('guideOutput.guiding').map((operation) => operation.devices)).toEqual([[st4, mountDevice]])
		expect(context.summary()).toMatchObject({ active: true, guideOutput: st4 })
		expect(operations.available(output)).toBeFalse()
		expect(operations.available(mount)).toBeFalse()
		// The run holds the port while the root keeps the same camera exposing.
		await waitUntil(() => camera.exposuring)
		expect(operations.available(camera)).toBeFalse()

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		await waitUntil(() => operations.available(output) && operations.available(camera))
		expect(operations.available(mount)).toBeTrue()
	})

	test('a dither claim gives the dither commands of a session to its claimant only', async () => {
		const context = await setup()
		const { sessionId } = await start(context)
		const dither = { amount: { unit: 'guidePixel', value: 5 }, raOnly: false, settle: SETTLE } as const

		expect(context.guiding.claimDither('unknown', 'Camera Acquisition')).toMatchObject({ ok: false, status: 404, code: 'notFound' })
		expect(context.guiding.summaryOf(sessionId)?.sessionId).toBe(sessionId)
		expect(context.guiding.summaryOf('unknown')).toBeUndefined()

		const claim = context.guiding.claimDither(sessionId, 'Camera Acquisition')
		if (!claim.ok) throw new Error(claim.error)
		expect(context.guiding.claimDither(sessionId, 'Sequencer')).toMatchObject({ ok: false, status: 409, code: 'busy' })
		expect(context.guiding.admitDither(sessionId, { token: `token-${tokens++}`, ...dither })).toMatchObject({ ok: false, status: 409, code: 'busy', error: 'Camera Acquisition is dithering with this guiding session' })

		// The claimant's dither is admitted, and refused by the guider that is not guiding.
		const admitted = claim.admitDither({ token: `token-${tokens++}`, ...dither })
		if (!admitted.ok) throw new Error(admitted.error)
		expect(await admitted.settled).toMatchObject({ command: 'dither', state: 'failed' })

		claim[Symbol.dispose]()
		claim[Symbol.dispose]()
		const manual = context.guiding.admitDither(sessionId, { token: `token-${tokens++}`, ...dither })
		expect(manual.ok).toBeTrue()
		if (manual.ok) await manual.settled
		expect(context.guiding.claimDither(sessionId, 'Sequencer').ok).toBeTrue()

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(context.guiding.summaryOf(sessionId)).toBeUndefined()
	})

	test('a run suspended for a motion frees the mount and keeps looping, then starts again from a star of a new frame', async () => {
		const context = await setup()
		const { sessionId } = await start(context)
		expect(context.guiding.selectTarget(sessionId, { position: [128, 128] }).status).toBe(200)
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)

		const suspended = await context.guiding.suspendForMotion(sessionId)
		expect(suspended).toMatchObject({ ok: true, value: { sessionId, settle: SETTLE } })
		expect(context.summary()).toMatchObject({ guideOutputHeld: false, active: true })
		await waitUntil(() => context.operations.available(context.mount))
		if (!suspended.ok) return

		const controller = new AbortController()
		const frame = context.summary()?.frame?.frameId ?? 0
		const restored = context.guiding.restoreAfterMotion(suspended.value, controller.signal)
		// The old lock is dropped at once, and the next star comes from a frame taken after the motion.
		expect(context.summary()?.lockPosition).toBeUndefined()
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect((context.summary()?.frame?.frameId ?? 0) - frame).toBeGreaterThanOrEqual(2)
		expect(context.summary()?.lockPosition).toBeDefined()
		expect(context.summary()?.lockPosition).not.toEqual([128, 128])
		expect(context.summary()?.command).toMatchObject({ command: 'startGuiding' })

		// A stop during the restoration leaves it looping.
		controller.abort()
		expect(await restored).toBe('failed')
		expect(context.summary()).toMatchObject({ guideOutputHeld: false, active: true })
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
	})

	test('a session changed during the motion is left as it is', async () => {
		const context = await setup()
		const { sessionId } = await start(context)
		expect(context.guiding.selectTarget(sessionId, { position: [128, 128] }).status).toBe(200)
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)

		const suspended = await context.guiding.suspendForMotion(sessionId)
		if (!suspended.ok) throw new Error('not suspended')
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)

		expect(await context.guiding.restoreAfterMotion(suspended.value, new AbortController().signal)).toBe('externallyChanged')
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(await context.guiding.restoreAfterMotion(suspended.value, new AbortController().signal)).toBe('externallyChanged')
		expect(await context.guiding.suspendForMotion('unknown')).toMatchObject({ ok: false })
	})

	test.skipIf(SKIP)(
		'a completed calibration is saved, and a later session of the same equipment restores it instead of calibrating',
		async () => {
			const store = new GuidingCalibrationStore(AppDatabase.memory())
			const context = await setup(store)
			await trackStars(context)
			const types = (sessionId: string) => context.guiding.events(sessionId, 0).json() as Promise<GuidingPage<GuidingEventRecord>>

			const first = await start(context, guided(context))
			await waitUntil(() => context.guiding.selectTarget(first.sessionId, {}).status === 200)
			expect(context.guiding.startGuiding(first.sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
			await waitUntil(() => context.summary()?.calibration?.saved === true, 90000)
			const solved = context.summary()!.calibration!
			expect(solved).toMatchObject({ origin: 'new', saved: true, transformations: [], declinationScale: 1, orthogonalAssumed: false })
			expect(solved.source.pierSide).toBeDefined()
			expect(solved.source.declination).toBeDefined()
			expect(store.list(undefined, 10).map((header) => header.calibrationId)).toEqual([solved.storedId!])
			// The session serves its calibration with the measured steps.
			const served = (await context.guiding.sessionCalibration(first.sessionId).json()) as { record: { calibration: { review: { raSamples: unknown[] } } } }
			expect(served.record.calibration.review.raSamples.length).toBeGreaterThan(0)
			expect((await context.guiding.stop(first.sessionId)).status).toBe(204)

			// A new session of the same equipment guides with it without calibrating.
			const second = await start(context, guided(context))
			await waitUntil(() => context.summary()?.frame !== undefined)
			const candidates = (await context.guiding.calibrationCandidates(second.sessionId).json()) as { candidates: { calibrationId: string; status: string }[] }
			expect(candidates.candidates.map(({ calibrationId, status }) => [calibrationId, status])).toEqual([[solved.storedId!, 'direct']])
			await waitUntil(() => context.guiding.selectTarget(second.sessionId, {}).status === 200)
			expect(context.guiding.startGuiding(second.sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
			await waitUntil(() => context.summary()?.guideOutputHeld === true)
			expect(context.summary()?.calibration).toMatchObject({ origin: 'restored', storedId: solved.storedId, saved: true })
			const events = (await types(second.sessionId)).items.map((record) => record.event.type)
			expect(events).toContain('calibrationRestored')
			expect(events).not.toContain('calibrationStarted')
			expect(store.list(undefined, 10)[0].lastUsedAt).toBeDefined()
			expect((await context.guiding.stop(second.sessionId)).status).toBe(204)

			// Disabled, it is set aside, and other binning is other equipment geometry.
			expect(context.guiding.patchSavedCalibration(solved.storedId!, { disabled: true }).status).toBe(204)
			const third = await start(context, guided(context, { camera: { gain: 0, offset: 0, binX: 2, binY: 2, subframe: false, x: 0, y: 0, width: 0, height: 0, frameFormat: '' } }))
			await waitUntil(() => context.summary()?.frame !== undefined)
			expect(context.guiding.patchSavedCalibration(solved.storedId!, { disabled: false }).status).toBe(204)
			const other = (await context.guiding.calibrationCandidates(third.sessionId).json()) as { candidates: { status: string; reasons: string[] }[] }
			expect(other.candidates).toEqual([expect.objectContaining({ status: 'incompatible', reasons: expect.arrayContaining(['binning']) })])
			const refused = context.guiding.restoreSavedCalibration(third.sessionId, { calibrationId: solved.storedId! })
			expect(refused.status).toBe(422)
			expect(await refused.json()).toMatchObject({ code: 'calibrationIncompatible', reasons: expect.arrayContaining(['binning']) })
			expect(context.guiding.restoreSavedCalibration(third.sessionId, { calibrationId: 'unknown' }).status).toBe(404)
			expect((await context.guiding.stop(third.sessionId)).status).toBe(204)
		},
		90000,
	)

	test.skipIf(SKIP)(
		'Force Recalibrate calibrates even when a saved calibration matches',
		async () => {
			const context = await setup()
			await trackStars(context)
			const { sessionId } = await start(context, guided(context))
			await waitUntil(() => context.guiding.selectTarget(sessionId, {}).status === 200)
			expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
			await waitUntil(() => context.summary()?.calibration?.saved === true, 90000)
			const stopped = await context.guiding.stopGuiding(sessionId, { token: `token-${tokens++}` }).json()
			await waitUntil(() => context.summary()?.command?.commandId === stopped.commandId && context.summary()?.command?.state !== 'running')

			expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }).status).toBe(202)
			await waitUntil(() => context.summary()?.state === 'calibrating')
			expect(context.summary()?.calibration).toBeUndefined()
			expect((await context.guiding.stop(sessionId)).status).toBe(204)
		},
		90000,
	)

	test('a slew of the mount while guiding, commanded elsewhere, stops guiding and clears the lock while the loop goes on', async () => {
		const context = await setup()
		await trackStars(context)
		const { sessionId } = await start(context, guided(context))
		await waitUntil(() => context.guiding.selectTarget(sessionId, {}).status === 200)
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)

		// The run holds the mount, so only something outside the application moves it: here the driver directly.
		const { rightAscension, declination } = context.mount.equatorialCoordinate
		context.manager.devices.mounts.goTo(context.mount, rightAscension + deg(5), declination)
		await waitUntil(() => context.summary()?.guideOutputHeld === false)
		expect(context.summary()).toMatchObject({ active: true, interruption: { reason: 'externalSlew' }, command: { command: 'stopGuiding' } })
		await waitUntil(() => context.summary()?.command?.state === 'succeeded')
		expect(context.summary()?.lockPosition).toBeUndefined()
		expect(context.summary()?.state).toBe('looping')
		await waitUntil(() => !context.mount.slewing && context.operations.available(context.mount))

		// Guiding never starts again by itself; the next Start Guiding clears the interruption.
		await waitUntil(() => context.guiding.selectTarget(sessionId, {}).status === 200)
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect(context.summary()?.interruption).toBeUndefined()
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
	})

	test('without stopGuidingOnSlew a slew leaves guiding alone', async () => {
		const context = await setup()
		await trackStars(context)
		const { sessionId } = await start(context, guided(context, { stopGuidingOnSlew: false }))
		await waitUntil(() => context.guiding.selectTarget(sessionId, {}).status === 200)
		expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		const command = context.summary()?.command?.commandId

		const { rightAscension, declination } = context.mount.equatorialCoordinate
		context.manager.devices.mounts.goTo(context.mount, rightAscension + deg(1), declination)
		await waitUntil(() => context.mount.slewing)
		await waitUntil(() => !context.mount.slewing)
		expect(context.summary()?.interruption).toBeUndefined()
		expect(context.summary()?.command?.commandId).toBe(command)
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
	})

	test.skipIf(SKIP)(
		'after the motion of another service the calibration is derived for the new declination instead of solved again',
		async () => {
			const context = await setup()
			await trackStars(context)
			const { sessionId } = await start(context, guided(context))
			await waitUntil(() => context.guiding.selectTarget(sessionId, {}).status === 200)
			expect(context.guiding.startGuiding(sessionId, { token: `token-${tokens++}`, recalibrate: false, settle: SETTLE }).status).toBe(202)
			await waitUntil(() => context.summary()?.calibration?.saved === true, 90000)
			const solved = context.summary()!.calibration!

			const suspended = await context.guiding.suspendForMotion(sessionId)
			if (!suspended.ok) throw new Error('not suspended')
			const { rightAscension } = context.mount.equatorialCoordinate
			context.manager.devices.mounts.goTo(context.mount, rightAscension, deg(45))
			await waitUntil(() => !context.mount.slewing && Math.abs(context.mount.equatorialCoordinate.declination - deg(45)) < deg(0.1))
			const before = (await context.guiding.events(sessionId, 0).json()) as GuidingPage<GuidingEventRecord>

			expect(await Promise.race([context.guiding.restoreAfterMotion(suspended.value, new AbortController().signal), Bun.sleep(60000).then(() => 'slow')])).toBe('restored')
			const after = (await context.guiding.events(sessionId, before.items.at(-1)!.sequence).json()) as GuidingPage<GuidingEventRecord>
			const types = after.items.map((record) => record.event.type)
			expect(types).toContain('calibrationTransformed')
			expect(types).not.toContain('calibrationStarted')
			const derived = context.summary()!.calibration!
			expect(derived).toMatchObject({ storedId: solved.storedId, transformations: ['declinationCompensation'] })
			expect(derived.current.declination!).toBeCloseTo(deg(45), 2)
			expect(derived.declinationScale).toBeCloseTo(Math.cos(deg(45)) / Math.cos(derived.source.declination!), 3)
			expect(derived.raRate).toBeCloseTo(solved.raRate * derived.declinationScale, 6)
			expect(derived.decRate).toBeCloseTo(solved.decRate, 9)
			expect((await context.guiding.stop(sessionId)).status).toBe(204)
		},
		90000,
	)

	test.skipIf(SKIP)(
		'end to end: calibrate and save, restore in a new session, move the mount, guide on with the derived calibration',
		async () => {
			const store = new GuidingCalibrationStore(AppDatabase.memory())
			const context = await setup(store)
			await trackStars(context)
			// The simulated field moves by more than a pixel per guide pulse, so the settles are generous.
			const settle = { pixels: 3, time: 1, timeout: 60 }
			const backlash = { guider: { decBacklashCompensation: { mode: 'adaptive', initialMs: 0, maxCompensationMs: 1000, adaptationRate: 0.3 } } } as const

			const first = await start(context, guided(context, backlash))
			await waitUntil(() => context.guiding.selectTarget(first.sessionId, {}).status === 200)
			expect(context.guiding.startGuiding(first.sessionId, { token: `token-${tokens++}`, recalibrate: false, settle }).status).toBe(202)
			await waitUntil(() => context.summary()?.calibration?.saved === true, 90000)
			expect((await context.guiding.stop(first.sessionId)).status).toBe(204)

			// A new session restores the saved calibration and guides with the compensation on.
			const second = await start(context, guided(context, backlash))
			await waitUntil(() => context.guiding.selectTarget(second.sessionId, {}).status === 200)
			const started = context.guiding.admitStartGuiding(second.sessionId, { token: `token-${tokens++}`, recalibrate: false, settle })
			if (!started.ok) throw new Error(started.error)
			expect(await started.settled).toMatchObject({ state: 'succeeded' })
			expect(context.summary()?.calibration?.origin).toBe('restored')
			await waitUntil(() => context.summary()?.decBacklashEstimate !== undefined)

			// The steps of the start settle are marked as such.
			const steps = context.summary()!.telemetryCursor
			await waitUntil(() => (context.summary()?.telemetryCursor ?? 0) >= steps + 3)
			const telemetry = (await context.guiding.telemetry(second.sessionId, 0).json()) as GuidingPage<GuidingTelemetrySample>
			expect(telemetry.items.every((sample) => sample.lost || sample.phase === 'guiding' || sample.phase === 'settling')).toBeTrue()

			// Another service moves the mount to declination 45°; guiding comes back on the derived calibration.
			const generation = context.summary()!.calibration!.generation
			const suspended = await context.guiding.suspendForMotion(second.sessionId)
			if (!suspended.ok) throw new Error('not suspended')
			context.manager.devices.mounts.goTo(context.mount, context.mount.equatorialCoordinate.rightAscension, deg(45))
			await waitUntil(() => !context.mount.slewing && Math.abs(context.mount.equatorialCoordinate.declination - deg(45)) < deg(0.1))
			expect(await context.guiding.restoreAfterMotion(suspended.value, new AbortController().signal)).toBe('restored')
			expect(context.summary()?.calibration).toMatchObject({ origin: 'restored', transformations: ['declinationCompensation'] })
			expect(context.summary()!.calibration!.generation).toBeGreaterThan(generation)
			const cursor = context.summary()!.telemetryCursor
			await waitUntil(() => (context.summary()?.telemetryCursor ?? 0) > cursor + 3)
			const after = (await context.guiding.telemetry(second.sessionId, cursor).json()) as GuidingPage<GuidingTelemetrySample>
			expect(after.items.filter((sample) => !sample.lost).every((sample) => sample.calibrationGeneration === context.summary()!.calibration!.generation)).toBeTrue()
			expect((await context.guiding.stop(second.sessionId)).status).toBe(204)
		},
		90000,
	)

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
	})
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

describe('dark', () => {
	// A Calibration Library holding one master dark of 1000 DN for 200 ms frames of 256 × 256 pixels, whose leases are
	// counted.
	async function darkLibrary() {
		const path = join(root, `dark-${tokens++}.fit`)
		const raw = new Float32Array(256 * 256).fill(1000 / 65535)
		const buffer = Buffer.alloc(4 * 2880 + raw.length * 2)
		const sink = bufferSink(buffer)
		await writeFits(sink, [{ header: { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: 256, NAXIS2: 256, BZERO: 32768, BSCALE: 1, IMAGETYP: 'Dark Frame', EXPTIME: 0.2 }, raw }])
		await Bun.write(path, buffer.subarray(0, sink.position))
		const unknown = { evidence: 'unknown' } as const
		const metadata = { exposure: { value: 200000, evidence: 'verified' }, setTemperature: unknown, sensorTemperature: unknown } as unknown as CalibrationMasterSummary['metadata']
		const master = { masterId: 7, kind: 'dark', metadata, createdAt: 1, frames: 10, contentDigest: 'digest' } as unknown as CalibrationMasterSummary
		const leases = { taken: 0, released: 0 }

		const library: GuidingDarkLibrary = {
			// As matchesTarget, the dark matches only frames exposed 200 ms.
			resolvePreview: (target) => Promise.resolve({ candidates: target.exposure !== undefined && Math.round(target.exposure * 1000000) === 200000 ? [master] : [] }),
			pinnedMaster: ({ masterId, digest }) => Promise.resolve(masterId === 7 && digest === 'digest' ? ({ ...master, path, units: 'DN', fullScaleDn: 65535 } as unknown as CalibrationMasterDetail) : undefined),
			lease: () => {
				leases.taken++
				return () => leases.released++
			},
		}

		return { library, leases }
	}

	test('subtracts the master dark of the frames, chosen again when the exposure changes, and releases it at the end', async () => {
		const { library, leases } = await darkLibrary()
		const context = await setup(undefined, library)
		const { sessionId } = await start(context, { dark: {} })
		expect(context.summary()?.darkCalibration?.state).toBeOneOf(['pending', 'selected', 'applied'])

		await waitUntil(() => context.summary()?.darkCalibration?.state === 'applied')
		expect(context.summary()?.darkCalibration).toEqual({ state: 'applied', masterId: 7, pinned: false })
		expect(leases).toEqual({ taken: 1, released: 0 })
		expect((await context.guiding.darkCandidates(sessionId)).status).toBe(200)

		// Frames of another exposure have no dark: the lease goes, and they are guided uncalibrated.
		expect(context.guiding.setExposure(sessionId, { exposure: 300 }).status).toBe(204)
		await waitUntil(() => context.summary()?.darkCalibration?.state === 'noCompatibleDark')
		expect(leases).toEqual({ taken: 1, released: 1 })

		// Turned off, nothing is subtracted; turned on with a pinned master that does not match, nothing either.
		expect(context.guiding.setDark(sessionId, { enabled: true, masterId: 9 }).status).toBe(204)
		await waitUntil(() => context.summary()?.darkCalibration?.state === 'noCompatibleDark' && context.summary()?.darkCalibration?.pinned === true)
		expect(context.guiding.setDark(sessionId, { enabled: false }).status).toBe(204)
		expect(context.summary()?.darkCalibration).toBeUndefined()

		// Back to 200 ms with the dark on, it is leased again, and released when the session stops.
		expect(context.guiding.setExposure(sessionId, { exposure: 200 }).status).toBe(204)
		expect(context.guiding.setDark(sessionId, { enabled: true }).status).toBe(204)
		await waitUntil(() => context.summary()?.darkCalibration?.state === 'applied')
		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(leases).toEqual({ taken: 2, released: 2 })
	}, 60000)
})

describe('composition', () => {
	// Reserves the guide camera and the mount behind the guide output for a caller composing tools, released after the test.
	function reserve(context: Setup) {
		const owner = { id: 'composition', kind: 'test' }
		const guideOutput = context.manager.devices.device(context.client, 'guideOutput', context.guideOutputId)!
		const devices = [context.camera, context.mount, guideOutput]
		const reserved = context.operations.arbiter.reserve(
			owner,
			devices.map((device) => ({ key: resourceKey(device), device })),
		)
		if (!reserved.ok) throw new Error('the devices could not be reserved')
		disposables.push({ [Symbol.dispose]: () => reserved.reservation.release() })
		return { owner, invocation: { reservation: reserved.reservation } }
	}

	// Admits a session under an invocation and waits until it loops.
	async function admit(context: Setup, invocation: ToolInvocation) {
		const admitted = await context.guiding.admit(context.id, context.cameraId, request(context), invocation)
		if (!admitted.ok) throw new Error(admitted.error)
		await waitUntil(() => context.summary()?.active === true)
		return admitted
	}

	test('a session admitted under a reservation guides inside it, and each command answers its own outcome', async () => {
		const context = await setup()
		const { invocation } = reserve(context)

		expect((await context.guiding.start(context.id, context.cameraId, request(context))).status).toBe(409)
		const { sessionId } = await admit(context, invocation)
		expect(context.guiding.selectTarget(sessionId, { position: [128, 128] }).status).toBe(200)

		const body = { token: `token-${tokens++}`, recalibrate: true, settle: SETTLE }
		const started = context.guiding.admitStartGuiding(sessionId, body)
		if (!started.ok) throw new Error(started.error)
		expect(context.guiding.admitStartGuiding(sessionId, body)).toMatchObject({ ok: true, commandId: started.commandId, repeated: true })
		await waitUntil(() => context.summary()?.guideOutputHeld === true)
		expect(context.running('guideOutput.guiding')).toHaveLength(1)
		expect(context.operations.admits(context.mount)).toBeFalse()

		// The stop replaces the start in the record, while each command still answers its own outcome.
		const stopped = context.guiding.admitStopGuiding(sessionId, { token: `token-${tokens++}` })
		if (!stopped.ok) throw new Error(stopped.error)
		expect(await stopped.settled).toEqual({ commandId: stopped.commandId, command: 'stopGuiding', state: 'succeeded' })
		expect(await started.settled).toMatchObject({ commandId: started.commandId, command: 'startGuiding', state: 'failed' })
		expect(context.summary()?.command).toMatchObject({ commandId: stopped.commandId, state: 'succeeded' })
		await waitUntil(() => context.running('guideOutput.guiding').length === 0)
		expect(context.operations.arbiter.availability(resourceKey(context.mount))).toBe('reserved')

		expect((await context.guiding.stop(sessionId)).status).toBe(204)
		expect(context.operations.arbiter.availability(resourceKey(context.camera))).toBe('reserved')
		expect(context.guiding.admitStopGuiding(sessionId, { token: 'ended' })).toMatchObject({ ok: false, status: 404 })
	})

	test('a drain of the reservation preserving the root of guiding keeps it looping, and its cancellation ends it', async () => {
		const context = await setup()
		const { owner, invocation } = reserve(context)
		const admitted = await admit(context, invocation)
		const root = context.guiding.rootOf(admitted.sessionId)
		expect(root).toBeString()

		const held = context.operations.scope(invocation).start('test.hold', [{ key: resourceKey(context.mount), device: context.mount }], (operation: OperationContext) => {
			const { promise, resolve } = Promise.withResolvers<OperationResult<undefined>>()
			operation.signal.addEventListener('abort', () => resolve(successfulOperationResult(undefined)))
			return promise
		})

		await context.operations.coordinator.drainByReservationOwner(owner, 'aborted', root)
		expect(await held.result).toMatchObject({ ok: false, reason: 'aborted' })
		const frame = context.summary()!.frame?.frameId ?? 0
		await waitUntil(() => (context.summary()?.frame?.frameId ?? 0) > frame)
		expect(context.summary()).toMatchObject({ active: true })

		await context.operations.coordinator.cancelByReservationOwner(owner)
		const ended = await admitted.ended
		expect(ended).toMatchObject({ sessionId: admitted.sessionId, active: false })
		expect(ended.endedAt).toBeNumber()
		expect(context.operations.arbiter.availability(resourceKey(context.camera))).toBe('reserved')
	})
})
