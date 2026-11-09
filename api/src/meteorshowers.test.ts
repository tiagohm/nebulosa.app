import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { meteorShowerDates } from 'nebulosa/src/astronomy/meteors/solar'
import { timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { AstroWeatherNights } from './astroweather.night'
import { AppDatabase } from './database'
import { createMeteorShowersRoutes, type MeteorShowerDetail, type MeteorShowersChangedEvent, MeteorShowersService } from './meteorshowers'
import { iauOccurrence } from './meteorshowers.astronomy'
import { filterMeteorShowers, indexMeteorCatalog, selectSolution } from './meteorshowers.catalog'
import { MeteorSolarLongitudeTable } from './meteorshowers.solar'
import { MeteorShowerStore } from './meteorshowers.store'
import type { PlanningSite } from './observingplanner.astronomy'

const DEG = Math.PI / 180
const NOW = Date.UTC(2026, 10, 9, 12)
const SAO_PAULO: PlanningSite = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
const NIGHT = { maximumSolarAltitude: -18 * DEG, minimumRadiantAltitude: 20 * DEG }

// A document in the shape of streamfulldata.json (version 2026-11-03): zero-padded numbers, status text with a leading
// space, explicit nulls, a removed solution, a record without a number, a repeated number, and a dated outburst.
function catalog(version = '2026-11-03', extra: readonly object[] = []) {
	const data = [
		{
			IAUNo: '00004',
			Code: 'GEM',
			s: ' 1',
			Name: 'Geminids',
			ProvName: '-',
			solution: [
				{ AdNo: '000', s: ' 1', activity: 'annual', LoSb: null, LoSe: null, LoS: 261.6, Ra: 112.9, De: 32.3, dRa: null, dDe: null, N: 51 },
				{ AdNo: '001', s: '-2', activity: 'annual', LoSb: 240, LoSe: 270, LoS: 261.5, Ra: 113.2, De: 32.5, dRa: 1.02, dDe: -0.15, N: 221 },
				{ AdNo: '005', s: ' 1', activity: '2002/08', LoSb: 240, LoSe: 273, LoS: 261, Ra: 112.6, De: 32.4, dRa: 1.12, dDe: -0.17, N: 10381 },
				{ AdNo: '008', s: ' 1', activity: 'annual', LoSb: 225, LoSe: 273, LoS: 261.6, Ra: 113.1, De: 32.4, dRa: 1.04, dDe: -0.16, N: 104490 },
			],
		},
		{ IAUNo: '00010', Code: 'QUA', s: ' 1', Name: 'Quadrantids', ProvName: '-', solution: [{ AdNo: '008', s: ' 1', activity: 'annual', LoSb: 271, LoSe: 294, LoS: 283.1, Ra: 230.1, De: 49.1, dRa: 0.86, dDe: -0.38, N: 13594 }] },
		{ IAUNo: '00031', Code: 'ETA', s: ' 1', Name: 'eta-Aquariids', ProvName: '-', solution: [{ AdNo: '011', s: ' 1', activity: 'annual', LoSb: 14, LoSe: 100, LoS: 45.7, Ra: 337.6, De: -0.8, dRa: 0.75, dDe: 0.36, N: 46032 }] },
		{ IAUNo: '00089', Code: 'PVI', s: ' 0', Name: 'JanuarypiVirginids', ProvName: '-', solution: [{ AdNo: '000', s: ' 0', activity: 'annual', LoSb: 290, LoSe: 300, LoS: 295, Ra: 180, De: -5, N: 30 }] },
		{ IAUNo: '00089', Code: 'PVI', s: '-2', Name: 'Januarypi-Virginids', ProvName: '-', solution: [{ AdNo: '000', s: '-2', activity: 'annual', LoS: 295, Ra: 181, De: -6 }] },
		{ IAUNo: '-', Code: '', s: ' 0', Name: 'M2023-D1', ProvName: 'M2023-D1', solution: [{ AdNo: '000', s: ' 0', activity: '2023', LoS: 10, Ra: null, De: null }] },
		{ IAUNo: '00900', Code: 'OUT', s: ' 0', Name: 'Outburstids', ProvName: '-', solution: [{ AdNo: '000', s: ' 0', activity: '2024out', LoSb: 100, LoSe: 101, LoS: 100.5, Ra: 40, De: 20, N: 12 }] },
		...extra,
	]
	return JSON.stringify({ source: 'IAU Meteor Data Center', version, count: data.length, fields: {}, data })
}

// A service over a database in memory, a bundled document, and a fake Data Center answering the queued responses.
function setup(options: { readonly bundled?: string; readonly database?: AppDatabase; readonly responses?: (() => Response)[] } = {}) {
	const events: MeteorShowersChangedEvent[] = []
	const requests: string[] = []
	const responses = options.responses ?? []
	const database = options.database ?? AppDatabase.memory()
	const nights = new AstroWeatherNights()
	const service = new MeteorShowersService({
		store: new MeteorShowerStore(database),
		night: (request) => nights.night(request),
		publish: (event) => events.push(event),
		now: () => NOW,
		bundled: () => Promise.resolve(options.bundled ?? catalog('2026-01-01')),
		fetch: (url) => {
			requests.push(url)
			const response = responses.shift()
			return response ? Promise.resolve(response()) : Promise.reject(new Error('offline'))
		},
	})
	return { service, events, requests, database, routes: createMeteorShowersRoutes(service) }
}

// A JSON response of the Data Center.
function json(text: string) {
	return () => new Response(text, { headers: { 'Content-Type': 'application/json' } })
}

// The catalog never reaches the network on its own: any global fetch fails the test.
const originalFetch = globalThis.fetch
beforeAll(() => {
	globalThis.fetch = Object.assign(() => Promise.reject(new Error('Meteor Showers must not use the network')), { preconnect: originalFetch.preconnect })
})
afterAll(() => {
	globalThis.fetch = originalFetch
})

describe('catalog', () => {
	test('a fresh installation answers the bundled catalog offline', async () => {
		const { service, requests } = setup()
		const sources = await service.sources()
		expect(sources.iau).toMatchObject({ origin: 'bundled', version: '2026-01-01', recordCount: 7, solutionCount: 10, revision: 0, refreshing: false })
		expect(sources.visual.showerCount).toBe(3)
		expect((await service.list({})).total).toBe(7)
		expect(requests).toEqual([])
	})

	test('ids come from IAU numbers; a repeated number and an unnumbered record get snapshot ids', () => {
		const index = indexMeteorCatalog(catalog())
		expect(index.showers.map((record) => [record.id, record.identity])).toEqual([
			['iau:4', 'iau'],
			['iau:10', 'iau'],
			['iau:31', 'iau'],
			['iau:89', 'iau'],
			['iau:89~2', 'snapshot'],
			['mdc:M2023-D1', 'snapshot'],
			['iau:900', 'iau'],
		])
	})

	test('the preferred solution is annual, with an interval and a drift, then the largest sample, never a removed one', () => {
		const index = indexMeteorCatalog(catalog())
		const geminids = index.byId.get('iau:4')!
		expect(geminids.solutions[geminids.selected!].solutionId).toBe('008')
		expect(geminids.selectedBy).toBe('ranked')
		expect(geminids.gaps).toEqual([])
		expect(index.byId.get('mdc:M2023-D1')!.selectedBy).toBe('none')
		expect(index.byId.get('mdc:M2023-D1')!.gaps).toEqual(['usableSolution'])
		// The removed solution is never chosen, even with the only interval.
		const removedOnly = indexMeteorCatalog(catalog()).byId.get('iau:89~2')!
		expect(removedOnly.selected).toBeUndefined()
		// Ties keep the lowest solution id, then source order.
		const tie = { activity: { kind: 'annual', source: 'annual' }, rightAscension: 1, declination: 0, memberCount: 5 } as const
		expect(
			selectSolution([
				{ ...tie, solutionId: '002' },
				{ ...tie, solutionId: '001' },
			]).selected,
		).toBe(1)
		expect(selectSolution([tie, tie]).selected).toBe(0)
	})

	test('the search matches numbers exactly and names without diacritics or separators', () => {
		const index = indexMeteorCatalog(catalog())
		expect(filterMeteorShowers(index, { query: '4' }).map((record) => record.id)).toEqual(['iau:4'])
		expect(filterMeteorShowers(index, { query: 'η-Aquariids' }).map((record) => record.id)).toEqual(['iau:31'])
		expect(filterMeteorShowers(index, { query: 'eta aquariids' }).map((record) => record.id)).toEqual(['iau:31'])
		expect(filterMeteorShowers(index, { query: 'Quadrant' }).map((record) => record.id)).toEqual(['iau:10'])
		expect(filterMeteorShowers(index, { status: ['removed'] }).map((record) => record.id)).toEqual(['iau:89~2'])
		expect(filterMeteorShowers(index, { visual: true }).map((record) => record.id)).toEqual(['iau:4', 'iau:10', 'iau:31'])
		expect(filterMeteorShowers(index, { activity: ['outburst'] }).map((record) => record.id)).toEqual(['iau:900'])
		// The Quadrantid radiant (+49°) culminates at 17° from São Paulo, under a 20° threshold.
		expect(filterMeteorShowers(index, { latitude: -23.55, minimumAltitude: 20, visual: true }).map((record) => record.id)).toEqual(['iau:4', 'iau:31'])
	})

	test('a document whose count disagrees with its records is invalid', () => {
		const text = JSON.stringify({ ...JSON.parse(catalog()), count: 99 })
		expect(() => indexMeteorCatalog(text)).toThrow('publishes 99')
	})
})

describe('refresh', () => {
	test('a valid download becomes the catalog in use, survives a restart, and is published once', async () => {
		const database = AppDatabase.memory()
		const { service, events, requests } = setup({ database, responses: [json(catalog('2026-11-03'))] })
		const sources = await service.refresh()
		expect(sources.iau).toMatchObject({ origin: 'refreshed', version: '2026-11-03', revision: 1, url: 'https://iaumdc.astro.sk/downloads/lists_shw_data/streamfulldata.json', retrievedAt: NOW })
		expect(requests).toEqual(['https://iaumdc.astro.sk/downloads/lists_shw_data/streamfulldata.json'])
		expect(events.map((event) => [event.type, event.revision])).toEqual([['meteorShowers:changed', 1]])

		const restarted = setup({ database })
		expect((await restarted.service.sources()).iau).toMatchObject({ origin: 'refreshed', version: '2026-11-03', revision: 1 })
	})

	test('the same document again changes nothing and publishes nothing', async () => {
		const { service, events } = setup({ responses: [json(catalog('2026-11-03')), json(catalog('2026-11-03'))] })
		await service.refresh()
		expect((await service.refresh()).iau.revision).toBe(1)
		expect(events).toHaveLength(1)
	})

	test('concurrent refreshes share one download', async () => {
		const { service, requests } = setup({ responses: [json(catalog('2026-11-03'))] })
		const [a, b] = await Promise.all([service.refresh(), service.refresh()])
		expect(a.iau.revision).toBe(1)
		expect(b.iau.revision).toBe(1)
		expect(requests).toHaveLength(1)
	})

	test('a failed or invalid download keeps the catalog in use and records why', async () => {
		const cases: [() => Response, string, number][] = [
			[() => new Response('down', { status: 503 }), 'upstreamUnavailable', 502],
			[json(catalog('2026-11-03').slice(0, 1000)), 'invalidCatalog', 502],
			[json('[]'), 'invalidCatalog', 502],
			[json(JSON.stringify({ source: 'IAU Meteor Data Center', version: '2026-11-03', data: [JSON.parse(catalog()).data[0]] })), 'invalidCatalog', 502],
			[() => new Response(new ReadableStream({ pull: (controller) => controller.enqueue(new Uint8Array(1024 * 1024)) }), { headers: { 'Content-Type': 'application/json' } }), 'catalogTooLarge', 502],
		]

		for (const [response, code, status] of cases) {
			const { routes, events, service } = setup({ responses: [response] })
			const reply = await routes['/api/meteor-showers/sources/iau/refresh'].POST()
			expect(reply.status).toBe(status)
			expect(((await reply.json()) as { code: string }).code).toBe(code)
			const sources = await service.sources()
			expect(sources.iau).toMatchObject({ origin: 'bundled', version: '2026-01-01', revision: 0, lastErrorCode: code, lastFailureAt: NOW })
			expect(events).toEqual([])
		}
	})

	test('a bundled document dated after the downloaded one is used instead', async () => {
		const database = AppDatabase.memory()
		await setup({ database, responses: [json(catalog('2026-11-03'))] }).service.refresh()
		const upgraded = setup({ database, bundled: catalog('2027-06-01') })
		expect((await upgraded.service.sources()).iau).toMatchObject({ origin: 'bundled', version: '2027-06-01', revision: 1 })
	})
})

describe('dates', () => {
	test('the solar-longitude table dates occurrences as the toolkit does, within a second', () => {
		const index = indexMeteorCatalog(catalog())
		const table = new MeteorSolarLongitudeTable()
		for (const record of index.showers) {
			for (const solution of record.solutions) {
				for (const year of [2025, 2026, 2027]) {
					const core = meteorShowerDates(solution, year, { step: 7, tolerance: 1e-9 })
					const mine = iauOccurrence(solution, year, table)
					expect(mine?.start !== undefined).toBe(core.start !== undefined)
					for (const key of ['start', 'end', 'reference'] as const) if (core[key] !== undefined && solution.activityInterval !== undefined) expect(Math.abs(mine![key]! - timeToUnixMillis(core[key]))).toBeLessThan(1000)
				}
			}
		}
	})

	test('the calendar keeps an occurrence crossing the new year and never repeats a dated outburst', async () => {
		const { service } = setup()
		const january = await service.calendar({ year: 2026, fromMonth: 1, toMonth: 1, filter: { visual: true } })
		const quadrantids = january.entries.find((entry) => entry.id === 'iau:10')!
		expect(new Date(quadrantids.occurrence.visual!.start).toISOString().slice(0, 10)).toBe('2025-12-28')
		expect(new Date(quadrantids.occurrence.visual!.peak).toISOString().slice(0, 10)).toBe('2026-01-03')
		expect(new Date(quadrantids.occurrence.iau!.reference!).toISOString().slice(0, 10)).toBe('2026-01-03')

		expect((await service.calendar({ year: 2024 })).entries.some((entry) => entry.id === 'iau:900')).toBe(true)
		expect((await service.calendar({ year: 2026 })).entries.some((entry) => entry.id === 'iau:900')).toBe(false)
	})

	test('a listing gives the next occurrence first and tells activity apart from unknown', async () => {
		const { service } = setup()
		const page = await service.list({ sort: 'nextPeak' })
		expect(page.showers.slice(0, 3).map((row) => row.id)).toEqual(['iau:4', 'iau:10', 'iau:89'])
		const unknown = page.showers.find((row) => row.id === 'mdc:M2023-D1')!
		expect(unknown.activityNow).toEqual({ state: 'unknown', basis: 'iauScientific' })
		expect(page.showers.find((row) => row.id === 'iau:4')!.activityNow).toEqual({ state: 'inactive', basis: 'imoVisual' })
		expect(page.showers.find((row) => row.id === 'iau:4')!.visual).toMatchObject({ typicalZhr: 150, peakSolarLongitude: 262.2 })
	})
})

describe('positions and nights', () => {
	test('states share one instant, skip unknown ids, and need an observer for altitudes', async () => {
		const { service } = setup()
		const time = Date.UTC(2026, 11, 14, 3)
		const states = await service.states({ ids: ['iau:4', 'nope', 'mdc:M2023-D1'], time, observer: SAO_PAULO })
		expect(states.showers.map((state) => state.id)).toEqual(['iau:4', 'mdc:M2023-D1'])
		expect(states.showers[0]).toMatchObject({ activity: 'active', activityBasis: 'imoVisual' })
		expect(states.showers[0].altitude!).toBeGreaterThan(20 * DEG)
		expect(states.showers[1].radiantJ2000).toBeUndefined()
		expect(states.sunAltitude!).toBeLessThan(0)

		const geocentric = await service.states({ ids: ['iau:4'], time })
		expect(geocentric.showers[0].altitude).toBeUndefined()
		expect(geocentric.showers[0].radiantOfDate).toBeDefined()
		expect(geocentric.sunAltitude).toBeUndefined()
	})

	test('the Sky draws the radiants of active showers only, never a working or year-limited record', async () => {
		const { service } = setup()
		const radiants = await service.radiants({ time: Date.UTC(2026, 11, 14, 3) })
		expect(radiants.radiants.map((radiant) => radiant.id)).toEqual(['iau:4'])
		expect(radiants.radiants[0].rightAscension).toBeCloseTo(113.1 * DEG + 1.04 * DEG * 0.5, 1)
	})

	test('an observing night has geometric windows without a rate, and says why when it has none', async () => {
		const { routes } = setup()
		const post = (id: string, body: object) => routes['/api/meteor-showers/:id/observing'].POST(Object.assign(new Request('http://localhost/', { method: 'POST', body: JSON.stringify(body) }), { params: { id: encodeURIComponent(id) } }) as never)

		const reply = await post('iau:4', { site: SAO_PAULO, eveningDate: '2026-12-13', ...NIGHT })
		expect(reply.status).toBe(200)
		const night = (await reply.json()) as { kind: string; support: { basis: string }; windows: { start: number; end: number; maximumRadiantAltitude: number; support: string }[]; reasons: string[]; samples: unknown[] }
		expect(night.kind).toBe('geometric')
		expect(night.support.basis).toBe('imoVisual')
		expect(night.windows).toHaveLength(1)
		expect(night.windows[0].support).toBe('activity')
		expect(night.windows[0].maximumRadiantAltitude).toBeGreaterThan(30 * DEG)
		expect(Object.keys(night.windows[0])).not.toContain('expectedCount')
		expect(night.reasons).toEqual([])
		expect(night.samples.length).toBeGreaterThan(60)

		const june = (await (await post('iau:4', { site: SAO_PAULO, eveningDate: '2026-06-13', ...NIGHT })).json()) as { reasons: string[] }
		expect(june.reasons).toEqual(['noSupportedActivity'])
		const noRadiant = (await (await post('mdc:M2023-D1', { site: SAO_PAULO, eveningDate: '2026-06-13', ...NIGHT })).json()) as { reasons: string[] }
		expect(noRadiant.reasons).toEqual(['missingRadiant'])
	})

	test('an unknown shower is 404 notFound and a known one answers its every solution', async () => {
		const { routes } = setup()
		const get = (id: string) => routes['/api/meteor-showers/:id'].GET(Object.assign(new Request('http://localhost/'), { params: { id: encodeURIComponent(id) } }) as never)
		const missing = await get('iau:12345')
		expect(missing.status).toBe(404)
		expect(((await missing.json()) as { code: string }).code).toBe('notFound')

		const detail = (await (await get('iau:4')).json()) as MeteorShowerDetail
		expect(detail.solutions).toHaveLength(4)
		expect(detail.selected).toBe(3)
		expect(detail.visualSource?.id).toBe('imo2026')
		expect(detail.annualPredictionAvailable).toBe(true)
	})
})

describe('radiants far from their activity', () => {
	test('a radiant more than 30 days from its reference keeps its catalog position instead of a drifted one', async () => {
		const { service } = setup()
		const june = await service.states({ ids: ['iau:4'], time: Date.UTC(2026, 5, 1) })
		expect(june.showers[0].radiantAtReference).toBe(true)
		expect(june.showers[0].radiantJ2000!.rightAscension).toBeCloseTo(113.1 * DEG, 6)
		const peak = await service.states({ ids: ['iau:4'], time: Date.UTC(2026, 11, 14) })
		expect(peak.showers[0].radiantAtReference).toBeUndefined()
		expect(peak.showers[0].radiantExtrapolated).toBe(true)
	})
})
