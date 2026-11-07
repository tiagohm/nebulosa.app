import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createSaturnRoutes, SaturnPlannerService } from './saturn'
import type { SaturnElongations, SaturnKernels, SaturnMoonsState, SaturnRingState, SaturnRingTimeline, SaturnSourceReport, SaturnTrack } from './saturn.astronomy'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { SpiceKernelRuntime, type SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

const DAY = 86_400_000
const NOV_1 = Date.UTC(2026, 10, 1)
const ARCSEC = Math.PI / 180 / 3600

// J2000.0 (TDB) as Unix milliseconds, to within the ~70 s of TT − UTC that the fixture coverages do not care about.
const J2000_MS = Date.UTC(2000, 0, 1, 11, 58, 56)

// TDB seconds past J2000 of a Unix time, for fixture coverages.
function et(time: number) {
	return (time - J2000_MS) / 1000
}

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-saturn-'))
const runtimes: SpiceKernelRuntime[] = []
let files = 0

// The planner never reaches the network: any fetch fails the test.
const originalFetch = globalThis.fetch
beforeAll(() => {
	globalThis.fetch = Object.assign(() => Promise.reject(new Error('the Saturn Observing Planner must not use the network')), { preconnect: originalFetch.preconnect })
})
afterAll(() => {
	globalThis.fetch = originalFetch
	rmSync(directory, { recursive: true, force: true })
})
afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime[Symbol.dispose]()
})

// A snapshot of no kernel under a policy.
function noKernels(policy: SpiceEphemerisPolicy = 'automatic'): SaturnKernels {
	return { current: (): SpiceKernelSnapshot => ({ generation: 0, policy, loading: false, readiness: new Map() }) }
}

// A runtime of fixture kernels under a policy.
async function runtimeOf(policy: SpiceEphemerisPolicy, ...kernels: (readonly SpkFixtureSegment[])[]) {
	const runtime = new SpiceKernelRuntime()
	runtimes.push(runtime)
	const entries = kernels.map((kernel) => {
		const id = `kernel-${++files}`
		const path = join(directory, `${id}.bsp`)
		writeFileSync(path, spkFixture(kernel))
		return { id, path }
	})
	expect((await runtime.rebuild(entries, policy)).size).toBe(0)
	return { runtime, ids: entries.map((e) => e.id) }
}

// Coverage of the fixtures: 2000 to 2050, wide enough for every interpolation node of the tests.
const COVERAGE = { start: et(Date.UTC(2000, 0, 1)), end: et(Date.UTC(2050, 0, 1)) }

// A constant planetary kernel like sat480.bsp: the Sun, the Earth and Saturn's centre, with Saturn north of the ecliptic
// so the ring plane is open, but no moon.
const RING_KERNEL: SpkFixtureSegment[] = [
	{ center: 0, target: 10, ...COVERAGE, position: [0, 0, 0] },
	{ center: 0, target: 3, ...COVERAGE, position: [149600000, 0, 0] },
	{ center: 3, target: 399, ...COVERAGE, position: [0, 4000, 0] },
	{ center: 0, target: 6, ...COVERAGE, position: [-1400000000, 200000000, 300000000] },
	{ center: 6, target: 699, ...COVERAGE, position: [0, 0, 100] },
]

// The major moons on the system barycenter, as in sat441.bsp.
const MOON_KERNEL: SpkFixtureSegment[] = [
	{ center: 6, target: 601, ...COVERAGE, position: [185540, 0, 0] },
	{ center: 6, target: 602, ...COVERAGE, position: [0, 238040, 0] },
	{ center: 6, target: 603, ...COVERAGE, position: [-294670, 0, 0] },
	{ center: 6, target: 604, ...COVERAGE, position: [0, -377420, 0] },
	{ center: 6, target: 605, ...COVERAGE, position: [527070, 0, 0] },
	{ center: 6, target: 606, ...COVERAGE, position: [0, 1221870, 0] },
	{ center: 6, target: 608, ...COVERAGE, position: [-3560840, 0, 0] },
]

function setup(kernels: SaturnKernels = noKernels()) {
	const service = new SaturnPlannerService({ kernels })
	return { service, routes: createSaturnRoutes(service) }
}

function post(body: unknown) {
	return new Request('http://localhost/api/saturn', { method: 'POST', body: JSON.stringify(body) }) as never
}

// Every number of an answer, recursively.
function numbers(value: unknown): number[] {
	if (typeof value === 'number') return [value]
	if (Array.isArray(value)) return value.flatMap(numbers)
	if (value !== null && typeof value === 'object') return Object.values(value).flatMap(numbers)
	return []
}

