import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { equatorial } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { spkSeconds } from 'nebulosa/src/astronomy/ephemeris/kernels/spk'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { AstroWeatherNights } from './astroweather.night'
import { AppDatabase } from './database'
import { analyzeTarget, OBSERVING_PRESETS, PlanningNight, type PlanningSite, resolveNight } from './observingplanner.astronomy'
import { type HorizonsVectors, type MinorBodyPreparation, MinorBodyTrajectories } from './observingplanner.minorbodies'
import { ObservingMinorBodyStore, type SavedMinorBody } from './observingplanner.minorbodies.store'
import { keplerOrbit } from './sky/ephemeris'
import type { ResolvedMinorBody } from './sky/minorbodies'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { type SpiceKernelSnapshot, SpiceKernelRuntime } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'
import { SsdRequestQueue } from './ssd'

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-planner-minor-'))
const runtimes: SpiceKernelRuntime[] = []

afterAll(() => {
	for (const runtime of runtimes) runtime[Symbol.dispose]()
	rmSync(directory, { recursive: true, force: true })
})

const SAO_PAULO: PlanningSite = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
const nights = new AstroWeatherNights()
const night = new PlanningNight(
	SAO_PAULO,
	resolveNight((request) => nights.night(request), SAO_PAULO, '2026-10-18'),
)
const MIDDLE = (night.night.sun.start + night.night.sun.end) / 2

const VESTA = { kind: 'minorBody', spkId: '2000004', designation: '4' } as const
const FAST = { kind: 'minorBody', spkId: '54000001', designation: '2026 AA' } as const

// Osculating elements of a Vesta-like orbit (J2000 ecliptic, epoch 2026-10-18 TDB), with its photometry.
const VESTA_ELEMENTS = { epoch: 2461331.5, referenceEclipticFrame: 'J2000', ec: 0.0902, i: 7.144 * DEG2RAD, om: 103.7 * DEG2RAD, w: 151.5 * DEG2RAD, tpqr: { a: 2.3615, ma: 120 * DEG2RAD }, h: 3.25, g: 0.32 } as const

const VESTA_BODY: SavedMinorBody = { body: { spkId: VESTA.spkId, designation: '4', name: '4 Vesta (A807 FA)', kind: 'asteroid', orbitClass: 'Main-belt Asteroid', solutionDate: '2026-09-01' }, elements: VESTA_ELEMENTS, fetchedAt: Date.UTC(2026, 9, 1) }

const WIDE = { start: -1e9, end: 1e9 }

// Constant geometry: the Sun at the barycenter, the Earth 1 AU away on +X, and the body 2 AU from the Sun on +Y.
const PLANETARY: SpkFixtureSegment[] = [
	{ center: 0, target: 10, ...WIDE, position: [0, 0, 0] },
	{ center: 0, target: 3, ...WIDE, position: [1.496e8, 0, 0] },
	{ center: 3, target: 399, ...WIDE, position: [0, 0, 0] },
]
const BODY: SpkFixtureSegment[] = [{ center: 10, target: 2000004, ...WIDE, position: [0, 2.992e8, 0] }]

let files = 0

// Snapshot of a kernel set of fixture files under a policy.
async function snapshotOf(policy: SpiceEphemerisPolicy, ...kernels: (readonly SpkFixtureSegment[])[]): Promise<SpiceKernelSnapshot> {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const entries = kernels.map((kernel) => {
		const id = `kernel-${++files}`
		const path = join(directory, `${id}.bsp`)
		writeFileSync(path, spkFixture(kernel))
		return { id, path }
	})
	expect((await runtime.rebuild(entries, policy)).size).toBe(0)
	return runtime.current()
}

// Snapshot without kernels under a policy.
function bare(policy: SpiceEphemerisPolicy, generation: number = 1): SpiceKernelSnapshot {
	return { generation, policy, loading: false, readiness: new Map() }
}

// SBDB lookups answering one body, counting the requests.
function lookups(answer?: SavedMinorBody | 'unavailable', cached?: SavedMinorBody) {
	const calls: string[] = []
	const body = (spkId: string) => {
		calls.push(spkId)
		if (answer === 'unavailable') return Promise.reject(new Error('SBDB cannot be reached'))
		return Promise.resolve(answer as ResolvedMinorBody | undefined)
	}
	return { minorBodies: { body, cached: () => cached as ResolvedMinorBody | undefined }, calls }
}

// Horizons client answering geocentric vectors of a function of Unix milliseconds, counting the requests.
function vectorsOf(position: (time: number) => readonly number[]) {
	const calls: { readonly step: number; readonly count: number }[] = []
	const vectors = ((_command: string, _center: string, _coord: unknown, start: number, end: number, options: { readonly stepSize: number }) => {
		const step = options.stepSize * 60_000
		const count = Math.round((end - start) / step) + 1
		calls.push({ step, count })
		return Promise.resolve(Array.from({ length: count }, (_, i) => ['', '', ...position(start + i * step).map(String)]))
	}) as unknown as HorizonsVectors
	return { vectors, calls }
}

