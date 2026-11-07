import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { AstroWeatherNights } from './astroweather.night'
import { AppDatabase } from './database'
import { createJupiterRoutes, type JupiterGrsResponse, JupiterPlannerService } from './jupiter'
import type { JupiterEvent, JupiterEvents, JupiterKernels, JupiterSourceReport, JupiterState, JupiterTrack } from './jupiter.astronomy'
import { JupiterGrsStore } from './jupiter.store'
import type { PlanningSite } from './observingplanner.astronomy'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { SpiceKernelRuntime, type SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

const SAO_PAULO: PlanningSite = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
const NEW_YORK: PlanningSite = { name: 'New York', latitude: 40.7128, longitude: -74.006, elevation: 10, timeZone: 'America/New_York' }

const HOUR = 3_600_000
const DAY = 24 * HOUR
const DEC_1 = Date.UTC(2026, 11, 1)

// J2000.0 (TDB) as Unix milliseconds, to within the ~70 s of TT − UTC that the fixture coverages do not care about.
const J2000_MS = Date.UTC(2000, 0, 1, 11, 58, 56)

// TDB seconds past J2000 of a Unix time, for fixture coverages.
function et(time: number) {
	return (time - J2000_MS) / 1000
}

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-jupiter-'))
const runtimes: SpiceKernelRuntime[] = []
let files = 0

// The planner never reaches the network: any fetch fails the test.
const originalFetch = globalThis.fetch
beforeAll(() => {
	globalThis.fetch = Object.assign(() => Promise.reject(new Error('the Jupiter Observing Planner must not use the network')), { preconnect: originalFetch.preconnect })
})
afterAll(() => {
	globalThis.fetch = originalFetch
	rmSync(directory, { recursive: true, force: true })
})
afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime[Symbol.dispose]()
})

