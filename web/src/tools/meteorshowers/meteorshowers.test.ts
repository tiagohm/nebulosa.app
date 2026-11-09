import { describe, expect, test } from 'bun:test'
import type { MeteorShowersCalendarEntry, MeteorShowersSources } from 'api'
import { parseRoute, routePath } from '../../shell/route'
import type { PlannerIo } from '../planetary/planetary'
import { meteorCalendarWeeks, shiftMonth } from './MeteorShowerCalendar'
import { calendarRequest, createMeteorShowersState, listQuery, loadNight, loadPage, observingRequest, selectShower } from './meteorshowers'
import { formatOccurrencePeak, formatOccurrencePeriod, formatPeak, occurrenceInstant } from './meteorshowers.format'
import { handleMeteorShowersEvent, type MeteorShowerSourcesState, refreshIauCatalog } from './meteorshowers.sources'

const NOW = Date.UTC(2026, 10, 9, 15)
const DEG = Math.PI / 180
const SITE = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }

function json(body: unknown, status: number = 200) {
	return new Response(JSON.stringify(body), { status })
}

// A fake IO answering each request with the next queued responder, recording the requests.
function fakeIo(...responders: ((url: string) => Response)[]) {
	const requests: { url: string; body?: unknown }[] = []
	const io: PlannerIo = {
		fetch: (url, init) => {
			requests.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined })
			const next = responders.shift()
			return Promise.resolve(next ? next(url) : json({}))
		},
		time: () => NOW,
	}
	return { io, requests }
}

function sources(revision: number): MeteorShowersSources {
	return { iau: { origin: 'refreshed', source: 'IAU Meteor Data Center', version: '2026-11-03', sha256: 'x', url: 'u', recordCount: 1, solutionCount: 1, revision, refreshing: false }, visual: { revision: 1, showerCount: 13, sources: [], annualPredictionYears: [2026, 2027] } }
}

describe('requests', () => {
	test('each section asks for its own listing and the reachable filter needs a latitude', () => {
		const state = createMeteorShowersState()
		expect(listQuery(state, undefined)).toBe('visual=true&sort=nextPeak&offset=0&limit=25')
		expect(listQuery({ ...state, section: 'active', query: ' gem ' }, undefined)).toBe('query=gem&active=true&sort=nextPeak&offset=0&limit=25')
		expect(listQuery({ ...state, section: 'all', status: 'removed', offset: 25 }, undefined)).toBe('status=removed&sort=name&offset=25&limit=25')
		expect(listQuery({ ...state, reachable: true }, undefined)).not.toContain('latitude')
		expect(listQuery({ ...state, reachable: true }, -23.55)).toBe('visual=true&sort=nextPeak&latitude=-23.55&minimumAltitude=20&offset=0&limit=25')
	})

	test('the calendar of the upcoming section is the curated showers, never the removed records', () => {
		expect(calendarRequest('2026-12', 'upcoming')).toEqual({ year: 2026, fromMonth: 12, toMonth: 12, filter: { visual: true } })
		expect(calendarRequest('2027-01', 'all').filter).toEqual({ status: ['established', 'working', 'toBeEstablished'] })
	})

	test('a night asks for the darkness and altitudes in radians, and the evening defaults to tonight', async () => {
		const state = createMeteorShowersState()
		expect(observingRequest({ ...state, darkness: 'nautical', moonSeparation: 30 }, SITE, '2026-12-13')).toMatchObject({ eveningDate: '2026-12-13', maximumSolarAltitude: -12 * DEG, minimumRadiantAltitude: 20 * DEG, minimumMoonSeparation: 30 * DEG })
		selectShower(state, 'iau:4')
		const { io, requests } = fakeIo(() => json({ kind: 'geometric', windows: [], reasons: ['noSupportedActivity'], samples: [] }))
		await loadNight(state, SITE, io)
		expect(state.eveningDate).toBe('2026-11-09')
		expect(requests[0].url).toBe('/api/meteor-showers/iau%3A4/observing')
		expect(state.night?.reasons).toEqual(['noSupportedActivity'])
	})

	test('a failed page shows why and forgets the previous one', async () => {
		const state = createMeteorShowersState()
		await loadPage(state, undefined, fakeIo(() => json({ revision: 0, time: NOW, total: 1, offset: 0, showers: [] })).io)
		expect(state.page?.total).toBe(1)
		await loadPage(state, undefined, fakeIo(() => json({ error: 'down', code: 'x' }, 500)).io)
		expect(state.page).toBeUndefined()
		expect(state.pageError).toBe('down')
	})

	test('selecting another shower forgets the detail and the night of the previous one', () => {
		const state = createMeteorShowersState()
		selectShower(state, 'iau:4')
		state.night = { kind: 'geometric' } as never
		selectShower(state, 'iau:7')
		expect(state.night).toBeUndefined()
		expect(state.detail).toBeUndefined()
	})

	test('a link names a shower by its id', () => {
		expect(parseRoute('/tools/meteor-showers/iau%3A4')).toEqual({ workspace: 'tools', tool: 'meteor-showers', meteorShower: 'iau:4' })
		expect(routePath({ workspace: 'tools', tool: 'meteor-showers', meteorShower: 'iau:4' })).toBe('/tools/meteor-showers/iau%3A4')
		expect(parseRoute('/tools/meteor-showers')).toEqual({ workspace: 'tools', tool: 'meteor-showers' })
	})
})

