import { afterAll, afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { failedOperationResult, type OperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { analyzeFlat } from 'nebulosa/src/imaging/analysis/flat/flat'
import { measureFlatSequenceFrame } from 'nebulosa/src/imaging/analysis/flat/sequence'
import type { FlatAnalysis } from 'nebulosa/src/imaging/analysis/flat/types'
import { generateSyntheticFlatImage } from 'nebulosa/src/imaging/synthetic/flat'
import { CaptureFrameRegistry } from './captureframes'
import { CameraCaptures } from './captures'
import { ConnectionManager } from './connection'
import { FlatPanelCommands } from './flatpanels'
import { type FlatWizardEvent, type FlatWizardFilter, type FlatWizardRequest, type FlatWizardSession, FlatWizardSessions, finalVerdict, filterName, publishFrame } from './flatwizard'
import type { FlatFrameContext, FlatFrameMeasurement, FlatMeasurementOptions } from './flatwizard.analysis'
import { ImageStore } from './images'
import { OperationRegistry } from './operations'
import { WheelCommands } from './wheels'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-flatwizard-test-'))
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

// Pedestal of the synthetic flats, in DN.
const PEDESTAL = 1000

// Analyzer standing for the worker: measures a noise-free synthetic flat whose median is PEDESTAL plus rate times
// the exposure (rate in DN per second, from the frame context), and records the bytes of every file it was given,
// which the capture really wrote into the staging directory.
function fakeAnalyzer(rate: (context: FlatFrameContext) => number, finals: (context: FlatFrameContext) => Partial<{ readonly nonFinite: boolean }> = () => ({})) {
	const calls: { path: string; context: FlatFrameContext; sample: boolean; bytes: Buffer }[] = []

	const analyzer = {
		measure: (path: string, context: FlatFrameContext, options: FlatMeasurementOptions, sample: boolean): Promise<FlatFrameMeasurement> => {
			calls.push({ path, context, sample, bytes: readFileSync(path) })
			const image = generateSyntheticFlatImage({ width: 32, height: 24, bias: PEDESTAL, signal: rate(context) * context.exposure!, vignetting: 0, lowerClip: 0, upperClip: 65535, quantizationStep: 1 })
			if (sample && finals(context).nonFinite) image.raw.fill(Number.NaN, 0, 32)
			const frame = { ...context, image }
			if (!sample) return Promise.resolve({ analysis: analyzeFlat({ frame }, { ...options, maps: 'none' }) })
			const measured = measureFlatSequenceFrame({ frame }, { analysis: options })
			return Promise.resolve({ analysis: measured.analysis, sample: measured })
		},
	}

	return { analyzer, calls }
}

let tokens = 0

// One filter of 3 frames whose target [20000, 30000] DN is reached at 0.2 s with the default rate of the fake.
function filter(patch: Partial<FlatWizardFilter> = {}): FlatWizardFilter {
	return { slot: 0, count: 3, initialExposure: 0.1, minimumExposure: 0.01, maximumExposure: 2, targetRange: [20000, 30000], ...patch }
}

function request(directory: string, patch: Partial<FlatWizardRequest> = {}): FlatWizardRequest {
	return {
		token: `token-${tokens++}`,
		capture: { gain: 0, offset: 0, binX: 1, binY: 1, subframe: true, x: 0, y: 0, width: 64, height: 64, frameFormat: '' },
		filters: [filter()],
		settleTime: 0,
		directory,
		effectiveClip: 65535,
		maximumTrials: 6,
		maximumRejections: 2,
		...patch,
	}
}

async function setup(rate: (context: FlatFrameContext) => number = () => 100000, finals?: (context: FlatFrameContext) => Partial<{ readonly nonFinite: boolean }>) {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const images = new ImageStore()
	const frames = new CaptureFrameRegistry(images, () => {}, { file: join(mkdtempSync(join(root, 'frames-')), 'capture-frames.json') })
	disposables.push(frames)
	const captures = new CameraCaptures(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		images,
		frames,
		() => {},
		mkdtempSync(join(root, 'captures-')),
	)
	disposables.push(captures)
	const wheels = new WheelCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(wheels)
	const panels = new FlatPanelCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(panels)
	const measurement = fakeAnalyzer(rate, finals)
	const events: FlatWizardEvent[] = []
	const flatWizard = new FlatWizardSessions(
		manager.devices,
		(connectionId) => manager.client(connectionId),
		operations,
		captures.capturer,
		wheels.commander,
		panels.commander,
		images,
		frames,
		measurement.analyzer,
		(event) => events.push(event),
	)

	const devices = manager.devices.list(client)
	const cameraId = devices.find((device) => device.type === 'camera')!.id
	const wheelId = devices.find((device) => device.type === 'wheel')!.id
	const panelId = devices.find((device) => device.type === 'flatPanel')!.id
	for (const deviceId of [cameraId, wheelId, panelId]) manager.devices.switch(client, deviceId, true)
	const camera = manager.devices.camera(client, cameraId)!
	const wheel = manager.devices.device(client, 'wheel', wheelId)!
	const panel = manager.devices.device(client, 'flatPanel', panelId)!
	await waitUntil(() => camera.connected && camera.frame.width.max > 0 && wheel.connected && wheel.count > 1 && panel.connected && panel.intensity.max > 0 && operations.available(camera) && operations.available(wheel) && operations.available(panel))
	if (panel.enabled) expect(await panels.commander.disable(operations.coordinator, panel)).toMatchObject({ ok: true })

	const directory = mkdtempSync(join(root, 'flats-'))
	// Latest published summary.
	const summary = () => events.at(-1)?.session
	// Whether the latest session ended.
	const ended = () => summary()?.endedAt !== undefined
	// Whether the camera, the wheel, and the panel are free for a new operation.
	const released = () => operations.available(camera) && operations.available(wheel) && operations.available(panel)
	// Complete record of a session.
	const session = async (sessionId: string) => (await flatWizard.session(sessionId).json()) as FlatWizardSession

	return { id, operations, captures, frames, flatWizard, measurement, events, camera, cameraId, wheel, wheelDevice: { connectionId: id, deviceId: wheelId }, panel, panelDevice: { connectionId: id, deviceId: panelId }, directory, summary, ended, released, session }
}

// Starts a session and returns its ids.
async function start(flatWizard: FlatWizardSessions, connectionId: string, cameraId: string, body: FlatWizardRequest) {
	const response = flatWizard.start(connectionId, cameraId, body)
	expect(response.status).toBe(202)
	return (await response.json()) as { sessionId: string; operationId: string }
}

describe('Flat Wizard sessions', () => {
	test('a manual run waits for the operator, searches the exposure with two observations, and publishes the original frames', async () => {
		const { id, cameraId, flatWizard, frames, measurement, directory, summary, ended, released, session } = await setup()
		const { sessionId } = await start(flatWizard, id, cameraId, request(directory))

		await waitUntil(() => summary()?.pending !== undefined)
		expect(summary()).toMatchObject({ state: 'waitingForFilter', pending: { kind: 'filter', filter: 0 } })
		expect(flatWizard.continue(sessionId, { stepId: 'stale' }).status).toBe(409)
		expect(flatWizard.continue(sessionId, { stepId: summary()!.pending!.stepId }).status).toBe(204)

		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'completed', filter: 0 })
		const [run] = summary()!.filters
		expect(run).toMatchObject({ state: 'completed', plane: 'mono', exposure: 0.2, trials: 2, accepted: 3, rejected: 0, inconclusive: 0, saveFailed: 0 })
		expect(run.sequence).toMatchObject({ status: 'evaluated', outliers: [] })

		// The trials were 0.1 s (below the target) and 0.2 s, never a proportional guess from one observation.
		const record = await session(sessionId)
		expect(record.attempts.map((attempt) => [attempt.kind, attempt.exposure, attempt.verdict])).toEqual([
			['trial', 0.1, 'usable'],
			['trial', 0.2, 'usable'],
			['final', 0.2, 'accepted'],
			['final', 0.2, 'accepted'],
			['final', 0.2, 'accepted'],
		])

		// Only the accepted frames remain, byte for byte what was measured; the staging directory is gone.
		expect(readdirSync(directory).toSorted()).toEqual(run.files.toSorted())
		expect(run.files.every((file) => file.includes('_FLAT_Filter 1_'))).toBeTrue()
		const finals = measurement.calls.filter((call) => call.sample)
		expect(finals.map((call) => readFileSync(join(directory, run.files[finals.indexOf(call)])).equals(call.bytes))).toEqual([true, true, true])
		expect(finals[0].context).toMatchObject({ exposure: 0.2, filter: 'Filter 1', illumination: { source: 'manual' } })

		// Every exposure was previewed as a Flat Wizard frame; only the published ones are saved, under their final names.
		expect(record.attempts.map((attempt) => attempt.frameId)).toEqual([1, 2, 3, 4, 5].map((generation) => `${sessionId}:${generation}`))
		const page = await frames.recent(id, cameraId)
		expect(page.latest).toMatchObject({ frameId: `${sessionId}:5`, origin: 'flatWizard', frameType: 'FLAT', file: 'saved' })
		expect(page.frames.map((frame) => [frame.frameId, frame.origin, frame.fileName, frame.availability])).toEqual(run.files.toReversed().map((file, i) => [`${sessionId}:${5 - i}`, 'flatWizard', file, i === 0 ? 'memory' : 'file']))
		expect(summary()!.previewError).toBeUndefined()
		expect(released()).toBeTrue()
	}, 120000)

	test('a wheel and a panel select each filter and its brightness, and the light the session switched on is switched off', async () => {
		const { id, cameraId, flatWizard, wheel, wheelDevice, panel, panelDevice, directory, summary, ended, released } = await setup((context) => (context.illumination?.brightness === 80 ? 50000 : 100000))
		const filters = [filter({ slot: 1, count: 1, brightness: 40 }), filter({ slot: 2, count: 1, brightness: 80 })]
		await start(flatWizard, id, cameraId, request(directory, { filters, wheel: wheelDevice, panel: panelDevice, settleTime: 0.05 }))

		await waitUntil(() => summary()?.filter === 1 && summary()?.filters[1].state === 'acquiring', 60000)
		expect(wheel.position).toBe(2)
		expect(panel.enabled).toBeTrue()
		expect(panel.intensity.value).toBe(80)

		await waitUntil(ended, 60000)
		expect(summary()).toMatchObject({ state: 'completed', wheelName: wheel.name, panelName: panel.name })
		expect(summary()!.cleanupWarning).toBeUndefined()
		expect(summary()!.filters.map((run) => [run.name, run.slot, run.brightness, run.accepted])).toEqual([
			[filterName(wheel, 1), 1, 40, 1],
			[filterName(wheel, 2), 2, 80, 1],
		])
		// R needed an affine estimate from two trials below its target: (25000 - 1000) / 50000 DN/s.
		expect(summary()!.filters[0].exposure).toBe(0.2)
		expect(summary()!.filters[1].exposure).toBeCloseTo(0.48, 9)
		expect(summary()!.filters[0].sequence).toEqual({ status: 'notEvaluated', reason: 'At least three accepted frames are needed' })
		expect(panel.enabled).toBeFalse()
		expect(readdirSync(directory)).toHaveLength(2)
		expect(released()).toBeTrue()
	}, 120000)

	test('a stop while waiting for the operator cancels the session and releases the devices', async () => {
		const { id, cameraId, flatWizard, directory, summary, released } = await setup()
		const { sessionId } = await start(flatWizard, id, cameraId, request(directory))

		await waitUntil(() => summary()?.pending !== undefined)
		const stepId = summary()!.pending!.stepId
		expect((await flatWizard.stop(sessionId)).status).toBe(204)
		expect(summary()).toMatchObject({ state: 'cancelled' })
		expect(summary()!.pending).toBeUndefined()
		expect(summary()!.filters[0].state).toBe('cancelled')
		expect(readdirSync(directory)).toEqual([])
		expect(released()).toBeTrue()
		expect(flatWizard.continue(sessionId, { stepId }).status).toBe(409)
		expect((await flatWizard.stop(sessionId)).status).toBe(409)
	}, 60000)

	test('a stop during an exposure keeps the published frames and switches the light off', async () => {
		const { id, cameraId, flatWizard, panel, panelDevice, directory, summary, ended, released } = await setup()
		const { sessionId } = await start(flatWizard, id, cameraId, request(directory, { panel: panelDevice, filters: [filter({ count: 20 })] }))
		await waitUntil(() => summary()?.pending !== undefined)
		// Without a wheel the operator puts the filter in place; the panel needs no confirmation.
		expect(summary()!.pending!.kind).toBe('filter')
		expect(flatWizard.continue(sessionId, { stepId: summary()!.pending!.stepId }).status).toBe(204)

		await waitUntil(() => (summary()?.filters[0].accepted ?? 0) >= 1 || ended(), 60000)
		expect(summary()!.state).not.toBe('failed')
		expect((await flatWizard.stop(sessionId)).status).toBe(204)
		expect(ended()).toBeTrue()
		expect(summary()).toMatchObject({ state: 'cancelled' })
		const run = summary()!.filters[0]
		expect(run.accepted).toBeGreaterThanOrEqual(1)
		expect(readdirSync(directory).toSorted()).toEqual(run.files.toSorted())
		expect(panel.enabled).toBeFalse()
		expect(released()).toBeTrue()
	}, 120000)

	test('a light too bright for the minimum exposure fails with an explanation', async () => {
		const { id, cameraId, flatWizard, directory, summary, ended, released } = await setup(() => 10_000_000)
		await start(flatWizard, id, cameraId, request(directory, { filters: [filter({ initialExposure: 0.04, minimumExposure: 0.01 })] }))

		await waitUntil(() => summary()?.pending !== undefined)
		expect(flatWizard.continue(summary()!.sessionId, { stepId: summary()!.pending!.stepId }).status).toBe(204)
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'failed', reason: 'unexpectedState' })
		expect(summary()!.error).toContain('saturates even at the minimum exposure')
		expect(summary()!.lastAttempt).toMatchObject({ kind: 'trial', exposure: 0.01, verdict: 'clipped' })
		expect(summary()!.filters[0].state).toBe('failed')
		expect(readdirSync(directory)).toEqual([])
		expect(released()).toBeTrue()
	}, 60000)

	test('too many rejected final frames fail the group without publishing them', async () => {
		const { id, cameraId, flatWizard, directory, summary, ended } = await setup(undefined, () => ({ nonFinite: true }))
		await start(flatWizard, id, cameraId, request(directory, { maximumRejections: 1 }))

		await waitUntil(() => summary()?.pending !== undefined)
		expect(flatWizard.continue(summary()!.sessionId, { stepId: summary()!.pending!.stepId }).status).toBe(204)
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'failed' })
		expect(summary()!.filters[0]).toMatchObject({ state: 'failed', accepted: 0, rejected: 2 })
		expect(summary()!.lastAttempt).toMatchObject({ kind: 'final', verdict: 'rejected' })
		expect(summary()!.lastAttempt!.reasons).toContain('nonFiniteSamples')
		expect(readdirSync(directory)).toEqual([])
	}, 60000)

	test('an unknown clipping limit accepts frames inside the target and reports the missing evidence', async () => {
		const { id, cameraId, flatWizard, directory, summary, ended } = await setup()
		await start(flatWizard, id, cameraId, request(directory, { effectiveClip: undefined, filters: [filter({ count: 1 })] }))

		await waitUntil(() => summary()?.pending !== undefined)
		expect(flatWizard.continue(summary()!.sessionId, { stepId: summary()!.pending!.stepId }).status).toBe(204)
		await waitUntil(ended, 60000)

		expect(summary()).toMatchObject({ state: 'completed' })
		expect(summary()!.lastAttempt).toMatchObject({ kind: 'final', verdict: 'accepted' })
		expect(summary()!.lastAttempt!.reasons).toContain('effectiveClipUnknown')
		expect(summary()!.lastAttempt!.planes[0].upperClipping).toBe('unknown')
	}, 60000)

	test('a busy device, a running session, and a repeated token never start a second session', async () => {
		const { id, cameraId, flatWizard, operations, wheel, wheelDevice, directory, summary, events } = await setup()
		const hold = operations.coordinator.start(
			'hold',
			[{ key: resourceKey(wheel), device: wheel }],
			(context) =>
				new Promise<OperationResult<void>>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
				}),
		)

		expect(flatWizard.start(id, cameraId, request(directory, { wheel: wheelDevice })).status).toBe(409)
		expect(events).toEqual([])
		await hold.cancel()

		const body = request(directory)
		const first = await start(flatWizard, id, cameraId, body)
		expect(await start(flatWizard, id, cameraId, body)).toEqual(first)
		expect(flatWizard.start(id, cameraId, request(directory)).status).toBe(409)
		expect(flatWizard.snapshot().sessions).toHaveLength(1)
		expect(flatWizard.start('unknown', cameraId, request(directory)).status).toBe(404)
		expect(flatWizard.session('unknown').status).toBe(404)

		await waitUntil(() => summary()?.pending !== undefined)
		expect((await flatWizard.stop(first.sessionId)).status).toBe(204)
	}, 60000)
})