// A snapshot of no kernel under a policy.
function noKernels(policy: SpiceEphemerisPolicy = 'automatic'): JupiterKernels {
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

// A complete constant Jovian system over [start, end] (Unix milliseconds); Callisto's segment ends at `callistoEnd`.
function jovianKernel(start: number, end: number, callistoEnd = end): SpkFixtureSegment[] {
	const s = et(start)
	const e = et(end)
	return [
		{ center: 0, target: 10, start: s, end: e, position: [0, 0, 0] },
		{ center: 0, target: 3, start: s, end: e, position: [149600000, 0, 0] },
		{ center: 3, target: 399, start: s, end: e, position: [0, 4000, 0] },
		{ center: 0, target: 5, start: s, end: e, position: [-778000000, 0, 0] },
		{ center: 5, target: 599, start: s, end: e, position: [0, 0, 0] },
		{ center: 5, target: 501, start: s, end: e, position: [0, 421700, 0] },
		{ center: 5, target: 502, start: s, end: e, position: [0, -671000, 0] },
		{ center: 5, target: 503, start: s, end: e, position: [0, 1070400, 0] },
		{ center: 5, target: 504, start: s, end: et(callistoEnd), position: [0, -1882700, 0] },
	]
}

function setup(kernels: JupiterKernels = noKernels()) {
	const database = AppDatabase.memory()
	const published: unknown[] = []
	const store = new JupiterGrsStore(database, (event) => published.push(event))
	const service = new JupiterPlannerService({ kernels, night: (request) => nights.night(request), store })
	return { service, routes: createJupiterRoutes(service), published, store }
}

const nights = new AstroWeatherNights()

function post(body: unknown) {
	return new Request('http://localhost/api/jupiter', { method: 'POST', body: JSON.stringify(body) }) as never
}

function put(body: unknown) {
	return new Request('http://localhost/api/jupiter/grs', { method: 'PUT', body: JSON.stringify(body) }) as never
}

// The events of a kind and moon.
function of(events: readonly JupiterEvent[], kind: JupiterEvent['kind'], moon?: string) {
	return events.filter((e) => e.kind === kind && (moon === undefined || e.moons.includes(moon as never)))
}

describe('Great Red Spot model', () => {
	test('is unconfigured until saved, then saved with its revision and published', async () => {
		const { routes, published } = setup()
		const initial = (await routes['/api/jupiter/grs'].GET().json()) as JupiterGrsResponse
		expect(initial).toMatchObject({ revision: 0, status: { quality: 'unconfigured', revision: 0 } })

		const model = { longitude: 50 * DEG2RAD, referenceTime: Date.now() - 10 * DAY, drift: 0.05 * DEG2RAD }
		const saved = (await (await routes['/api/jupiter/grs'].PUT(put({ model, revision: 0 }))).json()) as JupiterGrsResponse
		expect(saved.revision).toBe(1)
		expect(saved.model).toEqual(model)
		expect(saved.status.quality).toBe('current')
		expect(saved.status.referenceAgeDays).toBeCloseTo(10, 2)
		expect(published).toHaveLength(1)
	})

	test('a save from another revision answers 409 with the current model', async () => {
		const { routes } = setup()
		const model = { longitude: 1, referenceTime: Date.now(), drift: 0 }
		await routes['/api/jupiter/grs'].PUT(put({ model, revision: 0 }))
		const response = await routes['/api/jupiter/grs'].PUT(put({ model: { ...model, longitude: 2 }, revision: 0 }))
		expect(response.status).toBe(409)
		const body = (await response.json()) as { code: string; grs: JupiterGrsResponse }
		expect(body.code).toBe('conflict')
		expect(body.grs.model?.longitude).toBe(1)
	})

	test('an old reference is stale but still used', async () => {
		const { service } = setup()
		service.saveGrs({ model: { longitude: 50 * DEG2RAD, referenceTime: DEC_1 - 120 * DAY, drift: 0 }, revision: 0 })
		const events = await service.events({ start: DEC_1, end: DEC_1 + DAY, kinds: ['grsTransit'] })
		expect(events.grsStatus.quality).toBe('stale')
		expect(events.signature.grsRevision).toBe(1)
		expect(of(events.events, 'grsTransit').length).toBeGreaterThanOrEqual(2)
	})
})

describe('state', () => {
	test('is computed from the analytical theories without kernels', async () => {
		const { routes } = setup()
		const state = (await (await routes['/api/jupiter/state'].POST(post({ time: DEC_1 + 8 * HOUR }))).json()) as JupiterState
		expect(state.signature.source).toEqual({ kind: 'analytical', planetary: 'VSOP87E', satellites: 'L1.2', fallbackReason: 'noKernel' })
		expect(state.moons.map((e) => e.moon)).toEqual(['io', 'europa', 'ganymede', 'callisto'])
		// Io is crossing the disk on 2026-12-01 at 08:00 UTC, with its shadow ahead of it.
		const io = state.moons[0]
		expect(io.disk).toBe('transit')
		expect(io.shadow?.visible).toBeTrue()
		expect(state.disk.equatorialRadius).toBeGreaterThan(0)
		expect(state.grs).toBeUndefined()
		expect(state.grsStatus.quality).toBe('unconfigured')
	})

	test('places the Great Red Spot marker when a model exists', async () => {
		const { service } = setup()
		service.saveGrs({ model: { longitude: 50 * DEG2RAD, referenceTime: DEC_1, drift: 0 }, revision: 0 })
		const state = await service.state({ time: DEC_1 })
		expect(state.grs).toBeDefined()
		expect(state.grs!.longitude).toBeCloseTo(50 * DEG2RAD, 9)
		expect(state.signature.grsRevision).toBe(1)
	})

	test('spkOnly without kernels answers 503 missingDependency', async () => {
		const { routes } = setup(noKernels('spkOnly'))
		const response = await routes['/api/jupiter/state'].POST(post({ time: DEC_1 }))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'missingDependency', reason: 'noKernel' })
	})
})