describe('format', () => {
	test('a maximum is never shown more precisely than its published solar longitude', () => {
		const time = Date.UTC(2026, 11, 14, 13, 41)
		expect(formatPeak(time, 0, 'UTC')).toBe('2026-12-14 (± 1 day)')
		expect(formatPeak(time, 1, 'UTC')).toBe('2026-12-14 13h (± 2 h)')
		expect(formatPeak(time, 2, 'UTC')).toBe('2026-12-14 13:41')
	})

	test('the IAU mean reference is never called a maximum, and a visual period is shown in calendar days', () => {
		const iau = { iau: { start: Date.UTC(2026, 10, 20), end: Date.UTC(2026, 11, 25), reference: Date.UTC(2026, 11, 13) } }
		expect(formatOccurrencePeak(iau, 'UTC')).toBe('IAU reference 2026-12-13 (mean, not a maximum)')
		expect(formatOccurrencePeak(undefined, 'UTC')).toBe('Maximum unknown')
		const visual = { visual: { start: Date.UTC(2026, 11, 4), end: Date.UTC(2026, 11, 21) - 1, peak: Date.UTC(2026, 11, 14, 13), peakSolarLongitude: 262.2 * DEG, peakSolarLongitudeDecimals: 1, typicalZhr: 150, sourceId: 'imo2026' as const } }
		expect(formatOccurrencePeriod(visual, 'America/Sao_Paulo')).toBe('2026-12-04 to 2026-12-20')
		expect(occurrenceInstant({ ...iau, ...visual })).toBe(visual.visual.peak)
	})
})

describe('calendar', () => {
	test('a month marks each maximum on its date and counts the showers active that day', () => {
		const entry = (id: string, start: number, end: number, peak: number): MeteorShowersCalendarEntry => ({ id, name: id, code: id, status: 'established', visual: true, occurrence: { visual: { start, end, peak, peakSolarLongitude: 0, peakSolarLongitudeDecimals: 1, sourceId: 'imo2026' } } })
		const weeks = meteorCalendarWeeks('2026-12', [entry('GEM', Date.UTC(2026, 11, 4), Date.UTC(2026, 11, 21) - 1, Date.UTC(2026, 11, 14, 13)), entry('URS', Date.UTC(2026, 11, 17), Date.UTC(2026, 11, 27) - 1, Date.UTC(2026, 11, 22, 22))], 'UTC')
		const days = weeks.flat()
		expect(weeks.every((week) => week.length === 7)).toBe(true)
		expect(days[0].date).toBe('2026-11-30')
		expect(days.find((day) => day.date === '2026-12-14')!.peaks.map((peak) => peak.id)).toEqual(['GEM'])
		expect(days.find((day) => day.date === '2026-12-18')!.active).toBe(2)
		expect(days.find((day) => day.date === '2026-12-03')!.active).toBe(0)
		expect(shiftMonth('2026-12', 1)).toBe('2027-01')
	})
})

describe('sources', () => {
	test('an event of another tab raises the revision, and an older snapshot never lowers it', () => {
		const state: MeteorShowerSourcesState = { revision: 1, refreshing: false }
		handleMeteorShowersEvent(state, { type: 'meteorShowers:changed', revision: 2, sources: sources(2) })
		expect(state.revision).toBe(2)
		handleMeteorShowersEvent(state, { type: 'meteorShowers:changed', revision: 1, sources: sources(1) })
		expect(state.revision).toBe(2)
	})

	test('a failed refresh keeps the server reason', async () => {
		const state: MeteorShowerSourcesState = { revision: 0, refreshing: false }
		const request = ((url: string) => Promise.resolve(url.endsWith('/refresh') ? json({ error: 'The IAU Meteor Data Center could not be reached', code: 'upstreamUnavailable' }, 502) : json(sources(0)))) as typeof fetch
		expect(await refreshIauCatalog(state, request)).toBe(false)
		expect(state.error).toBe('The IAU Meteor Data Center could not be reached')
		expect(state.refreshing).toBe(false)
	})
})