describe('Flat Wizard frames', () => {
	test('a frame is published without replacing an existing file and its staged copy is removed', async () => {
		const directory = mkdtempSync(join(root, 'publish-'))
		const staged = join(directory, 'staged.fit')
		const path = join(directory, 'final.fit')
		writeFileSync(staged, 'original')

		await publishFrame(staged, path)
		expect(readFileSync(path, 'utf8')).toBe('original')
		expect(existsSync(staged)).toBeFalse()

		writeFileSync(staged, 'other')
		await expect(publishFrame(staged, path)).rejects.toThrow()
		expect(readFileSync(path, 'utf8')).toBe('original')
		expect(existsSync(staged)).toBeTrue()
	})

	test('a final frame is rejected by a failed check and inconclusive without a target', () => {
		const assessment = (target: string, clipping: string, finiteSamples: string) => ({ assessment: { verdict: 'inconclusive', target: { status: target }, clipping: { status: clipping }, finiteSamples: { status: finiteSamples }, reasons: [] } }) as unknown as FlatAnalysis

		expect(finalVerdict(assessment('pass', 'pass', 'pass'))).toBe('accepted')
		expect(finalVerdict(assessment('pass', 'unknown', 'pass'))).toBe('accepted')
		expect(finalVerdict(assessment('pass', 'fail', 'pass'))).toBe('rejected')
		expect(finalVerdict(assessment('fail', 'pass', 'pass'))).toBe('rejected')
		expect(finalVerdict(assessment('unknown', 'pass', 'pass'))).toBe('inconclusive')
	})
})

describe('Flat Wizard filter names', () => {
	test('a filter is named by its wheel slot, or by its 1-based slot number without a name or a wheel', () => {
		expect(filterName({ names: ['Luminance', ' ', 'Red'] }, 0)).toBe('Luminance')
		expect(filterName({ names: ['Luminance', ' ', 'Red'] }, 1)).toBe('Filter 2')
		expect(filterName({ names: ['Luminance'] }, 4)).toBe('Filter 5')
		expect(filterName(undefined, 0)).toBe('Filter 1')
	})
})
