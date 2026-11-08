import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { PlanningSite } from './observingplanner.astronomy'
import { createPlanetaryEventsRoutes, PlanetaryEventsService } from './planetaryevents'
import type { PlanetaryEvent, PlanetaryEventBody, PlanetaryEventKind, PlanetaryEventSeries, PlanetaryEventsKernels, PlanetaryEventsSearchRequest } from './planetaryevents.astronomy'
import type { PlanetaryEventsVisibility } from './planetaryevents.visibility'
import { spkFixture, type SpkFixtureSegment } from './spicekernels.fixture'
import { SpiceKernelRuntime, type SpiceKernelSnapshot } from './spicekernels.runtime'
import type { SpiceEphemerisPolicy } from './spicekernels.store'

const DAY = 86_400_000
const DEG = Math.PI / 180
const NOV_8 = Date.UTC(2026, 10, 8)
const KINDS: PlanetaryEventKind[] = ['solarConjunction', 'opposition', 'quadrature', 'greatestElongation', 'station', 'planetaryConjunction', 'planetaryAppulse', 'closestEarthApproach', 'greatestBrightness', 'halfIllumination']

// J2000.0 (TDB) as Unix milliseconds, to within the ~70 s of TT − UTC that the fixture coverages do not care about.
const J2000_MS = Date.UTC(2000, 0, 1, 11, 58, 56)

// TDB seconds past J2000 of a Unix time, for fixture coverages.
function et(time: number) {
	return (time - J2000_MS) / 1000
}

const directory = mkdtempSync(join(tmpdir(), 'nebulosa-planetary-events-'))
const runtimes: SpiceKernelRuntime[] = []
let files = 0

// The almanac never reaches the network: any fetch fails the test.
const originalFetch = globalThis.fetch
beforeAll(() => {
	globalThis.fetch = Object.assign(() => Promise.reject(new Error('Planetary Events must not use the network')), { preconnect: originalFetch.preconnect })
})
afterAll(() => {
	globalThis.fetch = originalFetch
	rmSync(directory, { recursive: true, force: true })
})
afterEach(() => {
	for (const runtime of runtimes.splice(0)) runtime[Symbol.dispose]()
})

// A snapshot of no kernel under a policy.
function noKernels(policy: SpiceEphemerisPolicy = 'automatic'): PlanetaryEventsKernels {
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
	return runtime
}

// Coverage of the fixtures: 2000 to 2050, wide enough for every interpolation node of the tests.
const COVERAGE = { start: et(Date.UTC(2000, 0, 1)), end: et(Date.UTC(2050, 0, 1)) }

// A constant planetary kernel with the Sun, the Earth and Mars's system barycentre, like de440s.
const BARYCENTRE_KERNEL: SpkFixtureSegment[] = [
	{ center: 0, target: 10, ...COVERAGE, position: [0, 0, 0] },
	{ center: 0, target: 3, ...COVERAGE, position: [149600000, 0, 0] },
	{ center: 3, target: 399, ...COVERAGE, position: [0, 4000, 0] },
	{ center: 0, target: 4, ...COVERAGE, position: [-227900000, 10000000, 0] },
]

// Mars's centre on its barycentre, like mar097.bsp.
const MARS_CENTRE_KERNEL: SpkFixtureSegment[] = [{ center: 4, target: 499, ...COVERAGE, position: [0, 0, 0.0002] }]

const SAO_PAULO: PlanningSite = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
const OSLO: PlanningSite = { name: 'Oslo', latitude: 59.91, longitude: 10.75, elevation: 20, timeZone: 'Europe/Oslo' }

function setup(kernels: PlanetaryEventsKernels = noKernels()) {
	const service = new PlanetaryEventsService({ kernels })
	return { service, routes: createPlanetaryEventsRoutes(service) }
}

function post(body: unknown) {
	return new Request('http://localhost/api/planetary-events', { method: 'POST', body: JSON.stringify(body) }) as never
}

function request(bodies: PlanetaryEventBody[], start = NOV_8, end = NOV_8 + 365 * DAY, kinds = KINDS): PlanetaryEventsSearchRequest {
	return { start, end, bodies, kinds, appulseThreshold: 5 * DEG }
}

