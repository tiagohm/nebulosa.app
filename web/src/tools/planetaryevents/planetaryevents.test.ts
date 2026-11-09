import { describe, expect, test } from 'bun:test'
import type { PlanetaryEvent, PlanetaryEventsSearch, PlanetaryEventVisibility } from 'api'
import { proxy } from 'valtio'
import { skyClock } from '../../sky/clock'
import type { PlannerIo } from '../planetary/planetary'
import { addPlanetToPlanner, calendarWeeks, createPlanetaryEventsState, groupByDay, initialize, listedEvents, loadSearch, loadVisibility, rangeEnd, searchRequest, showPlanetInSky, showPlanetInSkyAt, startAtSkyTime } from './planetaryevents'
import { CSV_COLUMNS, eventsCsv, eventTitle, formatOffset, KIND_LABELS, spreadsheetText } from './planetaryevents.format'

const NOW = Date.UTC(2026, 10, 8, 15)
const DEG = Math.PI / 180

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), { status })
}

// A fake IO answering each request with the next queued responder, recording the requests.
function fakeIo(...responders: ((url: string, init?: RequestInit) => Promise<Response> | Response)[]) {
	const requests: { url: string; body?: unknown; method?: string }[] = []
	const io: PlannerIo = {
		fetch: (url, init) => {
			requests.push({ url, method: init?.method, body: init?.body ? JSON.parse(init.body as string) : undefined })
			const next = responders.shift()
			return Promise.resolve(next ? next(url, init) : json({}))
		},
		time: () => NOW,
	}
	return { io, requests }
}

// A promise resolved from outside.
function deferred<T>() {
	let resolve!: (value: T) => void
	const promise = new Promise<T>((r) => {
		resolve = r
	})
	return { promise, resolve }
}

const CIRCUMSTANCES = { longitude: 1, latitude: 0.01, elongation: 3, earthDistance: 0.7, illuminatedFraction: 0.99, magnitude: -1.2 }

function opposition(id: string, time: number): PlanetaryEvent {
	return { id, kind: 'opposition', time, bodies: ['499'], circumstances: [{ body: '499', ...CIRCUMSTANCES }], relatedIds: [], separation: 177 * DEG }
}

function conjunction(id: string, time: number): PlanetaryEvent {
	return {
		id,
		kind: 'planetaryConjunction',
		time,
		bodies: ['499', '599'],
		circumstances: [
			{ body: '499', ...CIRCUMSTANCES },
			{ body: '599', ...CIRCUMSTANCES },
		],
		relatedIds: [],
		separation: 1.2 * DEG,
		northBody: '599',
	}
}

function appulse(id: string, time: number): PlanetaryEvent {
	return {
		id,
		kind: 'planetaryAppulse',
		time,
		bodies: ['499', '599'],
		circumstances: [
			{ body: '499', ...CIRCUMSTANCES },
			{ body: '599', ...CIRCUMSTANCES },
		],
		relatedIds: [],
		separation: 1.1 * DEG,
	}
}

function answer(events: PlanetaryEvent[]): PlanetaryEventsSearch {
	return {
		start: NOW,
		end: rangeEnd(NOW, 12),
		events,
		signature: { modelVersion: 1, convention: { position: 'geocentricApparent', longitudeFrame: 'trueEclipticOfDate', distance: 'geometricCenterToCenter' }, source: { kind: 'analytical', planetary: 'VSOP87E', fallbackReason: 'noKernel' }, policy: 'automatic', generation: 0 },
	}
}

function seen(status: PlanetaryEventVisibility['status']): PlanetaryEventVisibility {
	return {
		status,
		profile: 'night',
		minimumAltitude: 25 * DEG,
		maximumSunAltitude: -6 * DEG,
		atEvent: { bodies: [], sunAltitude: 0, observable: false, lowBodies: [] },
		reasons: [],
		...(status === 'nearby' && { bestWindow: { start: NOW + 3_600_000, end: NOW + 7_200_000, period: 'evening', peakAltitudes: [0.6], offsetMs: 3_600_000 } }),
	}
}

const SITE = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }

describe('range', () => {
	test('opens on real now for twelve months, never on the Sky clock', () => {
		const state = proxy(createPlanetaryEventsState())
		const sky = { ...skyClock }
		initialize(state, fakeIo().io)
		expect(state.start).toBe(NOW)
		expect(searchRequest(state)).toMatchObject({ start: NOW, end: Date.UTC(2027, 10, 8, 15), appulseThreshold: 5 * DEG })
		expect(searchRequest(state)!.bodies).toHaveLength(7)
		expect(searchRequest(state)!.kinds).toHaveLength(10)
		expect({ ...skyClock }).toEqual(sky)
	})

	test('Use Sky Time copies the Sky instant without moving the Sky clock', () => {
		const state = proxy(createPlanetaryEventsState())
		const clock = { mode: 'fixed' as const, anchor: Date.UTC(2030, 0, 1), startedAt: 0, rate: 1 }
		startAtSkyTime(state, clock, fakeIo().io)
		expect(state.start).toBe(Date.UTC(2030, 0, 1))
		expect(clock.anchor).toBe(Date.UTC(2030, 0, 1))
	})
})

describe('requests', () => {
	test('a superseded search never replaces a newer one, and a 503 is the kernels refusing', async () => {
		const state = proxy(createPlanetaryEventsState())
		state.start = NOW
		const first = deferred<Response>()
		const { io, requests } = fakeIo(
			() => first.promise,
			() => json(answer([opposition('b', NOW + 1)])),
		)
		const older = loadSearch(state, io)
		state.months = 3
		await loadSearch(state, io)
		first.resolve(json(answer([opposition('a', NOW)])))
		await older
		expect(state.search?.events.map((e) => e.id)).toEqual(['b'])
		expect(requests[1]).toMatchObject({ url: '/api/planetary-events/search', method: 'POST', body: { start: NOW, end: Date.UTC(2027, 1, 8, 15) } })

		const refused = fakeIo(() => json({ error: 'The SPICE kernels cannot give the planetary states (targetMissing)', code: 'missingDependency' }, 503))
		await loadSearch(state, refused.io)
		expect(state.kernelsRefused).toBeTrue()
		expect(state.search).toBeUndefined()
		expect(state.searchLoading).toBeFalse()
	})

	test('asks for the visibility of every event once per place, never again for a change of zone', async () => {
		const state = proxy(createPlanetaryEventsState())
		state.search = answer([opposition('a', NOW), conjunction('c', NOW + 1000)])
		const { io, requests } = fakeIo(() => json({ visibility: { a: seen('nearby'), c: seen('notObservable') } }))
		await loadVisibility(state, SITE, io)
		expect(requests[0]).toMatchObject({ url: '/api/planetary-events/visibility', body: { site: SITE, appulseThreshold: 5 * DEG } })
		expect((requests[0].body as { events: unknown[] }).events).toEqual([
			{ id: 'a', kind: 'opposition', bodies: ['499'], time: NOW },
			{ id: 'c', kind: 'planetaryConjunction', bodies: ['499', '599'], time: NOW + 1000 },
		])
		await loadVisibility(state, { ...SITE, timeZone: 'UTC' }, io)
		expect(requests).toHaveLength(1)
		expect(state.visibility?.byId.a.status).toBe('nearby')
	})
})