// Horizons client that cannot be reached.
const unreachable = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as HorizonsVectors

// Geocentric vector of the Vesta-like orbit at an instant, exactly as the Kepler model computes its nodes.
function keplerGeocentric(time: number) {
	const t = timeUnix(time / 1000, true)
	const heliocentric = keplerOrbit(VESTA_ELEMENTS)!.at(t)[0]
	const sun = vsop.sun(t)[0]
	const earth = vsop.earth(t)[0]
	return [heliocentric[0] + sun[0] - earth[0], heliocentric[1] + sun[1] - earth[1], heliocentric[2] + sun[2] - earth[2]]
}

// A body 0.01 AU from the Earth's center circling it at `rate` radians per minute.
function circling(rate: number) {
	return (time: number) => {
		const angle = rate * (time / 60_000)
		return [0.01 * Math.cos(angle), 0.01 * Math.sin(angle), 0.001]
	}
}

// Trajectories over a snapshot, the lookups, the saved bodies, and a Horizons client.
function trajectoriesOf(snapshot: SpiceKernelSnapshot, minorBodies: ReturnType<typeof lookups>['minorBodies'], vectors: HorizonsVectors = unreachable, saved?: SavedMinorBody) {
	const store = new ObservingMinorBodyStore(AppDatabase.memory())
	if (saved) store.put(saved)
	return new MinorBodyTrajectories({ minorBodies, kernels: { current: () => snapshot }, queue: new SsdRequestQueue(), store, vectors })
}

// The prepared trajectory of a preparation, failing otherwise.
function prepared(preparation: MinorBodyPreparation) {
	if (preparation.kind !== 'prepared') throw new Error(`not prepared: ${JSON.stringify(preparation)}`)
	return preparation.target
}

describe('kernels', () => {
	test('a kernel set covering the night is the source, without asking JPL', async () => {
		const snapshot = await snapshotOf('offline', PLANETARY, BODY)
		const { minorBodies, calls } = lookups()
		const target = prepared(await trajectoriesOf(snapshot, minorBodies, unreachable, VESTA_BODY).prepare(VESTA, night))
		expect(target.ephemeris).toMatchObject({ source: 'spk', approximate: false, nodeSpacingMs: 600_000, searchStepMs: 600_000 })
		expect(target.ephemeris!.kernels!.kernelIds).toHaveLength(2)
		expect(target.name).toBe('4 Vesta (A807 FA)')
		expect(calls).toEqual([])
		// The body is at (−1, 2, 0) AU from the Earth's center; the site moves it by under 4″.
		const [rightAscension, declination] = equatorial(target.directionAt(night.time(MIDDLE)))
		expect(rightAscension).toBeCloseTo(Math.atan2(2, -1), 4)
		expect(declination).toBeCloseTo(0, 4)
	})

	test('a kernel set covering part of the night is refused under spkOnly and replaced whole otherwise', async () => {
		const end = spkSeconds(timeUnix(MIDDLE / 1000, true))
		const partial: SpkFixtureSegment[] = [{ center: 10, target: 2000004, start: -1e9, end, position: [0, 2.992e8, 0] }]

		const strict = trajectoriesOf(await snapshotOf('spkOnly', PLANETARY, partial), lookups().minorBodies, unreachable, VESTA_BODY)
		expect(await strict.prepare(VESTA, night)).toEqual({ kind: 'unavailable', reason: 'kernelCoverageUnavailable', name: '4 Vesta (A807 FA)', typeName: 'Main-belt Asteroid' })

		const { vectors, calls } = vectorsOf(keplerGeocentric)
		const automatic = prepared(await trajectoriesOf(await snapshotOf('automatic', PLANETARY, partial), lookups(VESTA_BODY).minorBodies, vectors).prepare(VESTA, night))
		expect(automatic.ephemeris!.source).toBe('horizons')
		expect(calls).toHaveLength(1)
	})
})