describe('state', () => {
	test('gives the rings and seven moons from the analytical theories without kernels', async () => {
		const { routes } = setup()
		const response = await routes['/api/saturn/moons/state'].POST(post({ time: NOV_1 }))
		expect(response.status).toBe(200)
		const state = (await response.json()) as SaturnMoonsState

		expect(state.moons.map((m) => m.moon)).toEqual(['mimas', 'enceladus', 'tethys', 'dione', 'rhea', 'titan', 'iapetus'])
		expect(state.signature).toMatchObject({ modelVersion: 1, ringModelVersion: 1, scope: 'moons', source: { kind: 'analytical', planetary: 'VSOP87E', satellites: 'TASS1.7', fallbackReason: 'noKernel' }, policy: 'automatic', generation: 0 })
		expect(state.rings.earthOpening / (Math.PI / 180)).toBeCloseTo(-6.58, 1)
		expect(state.rings.illumination).toBe('sameFace')
		expect(state.model.annuli.map((a) => a.name)).toEqual(['C', 'B', 'cassini', 'A'])
		expect(state.model.equatorialRadiusKm).toBe(60268)
		// Titan sits about 28.6″ from Saturn on 2026 November 1 (Horizons: −19.5″ east, −21.1″ north).
		const titan = state.moons.find((m) => m.moon === 'titan')!
		expect(titan.separation / ARCSEC).toBeCloseTo(28.7, 0)
		expect(numbers(state).every(Number.isFinite)).toBeTrue()
	})

	test('gives the rings from a ring-only kernel under spkOnly and refuses the moons', async () => {
		const { runtime, ids } = await runtimeOf('spkOnly', RING_KERNEL)
		const { routes } = setup(runtime)

		const rings = (await (await routes['/api/saturn/rings/state'].POST(post({ time: NOV_1 }))).json()) as SaturnRingState
		expect(rings.signature).toMatchObject({ scope: 'rings', source: { kind: 'spk', kernels: { saturn: [ids[0]] } }, policy: 'spkOnly' })
		// Saturn is north of the Earth's orbit plane, so the Earth sees the rings at a finite opening.
		expect(Number.isFinite(rings.rings.earthOpening)).toBeTrue()

		const refused = await routes['/api/saturn/moons/state'].POST(post({ time: NOV_1 }))
		expect(refused.status).toBe(503)
		expect(await refused.json()).toMatchObject({ code: 'missingDependency', reason: 'targetMissing', miss: { target: 'mimas', body: 601 } })
	})

	test('falls back to the theories for the moons only, under automatic', async () => {
		const { runtime } = await runtimeOf('automatic', RING_KERNEL)
		const { routes } = setup(runtime)
		const rings = (await (await routes['/api/saturn/rings/state'].POST(post({ time: NOV_1 }))).json()) as SaturnRingState
		const moons = (await (await routes['/api/saturn/moons/state'].POST(post({ time: NOV_1 }))).json()) as SaturnMoonsState
		expect(rings.signature.source.kind).toBe('spk')
		expect(moons.signature.source).toMatchObject({ kind: 'analytical', satellites: 'TASS1.7', fallbackReason: 'targetMissing' })
	})

	test('uses a complete satellite kernel for the moons', async () => {
		const { runtime } = await runtimeOf('spkOnly', RING_KERNEL, MOON_KERNEL)
		const { routes } = setup(runtime)
		const moons = (await (await routes['/api/saturn/moons/state'].POST(post({ time: NOV_1 }))).json()) as SaturnMoonsState
		expect(moons.signature.source.kind).toBe('spk')
		expect(numbers(moons).every(Number.isFinite)).toBeTrue()
	})
})