describe('listing', () => {
	test('filters by visibility without dropping events for a missing site', () => {
		const events = [opposition('a', NOW + 2), conjunction('c', NOW), appulse('p', NOW + 1)]
		expect(listedEvents(events, 'all', undefined).map((e) => e.id)).toEqual(['c', 'p', 'a'])
		expect(listedEvents(events, 'unknown', undefined)).toHaveLength(3)
		const visibility = { site: 'x', byId: { a: seen('nearby'), c: seen('notSuitable'), p: seen('observable') } }
		expect(listedEvents(events, 'observable', visibility).map((e) => e.id)).toEqual(['p', 'a'])
		expect(listedEvents(events, 'notObservable', visibility).map((e) => e.id)).toEqual(['c'])
	})

	test('groups by the civil date of the display zone, ordered by the UTC instant', () => {
		// 01:30 UTC on 9 November is still 8 November in São Paulo (UTC−3).
		const late = opposition('late', Date.UTC(2026, 10, 9, 1, 30))
		const early = opposition('early', Date.UTC(2026, 10, 8, 12))
		expect(groupByDay([late, early], 'America/Sao_Paulo')).toEqual([{ date: '2026-11-08', events: [early, late] }])
		expect(groupByDay([late, early], 'UTC').map((g) => g.date)).toEqual(['2026-11-08', '2026-11-09'])
	})

	test('lays out a month Monday first, with the events of each zoned date', () => {
		const event = opposition('a', Date.UTC(2027, 1, 1, 2))
		const weeks = calendarWeeks('2027-01', [event], 'America/Sao_Paulo')
		expect(weeks.every((week) => week.length === 7)).toBeTrue()
		// 1 January 2027 is a Friday.
		expect(weeks[0].slice(0, 4).every((day) => !day.inMonth)).toBeTrue()
		expect(weeks[0][4]).toMatchObject({ date: '2027-01-01', inMonth: true })
		const last = weeks.flat().find((day) => day.date === '2027-01-31')!
		expect(last.events.map((e) => e.id)).toEqual(['a'])
		expect(
			calendarWeeks('2027-02', [event], 'UTC')
				.flat()
				.find((day) => day.date === '2027-02-01')!.events,
		).toHaveLength(1)
	})

	test('names a conjunction and an appulse apart', () => {
		expect(eventTitle(conjunction('c', 0))).toBe(KIND_LABELS.planetaryConjunction)
		expect(eventTitle(appulse('p', 0))).toBe(KIND_LABELS.planetaryAppulse)
		expect(KIND_LABELS.planetaryConjunction).not.toBe(KIND_LABELS.planetaryAppulse)
		expect(formatOffset(0)).toBe('at the event')
		expect(formatOffset(-(2 * 3_600_000 + 5 * 60_000))).toBe('2 h 5 min before')
	})
})

describe('handoffs', () => {
	test('Show in Sky keeps the Sky clock; Set Sky Time to Event is the only change to it', () => {
		const shown: unknown[] = []
		const show = ((target: unknown) => shown.push(target)) as typeof import('../observingplanner/observingplanner').showTargetInSky
		const clock = { mode: 'now' as const, anchor: 0, startedAt: 0, rate: 1 }
		const sky = { ...skyClock }
		showPlanetInSky('499', SITE, show)
		expect({ ...skyClock }).toEqual(sky)
		expect(shown[0]).toEqual({ target: { kind: 'body', code: '499' }, name: 'Mars' })
		showPlanetInSkyAt('599', NOW, SITE, clock, show, fakeIo().io)
		expect(clock).toMatchObject({ mode: 'fixed', anchor: NOW, startedAt: NOW })
		expect(shown[1]).toEqual({ target: { kind: 'body', code: '599' }, name: 'Jupiter' })
	})

	test('adds a planet to the Observing Planner as an independent target', () => {
		const added: unknown[] = []
		addPlanetToPlanner('699', (target) => added.push(target))
		expect(added).toEqual([{ target: { kind: 'body', code: '699' }, name: 'Saturn' }])
	})
})

describe('csv', () => {
	test('exports UTC instants, degrees, empty missing values, and guards spreadsheet formulas', () => {
		const events = [opposition('a', Date.UTC(2027, 1, 19, 15, 50)), conjunction('c', Date.UTC(2026, 10, 16, 6, 23))]
		const text = eventsCsv(events, { a: seen('nearby') }, '=HYPERLINK("x")', answer(events).signature)
		const [header, first, second] = text.split('\r\n')
		expect(header).toBe(CSV_COLUMNS.join(','))
		expect(text.endsWith('\r\n')).toBeTrue()
		const a = first.split(',')
		expect(a[3]).toBe('2027-02-19T15:50:00.000Z')
		expect(a[5]).toBe('177.0000')
		expect(a[10]).toBe('nearby')
		expect(a[11]).toBe(new Date(NOW + 3_600_000).toISOString())
		expect(first).toContain(`"'=HYPERLINK(""x"")"`)
		// A pair leaves its single-planet columns empty, and no visibility reads unknown.
		const c = second.split(',')
		expect(c[2]).toBe('Mars-Jupiter')
		expect(c[7]).toBe('')
		expect(c[10]).toBe('unknownNoSite')
		expect(spreadsheetText('-1')).toBe("'-1")
		expect(spreadsheetText('São Paulo')).toBe('São Paulo')
	})
})