// Every number of an answer, recursively.
function numbers(value: unknown): number[] {
	if (typeof value === 'number') return [value]
	if (Array.isArray(value)) return value.flatMap(numbers)
	if (value && typeof value === 'object') return Object.values(value).flatMap(numbers)
	return []
}

function find(events: readonly PlanetaryEvent[], kind: PlanetaryEventKind, ...bodies: PlanetaryEventBody[]) {
	return events.filter((e) => e.kind === kind && e.bodies.join() === bodies.join())
}

// One analytical search of Mars, Jupiter and Saturn over a year, shared by the tests that only read it.
const outer = setup()
const year = outer.service.search(request(['499', '599', '699']))

describe('search', () => {
	test('finds the 2027 oppositions and their closest approaches from VSOP87E', async () => {
		const { events, signature } = await year
		expect(signature).toMatchObject({ modelVersion: 1, convention: { position: 'geocentricApparent', longitudeFrame: 'trueEclipticOfDate', distance: 'geometricCenterToCenter' }, source: { kind: 'analytical', planetary: 'VSOP87E', fallbackReason: 'noKernel' }, policy: 'automatic', generation: 0 })
		expect(signature.origins).toBeUndefined()
		// Published oppositions (IMCCE): Jupiter 2027-02-11, Mars 2027-02-19, Saturn 2027-10-18.
		for (const [code, date] of [
			['599', Date.UTC(2027, 1, 11)],
			['499', Date.UTC(2027, 1, 19)],
			['699', Date.UTC(2027, 9, 18)],
		] as const) {
			const [opposition] = find(events, 'opposition', code)
			expect(Math.abs(opposition.time - date - DAY / 2)).toBeLessThan(DAY)
			expect(opposition.kind === 'opposition' && opposition.separation > 170 * DEG).toBeTrue()
			// The closest approach is a separate event, related to the opposition.
			const [closest] = find(events, 'closestEarthApproach', code)
			expect(closest.id).not.toBe(opposition.id)
			expect(opposition.relatedIds).toContain(closest.id)
			expect(closest.relatedIds).toContain(opposition.id)
		}
		expect(numbers(events).every(Number.isFinite)).toBeTrue()
		expect(events.every((e, i) => i === 0 || e.time >= events[i - 1].time)).toBeTrue()
		expect(new Set(events.map((e) => e.id)).size).toBe(events.length)
		// Inner-planet kinds never apply to the outer planets.
		expect(events.some((e) => e.kind === 'greatestElongation' || e.kind === 'halfIllumination' || e.kind === 'greatestBrightness')).toBeFalse()
		for (const event of events) expect(event.circumstances.map((c) => c.body)).toEqual([...event.bodies])
	})

	test('keeps the conjunction and the appulse of a pair as two related events', async () => {
		const { events } = await year
		const [conjunction] = find(events, 'planetaryConjunction', '499', '599')
		const [appulse] = find(events, 'planetaryAppulse', '499', '599')
		expect(conjunction.time).not.toBe(appulse.time)
		expect(Math.abs(conjunction.time - appulse.time)).toBeLessThan(DAY)
		expect(conjunction.relatedIds).toContain(appulse.id)
		expect(appulse.kind === 'planetaryAppulse' && conjunction.kind === 'planetaryConjunction' && appulse.separation <= conjunction.separation).toBeTrue()
		expect(conjunction.kind === 'planetaryConjunction' && ['499', '599'].includes(conjunction.northBody)).toBeTrue()
	})

	test('answers the same events whatever the order of the bodies, from the cache when asked again', async () => {
		const { service } = setup()
		const range = request(['599', '499'], NOV_8, NOV_8 + 30 * DAY, ['planetaryConjunction', 'planetaryAppulse'])
		const reversed = await service.search(range)
		expect(reversed.events.map((e) => e.id)).toEqual(['planetaryAppulse|499-599||' + Math.round(reversed.events[0].time / 1000), 'planetaryConjunction|499-599||' + Math.round(reversed.events[1].time / 1000)])
		expect(await service.search({ ...range, bodies: ['499', '599'] })).toBe(reversed)
	})

	test('never filters a conjunction by the appulse threshold', async () => {
		const { service } = setup()
		const tight = await service.search({ ...request(['499', '599'], NOV_8, NOV_8 + 30 * DAY, ['planetaryConjunction', 'planetaryAppulse']), appulseThreshold: 0.01 * DEG })
		expect(tight.events.map((e) => e.kind)).toEqual(['planetaryConjunction'])
	})

	test('reports an event at a chunk edge once', async () => {
		const { events } = await year
		const [opposition] = find(events, 'opposition', '499')
		const { service } = setup()
		for (const shift of [-60_000, 60_000]) {
			// The 30-day chunk boundary falls a minute before or after the opposition.
			const start = opposition.time - 30 * DAY + shift
			const answer = await service.search(request(['499'], start, start + 60 * DAY, ['opposition']))
			expect(answer.events).toHaveLength(1)
			expect(Math.abs(answer.events[0].time - opposition.time)).toBeLessThan(1000)
		}
	})

	test('finds the inner-planet kinds of Venus', async () => {
		const { events } = await setup().service.search(request(['299'], NOV_8, NOV_8 + 365 * DAY, ['greatestBrightness', 'halfIllumination', 'greatestElongation', 'solarConjunction']))
		expect(find(events, 'greatestBrightness', '299').every((e) => e.kind === 'greatestBrightness' && e.phaseAngle > 90 * DEG && e.phaseAngle < 163.7 * DEG && e.magnitude < -4.5)).toBeTrue()
		expect(find(events, 'greatestBrightness', '299').length).toBeGreaterThan(0)
		expect(find(events, 'halfIllumination', '299').length).toBeGreaterThan(0)
		expect(find(events, 'solarConjunction', '299').every((e) => e.kind === 'solarConjunction' && (e.subtype === 'inferior' || e.subtype === 'superior'))).toBeTrue()
	})

	test('stops an aborted request without an answer and caches nothing', async () => {
		const controller = new AbortController()
		controller.abort()
		const { service } = setup()
		const range = request(['499'], NOV_8, NOV_8 + 90 * DAY, ['station'])
		await expect(service.search(range, controller.signal)).rejects.toThrow()
		const answer = await service.search(range)
		expect(answer.signature.source.kind).toBe('analytical')
	})
})