describe('events', () => {
	test('finds the satellite phenomena of a day with the range flags', async () => {
		const { service } = setup()
		const answer = await service.events({ start: DEC_1 + 8 * HOUR, end: DEC_1 + 9 * HOUR })
		const transit = of(answer.events, 'satelliteTransit', 'io')
		expect(transit).toHaveLength(1)
		// The transit runs from ~07:46 to ~10:07, beyond both ends of the range.
		expect(transit[0].startsBeforeRange).toBeTrue()
		expect(transit[0].endsAfterRange).toBeTrue()
		expect(transit[0].contacts.external1! - (DEC_1 + 7 * HOUR + 46 * 60_000)).toBeLessThan(60_000)
		expect(transit[0].visibility.status).toBe('unknownNoSite')
		expect(answer.nights).toEqual([])
		// The shadow transit overlaps the transit.
		const shadow = of(answer.events, 'shadowTransit', 'io')[0]
		expect(transit[0].overlaps).toContain(shadow.id)
		expect(shadow.overlaps).toContain(transit[0].id)
	})

	test('returns chronological events with stable ids and filters by kind and moon', async () => {
		const { service } = setup()
		const all = await service.events({ start: DEC_1, end: DEC_1 + 2 * DAY })
		for (let i = 1; i < all.events.length; i++) expect(all.events[i].maximum).toBeGreaterThanOrEqual(all.events[i - 1].maximum)
		expect(new Set(all.events.map((e) => e.id)).size).toBe(all.events.length)

		const filtered = await service.events({ start: DEC_1, end: DEC_1 + 2 * DAY, kinds: ['satelliteEclipse'], moons: ['io'] })
		expect(filtered.events.length).toBeGreaterThan(0)
		expect(filtered.events.every((e) => e.kind === 'satelliteEclipse' && e.moons[0] === 'io')).toBeTrue()
		expect(filtered.events.map((e) => e.id)).toEqual(of(all.events, 'satelliteEclipse', 'io').map((e) => e.id))
	})

	test('finds the 2026-12-05 Europa-Ganymede mutual occultation', async () => {
		const { service } = setup()
		const start = Date.UTC(2026, 11, 5, 18)
		const answer = await service.events({ start, end: start + 3 * HOUR, kinds: ['mutualOccultation'] })
		expect(answer.events).toHaveLength(1)
		const event = answer.events[0]
		expect(event.moons).toEqual(['europa', 'ganymede'])
		expect(Math.abs(event.maximum - Date.UTC(2026, 11, 5, 19, 17, 52))).toBeLessThan(15_000)
		expect(event.impactParameter).toBeCloseTo(0.324, 2)
	})

	test('Great Red Spot transits have a viewing window around the central meridian', async () => {
		const { service } = setup()
		service.saveGrs({ model: { longitude: 50 * DEG2RAD, referenceTime: DEC_1, drift: 0.05 * DEG2RAD }, revision: 0 })
		const answer = await service.events({ start: DEC_1, end: DEC_1 + DAY, kinds: ['grsTransit'] })
		const transits = of(answer.events, 'grsTransit')
		expect(transits.length).toBeGreaterThanOrEqual(2)
		expect(transits.length).toBeLessThanOrEqual(3)

		for (const transit of transits) {
			// ±30° of a ~870°/day rotation is ~±50 minutes.
			expect((transit.maximum - transit.start) / 60_000).toBeCloseTo(49.6, 0)
			expect((transit.end - transit.maximum) / 60_000).toBeCloseTo(49.6, 0)
			expect(transit.grs!.longitude).toBeCloseTo((50 + 0.05 * ((transit.maximum - DEC_1) / DAY)) * DEG2RAD, 6)
		}

		// About 9h56m apart.
		expect((transits[1].maximum - transits[0].maximum) / HOUR).toBeCloseTo(9.93, 1)
	})

	test('a site names the evening and judges each event against Jupiter and the Sun', async () => {
		const { service } = setup()
		// Jupiter is near opposition, high in the local night of both sites.
		const answer = await service.events({ start: DEC_1, end: DEC_1 + 2 * DAY, site: NEW_YORK })
		expect(answer.nights.length).toBeGreaterThanOrEqual(2)
		expect(answer.nights.map((e) => e.eveningDate)).toContain('2026-11-30')
		expect(answer.nights.map((e) => e.eveningDate)).toContain('2026-12-01')

		for (const event of answer.events) {
			const { visibility } = event
			expect(visibility.status).not.toBe('unknownNoSite')
			expect(visibility.eveningDate).toBeDefined()
			if (visibility.status === 'notObservable') expect(visibility.reasons.length).toBeGreaterThan(0)
			if (visibility.status === 'observable') expect(visibility.longestMs).toBeGreaterThan(0)
			for (const window of visibility.windows) expect(window.start >= event.start - 1 && window.end <= event.end + 1).toBeTrue()
		}

		// The Io transit at 07:46-10:07 UTC on 2026-12-01 is 02:46-05:07 EST, in the night of the evening of 2026-11-30.
		const transit = of(answer.events, 'satelliteTransit', 'io').find((e) => Math.abs(e.maximum - (DEC_1 + 9 * HOUR)) < HOUR)!
		expect(transit.visibility.eveningDate).toBe('2026-11-30')

		// Ranks number the watchable events from 1, best first.
		const ranked = answer.events.filter((e) => e.visibility.rank !== undefined).sort((a, b) => a.visibility.rank! - b.visibility.rank!)
		expect(ranked.map((e) => e.visibility.rank)).toEqual(ranked.map((_, i) => i + 1))
		for (let i = 1; i < ranked.length; i++) expect(ranked[i].visibility.longestMs).toBeLessThanOrEqual(ranked[i - 1].visibility.longestMs)
	})

	test('daytime events at a site are not observable because of the Sun', async () => {
		const { service } = setup()
		// 2026-12-02 16:00-22:00 UTC is 13:00-19:00 in São Paulo, before sunset: Ganymede's shadow transit falls in it.
		const from = DEC_1 + DAY + 16 * HOUR
		const to = DEC_1 + DAY + 22 * HOUR
		const answer = await service.events({ start: from, end: to, site: SAO_PAULO })
		const daytime = answer.events.filter((e) => e.end < to && e.start > from)
		expect(daytime.length).toBeGreaterThan(0)
		for (const event of daytime) {
			expect(event.visibility.status).toBe('notObservable')
			expect(event.visibility.reasons).toContain('sunTooHigh')
		}
	})

	test('an eclipse whose reappearance is behind the disk is only partly visible', async () => {
		const { service } = setup()
		const answer = await service.events({ start: DEC_1 + DAY, end: DEC_1 + DAY + 12 * HOUR, kinds: ['satelliteEclipse'], moons: ['io'] })
		const eclipse = answer.events[0]
		expect(eclipse.visibility.reasons).toContain('moonHidden')
	})

	test('answers are cached by their inputs', async () => {
		const { service } = setup()
		const a = await service.events({ start: DEC_1, end: DEC_1 + 6 * HOUR })
		expect(await service.events({ start: DEC_1, end: DEC_1 + 6 * HOUR })).toBe(a)
		expect(await service.events({ start: DEC_1, end: DEC_1 + 6 * HOUR, moons: ['io'] })).not.toBe(a)
	})
})