describe('ring timeline', () => {
	test('finds the 2025 crossings by search and samples the openings', async () => {
		const { routes } = setup()
		const start = Date.UTC(2024, 5, 1)
		const end = Date.UTC(2026, 5, 1)
		const timeline = (await (await routes['/api/saturn/rings/timeline'].POST(post({ start, end }))).json()) as SaturnRingTimeline

		expect(timeline.times.length).toBeLessThanOrEqual(2000)
		expect(timeline.times[0]).toBe(start)
		expect(timeline.times.at(-1)!).toBeLessThanOrEqual(end)
		expect(timeline.times.every((t, i) => i === 0 || t - timeline.times[i - 1] === timeline.step)).toBeTrue()
		expect(timeline.earthOpening).toHaveLength(timeline.times.length)

		const earth = timeline.events.filter((e) => e.kind === 'earthPlaneCrossing')
		const sun = timeline.events.filter((e) => e.kind === 'solarPlaneCrossing')
		expect(earth).toHaveLength(1)
		expect(sun).toHaveLength(1)
		// JPL Horizons: 2025-03-23 17:46:48 UTC.
		expect(Math.abs(earth[0].time - Date.UTC(2025, 2, 23, 17, 46, 48))).toBeLessThan(180_000)
		expect((sun[0].time - earth[0].time) / DAY).toBeCloseTo(43.9, 0)
		expect(timeline.events.some((e) => e.kind === 'nearPlaneApproach')).toBeTrue()
		expect(timeline.signature).toMatchObject({ scope: 'rings', source: { kind: 'analytical', planetary: 'VSOP87E', fallbackReason: 'noKernel' } })
		expect(timeline.signature.source).not.toHaveProperty('satellites')
	})

	test('lists the same events whatever the chunking', async () => {
		const { service } = setup()
		const whole = await service.ringTimeline({ start: Date.UTC(2038, 0, 1), end: Date.UTC(2040, 0, 1) })
		expect(whole.events.filter((e) => e.kind === 'earthPlaneCrossing')).toHaveLength(3)
		expect(whole.events.filter((e) => e.kind === 'solarPlaneCrossing')).toHaveLength(1)
		// Events of consecutive yearly chunks are chronological and never repeated.
		expect(whole.events.every((e, i) => i === 0 || e.time > whole.events[i - 1].time)).toBeTrue()
	})

	test('restarts on a generation change and answers 503 when it keeps changing', async () => {
		const { runtime } = await runtimeOf('automatic', RING_KERNEL)
		let generation = 0
		const changing: SaturnKernels = { current: () => ({ ...runtime.current(), generation: generation++ }) }
		const response = await setup(changing).routes['/api/saturn/rings/timeline'].POST(post({ start: Date.UTC(2024, 0, 1), end: Date.UTC(2027, 0, 1) }))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'generationChanged', reason: 'generationChanged' })
	})

	test('stops an aborted request without an answer', async () => {
		const controller = new AbortController()
		controller.abort()
		const { service } = setup()
		const request = { start: Date.UTC(2024, 0, 1), end: Date.UTC(2027, 0, 1) }
		await expect(service.ringTimeline(request, controller.signal)).rejects.toThrow()
		// Nothing was cached: the next request computes a full answer.
		expect((await service.ringTimeline(request)).times.length).toBeGreaterThan(0)
	})
})

describe('moons', () => {
	test('samples seven tracks over a range', async () => {
		const { routes } = setup()
		const track = (await (await routes['/api/saturn/moons/track'].POST(post({ start: NOV_1, end: NOV_1 + 3 * DAY }))).json()) as SaturnTrack
		expect(track.times.length).toBeLessThanOrEqual(2000)
		for (const moon of Object.values(track.moons)) {
			expect(moon.east).toHaveLength(track.times.length)
			expect(moon.ringOverlap).toHaveLength(track.times.length)
		}
		expect(Object.keys(track.moons)).toHaveLength(7)
		expect(numbers(track).every(Number.isFinite)).toBeTrue()
	})

	test('finds the greatest separations, with none for a slow moon in a short range', async () => {
		const { routes } = setup()
		const month = (await (await routes['/api/saturn/moons/elongations'].POST(post({ start: NOV_1, end: Date.UTC(2026, 11, 1), moons: ['iapetus', 'titan'] }))).json()) as SaturnElongations
		const iapetus = month.elongations.filter((e) => e.moon === 'iapetus')
		expect(iapetus).toHaveLength(1)
		expect(iapetus[0].separation / ARCSEC).toBeCloseTo(567, -1)
		expect(month.elongations.filter((e) => e.moon === 'titan').length).toBeGreaterThanOrEqual(3)
		expect(month.elongations.every((e, i) => i === 0 || e.time >= month.elongations[i - 1].time)).toBeTrue()

		const day = (await (await routes['/api/saturn/moons/elongations'].POST(post({ start: Date.UTC(2026, 10, 2), end: Date.UTC(2026, 10, 3), moons: ['iapetus'] }))).json()) as SaturnElongations
		expect(day.elongations).toEqual([])
	})
})

describe('sources', () => {
	test('reports the rings and the moons separately', async () => {
		const { runtime } = await runtimeOf('spkOnly', RING_KERNEL)
		const report = (await (await setup(runtime).routes['/api/saturn/source'].POST(post({ start: Date.UTC(2020, 0, 1), end: Date.UTC(2049, 0, 1) }))).json()) as SaturnSourceReport
		expect(report.rings).toMatchObject({ readiness: 'ready', source: 'spk', policy: 'spkOnly' })
		expect(report.rings.probes).toBeLessThanOrEqual(2000)
		expect(report.moons).toMatchObject({ readiness: 'missingDependencies', source: 'unavailable', reason: 'targetMissing', miss: { target: 'mimas' } })
	})

	test('reports partial coverage beyond the kernels', async () => {
		const { runtime } = await runtimeOf('automatic', RING_KERNEL, MOON_KERNEL)
		const report = (await (await setup(runtime).routes['/api/saturn/source'].POST(post({ start: Date.UTC(2049, 0, 1), end: Date.UTC(2051, 0, 1) }))).json()) as SaturnSourceReport
		expect(report.rings).toMatchObject({ readiness: 'partialCoverage', source: 'analytical', reason: 'outOfCoverage' })
	})
})