describe('source', () => {
	test('uses a planet barycentre when the kernels lack its centre, and the centre when present', async () => {
		const range = request(['499'], NOV_8, NOV_8 + 10 * DAY, ['station'])
		const barycentre = await setup(await runtimeOf('automatic', BARYCENTRE_KERNEL)).service.search(range)
		expect(barycentre.signature.source.kind).toBe('spk')
		expect(barycentre.signature.origins).toEqual({ '499': 'barycentre' })
		const centre = await setup(await runtimeOf('automatic', BARYCENTRE_KERNEL, MARS_CENTRE_KERNEL)).service.search(range)
		expect(centre.signature.origins).toEqual({ '499': 'centre' })
	})

	test('falls back whole under automatic and answers 503 under spkOnly when a planet is missing', async () => {
		const range = request(['499', '599'], NOV_8, NOV_8 + 10 * DAY, ['station'])
		const fallback = await setup(await runtimeOf('automatic', BARYCENTRE_KERNEL)).service.search(range)
		expect(fallback.signature.source).toMatchObject({ kind: 'analytical', fallbackReason: 'targetMissing', miss: { target: 'jupiter', body: 5 } })
		const response = await setup(await runtimeOf('spkOnly', BARYCENTRE_KERNEL)).routes['/api/planetary-events/search'].POST(post(range))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'missingDependency', reason: 'targetMissing' })
	})

	test('answers 503 when the kernel generation keeps changing', async () => {
		const runtime = await runtimeOf('automatic', BARYCENTRE_KERNEL)
		let generation = 0
		const changing: PlanetaryEventsKernels = { current: () => ({ ...runtime.current(), generation: generation++ }) }
		const response = await setup(changing).routes['/api/planetary-events/search'].POST(post(request(['499'], NOV_8, NOV_8 + 120 * DAY, ['station'])))
		expect(response.status).toBe(503)
		expect(await response.json()).toMatchObject({ code: 'generationChanged' })
	})
})

