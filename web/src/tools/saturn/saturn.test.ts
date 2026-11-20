import { describe, expect, test } from 'bun:test'
import type { SaturnElongations, SaturnEvent, SaturnRingTimeline, SaturnSignature } from 'api'
import { proxy } from 'valtio'
import { skyClock } from '../../sky/clock'
import type { PlannerIo } from '../planetary/planetary'
import { chartExtent, gridStep, labeledGridLines, stackLabels } from './MoonChart'
import { calendarTicks } from './RingHistoryChart'
import { createSaturnPlannerState, describeSource, frameHalfWidth, historyRange, listedEvents, listedId, listedPhenomena, loadEvents, loadState, PLANET_HALF_WIDTH, phenomenonName, selectEvent, selectPhenomenon, shownPhenomena } from './saturn'
import { annulusPath, farHalfSign, placeLabels } from './SaturnViewer'

const DAY = 86_400_000

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), { status })
}

// A fake IO answering each request with the next queued responder, recording the requests.
function fakeIo(...responders: ((url: string) => Promise<Response> | Response)[]) {
	const requests: string[] = []
	const io: PlannerIo = {
		fetch: (url) => {
			requests.push(url)
			const next = responders.shift()
			return Promise.resolve(next ? next(url) : json({}))
		},
		time: () => Date.UTC(2026, 10, 1),
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

const signature = (source: SaturnSignature['source']): SaturnSignature => ({ modelVersion: 1, ringModelVersion: 1, scope: 'moons', source, offline: false, generation: 3 })

describe('requests', () => {
	test('a superseded view never replaces a newer one', async () => {
		const state = proxy(createSaturnPlannerState())
		const first = deferred<Response>()
		const { io } = fakeIo(
			() => first.promise,
			() => json({ time: 2, moons: [] }),
		)

		state.time = 1
		const older = loadState(state, io)
		state.time = 2
		const newer = loadState(state, io)
		await newer
		first.resolve(json({ time: 1, moons: [] }))
		await older

		expect(state.moonsState?.time).toBe(2)
	})

	test('a failure of the moons keeps its error', async () => {
		const state = proxy(createSaturnPlannerState())
		state.time = 5
		const { io, requests } = fakeIo(() => json({ error: 'The SPK kernels kept changing during the computation', code: 'generationChanged' }, 503))
		await loadState(state, io)

		expect(requests).toEqual(['/api/saturn/moons/state'])
		expect(state.moonsState).toBeUndefined()
		expect(state.moonsError).toContain('SPK kernels')
	})
})

describe('events', () => {
	const timeline = {
		events: [
			{ kind: 'earthPlaneCrossing', time: 10 * DAY, earthOpening: 0, solarOpening: 0.01 },
			{ kind: 'openingMaximum', time: 40 * DAY, earthOpening: 0.1, solarOpening: 0.05 },
		],
	} as unknown as SaturnRingTimeline
	const elongations = {
		elongations: [
			{ moon: 'titan', time: 12 * DAY, separation: 0.001, positionAngle: 1.5 },
			{ moon: 'iapetus', time: 11 * DAY, separation: 0.003, positionAngle: -1.6 },
		],
	} as unknown as SaturnElongations

	test('the period lists its ring events and the separations of the moons drawn, chronologically', () => {
		const listed = listedEvents(timeline, elongations, { start: 0, end: 20 * DAY }, ['titan'])
		expect(listed.map(listedId)).toEqual([`ring|earthPlaneCrossing|${10 * DAY}`, `separation|titan|${12 * DAY}`])
	})

	test('selecting an event moves only the tool clock', () => {
		const state = proxy(createSaturnPlannerState())
		state.playing = true
		const sky = { ...skyClock }
		const [event] = listedEvents(timeline, undefined, { start: 0, end: 20 * DAY }, [])
		selectEvent(state, event)
		expect(state.time).toBe(10 * DAY)
		expect(state.playing).toBeFalse()
		expect(state.selected).toBe(listedId(event))
		expect({ ...skyClock }).toEqual(sky)
	})
})

describe('helpers', () => {
	test('the history spans a year, a decade, or a Saturnian year around the instant', () => {
		const time = Date.UTC(2026, 10, 1)
		expect(historyRange('year', time)).toEqual({ start: Date.UTC(2026, 0, 1), end: Date.UTC(2027, 0, 1) })
		const decade = historyRange('decade', time)
		expect((decade.end - decade.start) / (365.25 * DAY)).toBeCloseTo(10, 1)
		const season = historyRange('season', time)
		expect((season.end - season.start) / (365.25 * DAY)).toBeCloseTo(29.46, 1)
		expect(season.start % DAY).toBe(0)
	})

	test('the far half of the rings follows the sign of the Earth opening', () => {
		expect(farHalfSign(0.1)).toBe(-1)
		expect(farHalfSign(-0.1)).toBe(1)
		expect(annulusPath(2, 0.5, 1, 0.25)).toBe('M-2,0A2,0.5 0 1 0 2,0A2,0.5 0 1 0 -2,0ZM-1,0A1,0.25 0 1 0 1,0A1,0.25 0 1 0 -1,0Z')
	})

	test('the source names the theories of the scope and why the kernels were not used', () => {
		expect(describeSource(signature({ kind: 'analytical', planetary: 'VSOP87E', fallbackReason: 'noKernel' }))).toBe('VSOP87E, because no SPICE kernel is enabled')
		expect(describeSource(signature({ kind: 'analytical', planetary: 'VSOP87E', satellites: 'TASS1.7', fallbackReason: 'targetMissing' }))).toBe('VSOP87E + TASS 1.7, because no enabled kernel has every body needed')
		expect(describeSource(signature({ kind: 'spk', kernels: { saturn: ['a'], titan: ['a', 'b'] } }))).toBe('SPICE kernels (2 files, generation 3)')
	})
})

describe('phenomena', () => {
	function phenomenon(id: string, kind: SaturnEvent['kind'], moons: SaturnEvent['moons'], start: number = 0, visibility: Partial<SaturnEvent['visibility']> = {}): SaturnEvent {
		return { id, kind, moons, start, maximum: start + 1000, end: start + 2000, contacts: {}, startsBeforeRange: false, endsAfterRange: false, grazing: false, ringInterference: false, overlaps: [], visibility: { status: 'unknownNoSite', windows: [], longestMs: 0, reasons: [], ...visibility } }
	}

	test('are asked for whole, with the site, and listed by kind and moon', async () => {
		const state = proxy(createSaturnPlannerState())
		const { io, requests } = fakeIo(() => json({ start: 0, end: DAY, events: [], nights: [] }))
		const site = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
		await loadEvents(state, { start: 0, end: DAY }, site, io)
		expect(requests).toEqual(['/api/saturn/moons/events'])
		expect(state.eventsLoading).toBeFalse()

		const events = [phenomenon('a', 'satelliteTransit', ['titan']), phenomenon('b', 'mutualEclipse', ['mimas', 'tethys']), phenomenon('c', 'shadowTransit', ['rhea'])]
		expect(listedPhenomena(events, ['satelliteTransit', 'mutualEclipse'], ['tethys', 'titan']).map((e) => e.id)).toEqual(['a', 'b'])
		expect(phenomenonName(events[1])).toBe('Mutual eclipse: Mimas shadowing Tethys')
		expect(phenomenonName(events[2])).toBe('Rhea shadow transit')
	})

	test('selecting one moves only the tool clock', () => {
		const state = proxy(createSaturnPlannerState())
		const sky = { ...skyClock }
		selectPhenomenon(state, { id: 'a', maximum: 1000, moons: ['titan', 'rhea'] })
		expect(state.selectedEvent).toBe('a')
		expect(state.highlight).toEqual(['titan', 'rhea'])
		expect(state.time).toBe(1000)
		expect({ ...skyClock }).toEqual(sky)
	})

	test('the watchable filter keeps what the site can watch, and rank puts the best first', () => {
		const events = [
			phenomenon('late', 'satelliteTransit', ['titan'], 3000, { status: 'observable', rank: 2 }),
			phenomenon('hidden', 'satelliteTransit', ['rhea'], 1000, { status: 'notObservable' }),
			phenomenon('rings', 'shadowTransit', ['dione'], 2000, { status: 'uncertainRingInterference', rank: 1 }),
			phenomenon('early', 'satelliteEclipse', ['tethys'], 0, { status: 'partial', rank: 3 }),
		]
		expect(shownPhenomena(events, 'watchable', true, 'time').map((e) => e.id)).toEqual(['early', 'rings', 'late'])
		expect(shownPhenomena(events, 'watchable', true, 'rank').map((e) => e.id)).toEqual(['rings', 'late', 'early'])
		expect(shownPhenomena(events, 'watchable', false, 'time').map((e) => e.id)).toEqual(['early', 'hidden', 'rings', 'late'])
		expect(shownPhenomena(events, 'all', true, 'rank').map((e) => e.id)).toEqual(['rings', 'late', 'early', 'hidden'])
	})

	test('framing shows the moons taking part with a margin, never closer than the planet', () => {
		const series = (east: number) => ({ east: [east, east], north: [0, 0], depth: [0, 0], disk: [], eclipse: [], ringOverlap: [] })
		const moons = { mimas: series(3), enceladus: series(0), tethys: series(0), dione: series(0), rhea: series(0), titan: series(-20), iapetus: series(0) }
		const track = { times: [0, 1000], moons } as unknown as Parameters<typeof frameHalfWidth>[2]
		expect(frameHalfWidth([], 500, track, 'north', 2)).toBe(PLANET_HALF_WIDTH)
		expect(frameHalfWidth(['mimas'], 500, track, 'north', 2)).toBe(5)
		expect(frameHalfWidth(['mimas', 'titan'], 500, track, 'north', 2)).toBe(22)
		expect(frameHalfWidth(['titan'], 5000, track, 'north', 2)).toBeUndefined()
	})
})

describe('labels', () => {
	test('a label that would cover another moves beside its moon', () => {
		const places = placeLabels(
			[
				{ x: 0, y: 0, r: 1 },
				{ x: 1, y: 0, r: 1 },
			],
			4,
			2,
			0.5,
		)
		expect(places[0]).toEqual({ x: 0, y: -2.5 })
		expect(places[1]).toEqual({ x: 1, y: 2.5 })
	})

	test('end labels spread apart and stay inside the plot', () => {
		expect(stackLabels([50, 52, 10], 12, 0, 100)).toEqual([50, 62, 10])
		expect(stackLabels([98, 99], 12, 0, 100)).toEqual([88, 100])
	})

	test('offset labels thin out from the centre line when the grid is dense', () => {
		expect(labeledGridLines(5, 2, 60)).toEqual([true, true, true, true, true])
		expect(labeledGridLines(7, 3, 25)).toEqual([false, true, false, true, false, true, false])
	})

	test('ring history ticks fall on calendar boundaries', () => {
		const start = Date.UTC(2026, 4, 17)
		expect(calendarTicks(start, Date.UTC(2027, 4, 17), 100).map((tick) => tick.label)).toEqual(['2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03', '2027-04', '2027-05'])
		expect(calendarTicks(start, Date.UTC(2036, 4, 17), 10).map((tick) => tick.label)).toEqual(['2027', '2028', '2029', '2030', '2031', '2032', '2033', '2034', '2035', '2036'])
		expect(calendarTicks(start, Date.UTC(2056, 0, 1), 1).map((tick) => tick.label)).toEqual(['2030', '2035', '2040', '2045', '2050', '2055'])
	})
})

describe('moon chart', () => {
	test('fits the moons drawn, at least the rings, with round grid steps', () => {
		const series = (east: number[]) => ({ east, north: east.map(() => 0), depth: east.map(() => 0), disk: [], eclipse: [], ringOverlap: [] })
		const track = { poleAngle: 0, moons: { mimas: series([3, -3]), iapetus: series([-58, 50]) } } as unknown as Parameters<typeof chartExtent>[0]
		expect(chartExtent(track, ['mimas'], 2.27)).toBeCloseTo(3 * 1.08, 12)
		expect(chartExtent(track, ['mimas', 'iapetus'], 2.27)).toBeCloseTo(58 * 1.08, 12)
		expect(chartExtent(track, [], 2.27)).toBeCloseTo(2.27 * 1.08, 12)
		expect(gridStep(62)).toBe(20)
		expect(gridStep(22)).toBe(10)
		expect(gridStep(3.2)).toBe(1)
	})
})
