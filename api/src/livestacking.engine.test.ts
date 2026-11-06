import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { type FitsHeader, writeFits } from 'nebulosa/src/io/formats/fits/fits'
import { bufferSink } from 'nebulosa/src/io/io'
import { DEFAULT_LIVE_STACKING_RECIPE, LIVE_COVERAGE_FILE, LIVE_PRODUCT_FILE, LiveEngineError, type LiveEngineOutcome, LiveStackingEngine, LiveWorkerFailure, WorkerProcessor } from './livestacking.engine'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-livestacking-engine-'))

afterAll(() => rmSync(root, { recursive: true, force: true }))

const SIZE = 96

// Star centers of two unrelated fields, in pixels of a 96 × 96 frame.
const FIELD_A: readonly (readonly [number, number])[] = [
	[14, 18],
	[30, 70],
	[44, 22],
	[52, 48],
	[66, 80],
	[72, 30],
	[80, 60],
	[24, 44],
	[60, 12],
	[38, 84],
	[84, 16],
	[12, 82],
]

const FIELD_B: readonly (readonly [number, number])[] = [
	[20, 26],
	[34, 60],
	[48, 14],
	[56, 76],
	[70, 40],
	[82, 70],
	[26, 84],
	[62, 54],
	[16, 50],
	[78, 22],
	[42, 40],
	[88, 86],
]

// Returns a deterministic generator of uniform samples in [0, 1).
function random(seed: number) {
	let state = seed
	return () => (state = (state * 1103515245 + 12345) % 2147483648) / 2147483648
}

// Returns the bytes of a 16-bit FITS light of Gaussian stars shifted by (dx, dy) pixels over a noisy sky, scaled by
// signal, with header keywords.
async function frame(stars: readonly (readonly [number, number])[], dx: number, dy: number, signal = 1, seed = 1, keywords: FitsHeader = {}) {
	const raw = new Float64Array(SIZE * SIZE)
	const next = random(seed)

	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			let value = 0.05 + next() * 0.002
			for (const [cx, cy] of stars) value += 0.4 * Math.exp(-((x - cx - dx) ** 2 + (y - cy - dy) ** 2) / (2 * 1.4 ** 2))
			raw[y * SIZE + x] = value * signal
		}
	}

	const header: FitsHeader = { SIMPLE: true, BITPIX: 16, NAXIS: 2, NAXIS1: SIZE, NAXIS2: SIZE, BZERO: 32768, BSCALE: 1, IMAGETYP: 'Light Frame', EXPTIME: 60, ...keywords }
	const buffer = Buffer.alloc(4 * 2880 + SIZE * SIZE * 2)
	const sink = bufferSink(buffer)
	await writeFits(sink, [{ header, raw }], { type: false })
	return new Uint8Array(buffer.subarray(0, sink.position))
}

// A frame request of a segment, with a generous budget.
async function request(frameId: string, bytes: Promise<Uint8Array<ArrayBuffer>>, segment = 'Ha', budget = 1024 ** 3) {
	return { frameId, source: { kind: 'bytes', bytes: await bytes }, segment, geometry: '96x96x1', budget } as const
}

// Returns the outcome of a frame among outcomes.
function outcome(outcomes: readonly LiveEngineOutcome[], frameId: string) {
	return outcomes.find((entry) => entry.frameId === frameId)
}