describe('sources', () => {
	test('a complete kernel set is the source, with the kernels of each body', async () => {
		const { runtime, ids } = await runtimeOf('automatic', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY))
		const { service } = setup(runtime)
		const answer = await service.events({ start: DEC_1, end: DEC_1 + DAY })
		expect(answer.signature.source).toEqual({ kind: 'spk', kernels: { sun: ids, earth: ids, jupiter: ids, io: ids, europa: ids, ganymede: ids, callisto: ids } })
		expect(answer.signature.generation).toBe(runtime.current().generation)
		// The fixture system never moves, so it holds no conjunction.
		expect(of(answer.events, 'satelliteTransit')).toEqual([])
	})

	test('a gap in the middle of a scan reruns it whole from the theories', async () => {
		const { runtime } = await runtimeOf('automatic', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY, DEC_1 + 12 * HOUR))
		const { service } = setup(runtime)
		const answer = await service.events({ start: DEC_1, end: DEC_1 + DAY })
		expect(answer.signature.source).toMatchObject({ kind: 'analytical', fallbackReason: 'outOfCoverage', miss: { target: 'callisto', body: 504 } })
		// The rerun found the real phenomena, so no kernel state was mixed in.
		expect(of(answer.events, 'satelliteTransit', 'io').length).toBeGreaterThan(0)
	})

	test('spkOnly refuses a scan the kernels cannot cover', async () => {
		const { runtime } = await runtimeOf('spkOnly', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY, DEC_1 + 12 * HOUR))
		const { routes } = setup(runtime)
		const response = await routes['/api/jupiter/events'].POST(post({ start: DEC_1, end: DEC_1 + DAY }))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'coverageUnavailable', reason: 'outOfCoverage', miss: { target: 'callisto' } })
	})

	test('a planetary kernel alone is not a Jovian source', async () => {
		const planetary = jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY).filter((e) => e.target < 100 || e.target === 399)
		const { runtime } = await runtimeOf('automatic', planetary)
		const { service } = setup(runtime)
		const state = await service.state({ time: DEC_1 })
		expect(state.signature.source).toMatchObject({ kind: 'analytical', fallbackReason: 'targetMissing', miss: { target: 'jupiter', body: 599 } })
	})

	test('a kernel generation change during a scan restarts it on the new snapshot', async () => {
		const { runtime } = await runtimeOf('automatic', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY))
		const snapshot = runtime.current()
		let reads = 0
		// The second read, after the first chunk, sees a new generation once.
		const kernels: JupiterKernels = { current: () => (++reads === 2 ? { ...snapshot, generation: snapshot.generation + 1 } : snapshot) }
		const { service } = setup(kernels)
		const answer = await service.events({ start: DEC_1, end: DEC_1 + DAY })
		expect(answer.signature.source.kind).toBe('spk')
		expect(reads).toBeGreaterThan(4)
	})

	test('a kernel set that keeps changing ends with 503 generationChanged', async () => {
		const { runtime } = await runtimeOf('automatic', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY))
		const snapshot = runtime.current()
		let generation = snapshot.generation
		const kernels: JupiterKernels = { current: () => ({ ...snapshot, generation: generation++ }) }
		const { routes } = setup(kernels)
		const response = await routes['/api/jupiter/events'].POST(post({ start: DEC_1, end: DEC_1 + DAY }))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'generationChanged' })
	})

	test('the readiness probes explain what the kernels lack', async () => {
		expect(setup().service.source({ start: DEC_1, end: DEC_1 + DAY })).toMatchObject({ readiness: 'missingDependencies', source: 'analytical', reason: 'noKernel' })

		const { runtime } = await runtimeOf('spkOnly', jovianKernel(DEC_1 - 10 * DAY, DEC_1 + 10 * DAY, DEC_1 + 12 * HOUR))
		const { routes } = setup(runtime)
		const covered = (await (await routes['/api/jupiter/source'].POST(post({ start: DEC_1 - DAY, end: DEC_1 }))).json()) as JupiterSourceReport
		expect(covered).toMatchObject({ readiness: 'readyForJupiter', source: 'spk', probes: 5 })

		const report = (await (await routes['/api/jupiter/source'].POST(post({ start: DEC_1, end: DEC_1 + DAY }))).json()) as JupiterSourceReport
		expect(report).toMatchObject({ readiness: 'partialCoverage', source: 'unavailable', reason: 'outOfCoverage', miss: { target: 'callisto' } })
	})
})