describe('visibility', () => {
	async function visibilityOf(site: PlanningSite, ...events: PlanetaryEvent[]) {
		const response = await outer.routes['/api/planetary-events/visibility'].POST(post({ events: events.map(({ id, kind, bodies, time }) => ({ id, kind, bodies, time })), site, appulseThreshold: 5 * DEG }))
		expect(response.status).toBe(200)
		return ((await response.json()) as PlanetaryEventsVisibility).visibility
	}

	test('never changes the events, and differs between sites', async () => {
		const before = await year
		const { events } = before
		const [opposition] = find(events, 'opposition', '599')
		const south = (await visibilityOf(SAO_PAULO, opposition))[opposition.id]
		const north = (await visibilityOf(OSLO, opposition))[opposition.id]
		expect(south.atEvent.bodies[0].altitude).not.toBeCloseTo(north.atEvent.bodies[0].altitude, 2)
		expect(await outer.service.search(request(['499', '599', '699']))).toBe(before)
	})

	test('needs both planets of a pair at once, within the threshold', async () => {
		const { events } = await year
		const [appulse] = find(events, 'planetaryAppulse', '499', '599')
		const visibility = (await visibilityOf(SAO_PAULO, appulse))[appulse.id]
		expect(visibility.profile).toBe('night')
		expect(visibility.atEvent.bodies.map((e) => e.body)).toEqual(['499', '599'])
		const window = visibility.bestWindow!
		expect(window.peakAltitudes).toHaveLength(2)
		for (const peak of window.peakAltitudes) expect(peak).toBeGreaterThanOrEqual(visibility.minimumAltitude - 1e-6)
		expect(window.separation!).toBeLessThanOrEqual(5 * DEG)
		if (visibility.status === 'observable') expect(window.offsetMs).toBe(0)
	})

	test('offers a nearby night for an event that happens in daylight, and never recommends a solar conjunction', async () => {
		const { events } = await year
		const answer = await visibilityOf(SAO_PAULO, ...events)
		const daytime = events.find((e) => e.kind !== 'solarConjunction' && answer[e.id].status === 'nearby')!
		const nearby = answer[daytime.id]
		expect(nearby.atEvent.observable).toBeFalse()
		expect(nearby.bestWindow!.offsetMs).not.toBe(0)
		expect(Math.abs(nearby.bestWindow!.offsetMs)).toBeLessThan(3.5 * DAY)
		for (const event of find(events, 'solarConjunction', '499')) expect(answer[event.id]).toMatchObject({ status: 'notSuitable', reasons: ['solarGlare'] })
		expect(Object.keys(answer)).toHaveLength(events.length)
		expect(numbers(answer).every(Number.isFinite)).toBeTrue()
	})

	test('uses the twilight profile for Mercury and Venus', async () => {
		const { events } = await setup().service.search(request(['199'], NOV_8, NOV_8 + 60 * DAY, ['greatestElongation']))
		const visibility = (await visibilityOf(SAO_PAULO, events[0]))[events[0].id]
		expect(visibility).toMatchObject({ profile: 'twilight', minimumAltitude: 5 * DEG })
	})

	test('stops an aborted batch', async () => {
		const { events } = await year
		const controller = new AbortController()
		controller.abort()
		await expect(setup().service.visibility({ events, site: OSLO, appulseThreshold: 5 * DEG }, controller.signal)).rejects.toThrow()
	})
})

describe('series', () => {
	test('samples display curves around an event without moving it', async () => {
		const { events } = await year
		const [conjunction] = find(events, 'planetaryConjunction', '499', '599')
		const response = await outer.routes['/api/planetary-events/series'].POST(post({ kind: conjunction.kind, bodies: conjunction.bodies, time: conjunction.time }))
		const series = (await response.json()) as PlanetaryEventSeries
		expect(series.time).toBe(conjunction.time)
		expect(series.times.length).toBeLessThanOrEqual(400)
		expect(series.curves.map((c) => c.quantity)).toEqual(['separation', 'longitudeDifference'])
		for (const curve of series.curves) expect(curve.values).toHaveLength(series.times.length)
		// The longitude difference crosses zero near the middle sample, the solved conjunction.
		const middle = Math.floor(series.times.length / 2)
		expect(Math.abs(series.curves[1].values[middle]!)).toBeLessThan(0.5 * DEG)
		expect(numbers(series).every(Number.isFinite)).toBeTrue()
	})
})