describe('live stacking engine', () => {
	test('dithered frames of one filter integrate into one stack of one field', async () => {
		const engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)
		const first = await engine.integrate(await request('s:1', frame(FIELD_A, 0, 0, 1, 1)))
		const second = await engine.integrate(await request('s:2', frame(FIELD_A, 3, -2, 1, 2)))

		const a = first.outcomes[0]
		const b = second.outcomes[0]
		expect(a).toMatchObject({ frameId: 's:1', status: 'accepted', newField: true })
		expect(b).toMatchObject({ frameId: 's:2', status: 'accepted', newField: false })
		if (a.status !== 'accepted' || b.status !== 'accepted') throw new Error('not accepted')
		expect(b.fieldId).toBe(a.fieldId)
		expect(b.cohortId).toBe(a.cohortId)
		expect(Math.abs(b.registration.dx)).toBeCloseTo(3, 0)
		// The detector starts no star within 16 px of the border of this 96 px frame, which the shift leaves 4 stars in.
		expect(b.measurement.stars).toBeGreaterThanOrEqual(9)
		expect(engine.snapshot(a.cohortId)?.frames).toBe(2)
		expect(second.retainedBytes).toBeGreaterThan(0)
	})

	test('another filter stacks on the same field and keeps its own brightness', async () => {
		const engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)
		const ha = (await engine.integrate(await request('s:1', frame(FIELD_A, 0, 0, 1, 1)))).outcomes[0]
		const oiii = (await engine.integrate(await request('s:2', frame(FIELD_A, 2, 1, 0.3, 2), 'OIII'))).outcomes[0]
		await engine.integrate(await request('s:3', frame(FIELD_A, -1, 2, 0.3, 3), 'OIII'))

		if (ha.status !== 'accepted' || oiii.status !== 'accepted') throw new Error('not accepted')
		expect(oiii.fieldId).toBe(ha.fieldId)
		expect(oiii.cohortId).not.toBe(ha.cohortId)

		const hydrogen = engine.snapshot(ha.cohortId)!.image
		const oxygen = engine.snapshot(oiii.cohortId)!
		expect(oxygen.frames).toBe(2)
		const center = 48 * SIZE + 48
		expect(oxygen.image.raw[center]).toBeCloseTo(hydrogen.raw[center] * 0.3, 2)

		const composite = engine.compose({
			preset: 'HOO',
			sources: [
				{ cohortId: ha.cohortId, gain: 1, offset: 0 },
				{ cohortId: oiii.cohortId, gain: 1, offset: 0 },
			],
			mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 1, weight: 1 }], blue: [{ plane: 1, weight: 1 }] },
		})
		expect(composite.frames).toBe(3)
		expect(composite.image.metadata.channels).toBe(3)
		expect(composite.image.raw[center * 3]).toBeCloseTo(hydrogen.raw[center], 6)
	})

	test('a starless frame is rejected and changes nothing', async () => {
		const engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)
		const empty = (await engine.integrate(await request('s:1', frame([], 0, 0)))).outcomes[0]
		expect(empty).toMatchObject({ status: 'rejected', reason: 'tooFewStars' })
		expect(engine.retainedBytes).toBe(0)

		const accepted = (await engine.integrate(await request('s:2', frame(FIELD_A, 0, 0)))).outcomes[0]
		if (accepted.status !== 'accepted') throw new Error('not accepted')
		const before = Array.from(engine.snapshot(accepted.cohortId)!.image.raw)
		expect((await engine.integrate(await request('s:3', frame([], 0, 0, 1, 3)))).outcomes[0]).toMatchObject({ status: 'rejected', reason: 'tooFewStars' })
		expect(Array.from(engine.snapshot(accepted.cohortId)!.image.raw)).toEqual(before)
	})

	test('one frame of another field is held and rejected, and only confirmed candidates start a new field', async () => {
		const engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)
		const a = (await engine.integrate(await request('s:1', frame(FIELD_A, 0, 0)))).outcomes[0]
		if (a.status !== 'accepted') throw new Error('not accepted')

		expect((await engine.integrate(await request('s:2', frame(FIELD_B, 0, 0, 1, 2)))).outcomes).toEqual([{ frameId: 's:2', status: 'held', measurement: expect.any(Object) }])
		const back = (await engine.integrate(await request('s:3', frame(FIELD_A, 1, 1, 1, 3)))).outcomes
		expect(outcome(back, 's:3')).toMatchObject({ status: 'accepted', fieldId: a.fieldId })
		expect(outcome(back, 's:2')).toMatchObject({ status: 'rejected', reason: 'unconfirmedField' })

		expect((await engine.integrate(await request('s:4', frame(FIELD_B, 0, 0, 1, 4)))).outcomes[0].status).toBe('held')
		expect((await engine.integrate(await request('s:5', frame(FIELD_B, 2, -1, 1, 5)))).outcomes[0].status).toBe('held')
		const confirmed = (await engine.integrate(await request('s:6', frame(FIELD_B, -1, 2, 1, 6)))).outcomes
		expect(confirmed.map((entry) => [entry.frameId, entry.status])).toEqual([
			['s:4', 'accepted'],
			['s:5', 'accepted'],
			['s:6', 'accepted'],
		])
		const started = outcome(confirmed, 's:4')
		if (started?.status !== 'accepted') throw new Error('not accepted')
		expect(started.newField).toBeTrue()
		expect(started.fieldId).not.toBe(a.fieldId)
		expect(engine.snapshot(a.cohortId)?.frames).toBe(2)
		expect(engine.snapshot(started.cohortId)?.frames).toBe(3)
	})

	test('a new field, stack, or candidate beyond the budget is refused', async () => {
		const engine = new LiveStackingEngine(DEFAULT_LIVE_STACKING_RECIPE)
		expect((await engine.integrate(await request('s:1', frame(FIELD_A, 0, 0), 'Ha', 1024))).outcomes[0]).toMatchObject({ status: 'rejected', reason: 'capacityExceeded' })
		expect(engine.retainedBytes).toBe(0)

		const accepted = (await engine.integrate(await request('s:2', frame(FIELD_A, 0, 0)))).outcomes[0]
		expect(accepted.status).toBe('accepted')
		expect((await engine.integrate(await request('s:3', frame(FIELD_A, 1, 0, 0.3), 'OIII', engine.retainedBytes))).outcomes[0]).toMatchObject({ status: 'rejected', reason: 'capacityExceeded' })
		expect((await engine.integrate(await request('s:4', frame(FIELD_A, 1, 0, 1, 4), 'Ha', engine.retainedBytes))).outcomes[0].status).toBe('accepted')
	})

	test('an export writes the linear stack and its coverage, and a reset forgets the stacks', async () => {
		const engine = new LiveStackingEngine({ ...DEFAULT_LIVE_STACKING_RECIPE, method: 'weighted-average' })
		const accepted = (await engine.integrate(await request('s:1', frame(FIELD_A, 0, 0)))).outcomes[0]
		await engine.integrate(await request('s:2', frame(FIELD_A, 4, 3, 1, 2)))
		if (accepted.status !== 'accepted') throw new Error('not accepted')

		const directory = join(root, 'export')
		const files = await engine.export(directory, { cohortId: accepted.cohortId }, { FILTER: 'Ha', NCOMBINE: 2 })
		expect(files).toMatchObject({ width: SIZE, height: SIZE, channels: 1, bytes: expect.any(Number), coverageBytes: expect.any(Number) })
		expect(existsSync(join(directory, LIVE_PRODUCT_FILE))).toBeTrue()
		expect(existsSync(join(directory, LIVE_COVERAGE_FILE))).toBeTrue()

		engine.reset()
		expect(engine.snapshot(accepted.cohortId)).toBeUndefined()
		expect(engine.retainedBytes).toBe(0)
	})

	test('the worker processor integrates on a thread of its own, answers snapshots, and refuses everything once stopped', async () => {
		const processor = new WorkerProcessor(DEFAULT_LIVE_STACKING_RECIPE)
		const accepted = (await processor.integrate(await request('s:1', frame(FIELD_A, 0, 0)))).outcomes[0]
		if (accepted.status !== 'accepted') throw new Error('not accepted')

		const snapshot = await processor.snapshot(accepted.cohortId)
		expect(snapshot?.frames).toBe(1)
		expect(snapshot?.image.raw).toBeInstanceOf(Float32Array)
		await expect(processor.compose({ preset: 'L', sources: [{ cohortId: 'unknown', gain: 1, offset: 0 }], mix: { red: [{ plane: 0, weight: 1 }], green: [{ plane: 0, weight: 1 }], blue: [{ plane: 0, weight: 1 }] } })).rejects.toBeInstanceOf(LiveEngineError)

		processor[Symbol.dispose]()
		await expect(processor.snapshot(accepted.cohortId)).rejects.toBeInstanceOf(LiveWorkerFailure)
	})
})