describe('track', () => {
	test('samples every moon at a whole-minute step within the limit', async () => {
		const { routes } = setup()
		const track = (await (await routes['/api/jupiter/track'].POST(post({ start: DEC_1, end: DEC_1 + 7 * DAY }))).json()) as JupiterTrack
		expect(track.step % 60_000).toBe(0)
		expect(track.times.length).toBeLessThanOrEqual(2000)
		expect(track.times[0]).toBe(DEC_1)
		for (const moon of ['io', 'europa', 'ganymede', 'callisto'] as const) {
			expect(track.moons[moon].east).toHaveLength(track.times.length)
			expect(track.moons[moon].disk).toHaveLength(track.times.length)
		}
		// Callisto never strays beyond ~27 radii from the planet.
		expect(Math.max(...track.moons.callisto.east.map(Math.abs))).toBeLessThan(28)
		expect(track.moons.io.disk).toContain('transit')
		expect(track.moons.io.eclipse).toContain('umbra')
	})

	test('a one-day track is sampled every minute', async () => {
		const { service } = setup()
		const track = await service.track({ start: DEC_1, end: DEC_1 + DAY })
		expect(track.step).toBe(60_000)
		expect(track.times).toHaveLength(1441)
	})
})

describe('events answer shape', () => {
	test('every number of an answer is finite', async () => {
		const { service } = setup()
		const answer: JupiterEvents = await service.events({ start: DEC_1, end: DEC_1 + DAY, site: SAO_PAULO })
		const check = (value: unknown) => {
			if (typeof value === 'number') expect(Number.isFinite(value)).toBeTrue()
			else if (value && typeof value === 'object') for (const entry of Object.values(value)) check(entry)
		}
		check(answer)
	})
})