describe('policies without kernels', () => {
	test('offline uses the saved elements with the approximate Kepler model and never asks JPL', async () => {
		const { minorBodies, calls } = lookups()
		const target = prepared(await trajectoriesOf(bare('offline'), minorBodies, unreachable, VESTA_BODY).prepare(VESTA, night))
		expect(target.ephemeris).toMatchObject({ source: 'kepler', approximate: true, fallbackReason: 'offline', orbitEpoch: VESTA_ELEMENTS.epoch, solutionDate: '2026-09-01', elementsFetchedAt: VESTA_BODY.fetchedAt })
		expect(calls).toEqual([])
		// The body moves against the stars over the night, unlike a fixed target.
		const evening = equatorial(target.directionAt(night.start))
		const morning = equatorial(target.directionAt(night.end))
		expect(Math.abs(evening[0] - morning[0]) + Math.abs(evening[1] - morning[1])).toBeGreaterThan(1e-4)
		const analysis = analyzeTarget(night, target, OBSERVING_PRESETS.deepSky)
		expect(analysis.samples.every((e) => e.distance! > 1 && e.magnitude! > 5 && e.magnitude! < 9)).toBe(true)
	})

	test('offline without kernels or elements is unavailable, and spkOnly never falls back', async () => {
		expect(await trajectoriesOf(bare('offline'), lookups().minorBodies).prepare(VESTA, night)).toEqual({ kind: 'unavailable', reason: 'ephemerisOffline' })
		const { minorBodies, calls } = lookups(VESTA_BODY)
		expect(await trajectoriesOf(bare('spkOnly'), minorBodies, unreachable, VESTA_BODY).prepare(VESTA, night)).toMatchObject({ kind: 'unavailable', reason: 'kernelCoverageUnavailable' })
		expect(calls).toEqual([])
	})

	test('automatic asks Horizons for geometric vectors that match the Kepler nodes they replace', async () => {
		const { vectors, calls } = vectorsOf(keplerGeocentric)
		const trajectories = trajectoriesOf(bare('automatic'), lookups(VESTA_BODY).minorBodies, vectors)
		const horizons = prepared(await trajectories.prepare(VESTA, night))
		expect(horizons.ephemeris).toMatchObject({ source: 'horizons', approximate: false })
		const kepler = prepared(await trajectoriesOf(bare('offline'), lookups().minorBodies, unreachable, VESTA_BODY).prepare(VESTA, night))
		const windows = analyzeTarget(night, kepler, OBSERVING_PRESETS.visual).windows
		const fromHorizons = analyzeTarget(night, horizons, OBSERVING_PRESETS.visual).windows
		expect(windows.length).toBeGreaterThan(0)
		expect(fromHorizons).toHaveLength(windows.length)
		for (const [i, window] of windows.entries()) {
			expect(Math.abs(fromHorizons[i].start - window.start)).toBeLessThan(1000)
			expect(Math.abs(fromHorizons[i].end - window.end)).toBeLessThan(1000)
		}
		// The same night is prepared once.
		await trajectories.prepare(VESTA, night)
		expect(calls).toHaveLength(1)
	})

	test('automatic falls back to Kepler when Horizons fails, and asks it again next time', async () => {
		const { minorBodies, calls } = lookups(VESTA_BODY)
		const trajectories = trajectoriesOf(bare('automatic'), minorBodies)
		expect(prepared(await trajectories.prepare(VESTA, night)).ephemeris).toMatchObject({ source: 'kepler', fallbackReason: 'network' })
		await trajectories.prepare(VESTA, night)
		expect(calls).toHaveLength(2)
	})

	test('a body SBDB does not know is unresolved; SBDB and Horizons unreachable is unavailable', async () => {
		expect(await trajectoriesOf(bare('automatic'), lookups().minorBodies).prepare(VESTA, night)).toEqual({ kind: 'unresolved' })
		expect(await trajectoriesOf(bare('automatic'), lookups('unavailable').minorBodies).prepare(VESTA, night)).toEqual({ kind: 'unavailable', reason: 'ephemerisSourceUnavailable' })
	})

	test('elements the local model cannot propagate are unavailable', async () => {
		const b1950: SavedMinorBody = { ...VESTA_BODY, elements: { ...VESTA_ELEMENTS, referenceEclipticFrame: 'B1950' } }
		expect(await trajectoriesOf(bare('offline'), lookups().minorBodies, unreachable, b1950).prepare(VESTA, night)).toMatchObject({ kind: 'unavailable', reason: 'orbitalSolutionUnavailable' })
	})

	test('a cancelled preparation rejects instead of answering a status', async () => {
		const controller = new AbortController()
		controller.abort(new Error('left'))
		const minorBodies = { body: (_: string, signal?: AbortSignal) => Promise.reject(signal!.reason as Error), cached: () => undefined }
		await expect(trajectoriesOf(bare('automatic'), minorBodies).prepare(VESTA, night, controller.signal)).rejects.toThrow('left')
	})
})

describe('fast bodies', () => {
	test('a fast body is sampled every minute and searched with a shorter step', async () => {
		const { vectors, calls } = vectorsOf(circling(6e-3))
		const target = prepared(await trajectoriesOf(bare('automatic'), lookups(VESTA_BODY).minorBodies, vectors).prepare(FAST, night))
		expect(calls.map((e) => e.step)).toEqual([600_000, 60_000])
		expect(target.ephemeris!.nodeSpacingMs).toBe(60_000)
		expect(target.ephemeris!.searchStepMs).toBeLessThan(600_000)
		expect(target.ephemeris!.searchStepMs).toBeGreaterThanOrEqual(60_000)
		expect(target.motion).toBeGreaterThan(5e-3)
		expect(target.step).toBe(target.ephemeris!.searchStepMs / 86_400_000)
	})

	test('a body too fast to follow has no trajectory', async () => {
		const { vectors } = vectorsOf(circling(2e-2))
		expect(await trajectoriesOf(bare('automatic'), lookups(VESTA_BODY).minorBodies, vectors).prepare(FAST, night)).toMatchObject({ kind: 'unavailable', reason: 'trajectoryResolutionExceeded' })
	})
})
