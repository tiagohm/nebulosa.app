import { describe, expect, test } from 'bun:test'
import type { CloseApproach } from 'api'
import { proxy } from 'valtio'
// oxfmt-ignore
import { catalogUrl, clearCloseApproachSelection, type CloseApproachesIo, type CloseApproachesState, displayTimeZone, draftFilters, filterCloseApproachHistory, formatApproachTime, formatDiameter, formatDistance, formatDistanceRange, historyDates, initialCloseApproachesState, initialDraft, loadCloseApproaches, nextSort, openCloseApproaches, pageCloseApproaches, pageCount, periodDates, searchCloseApproaches, selectCloseApproach, setCloseApproachDate, setCloseApproachPeriod, sortCloseApproaches } from './closeapproaches'

// 2026-10-31T12:00:00Z.
const NOW = Date.UTC(2026, 9, 31, 12)

const row = (id: string, designation = id): CloseApproach => ({ id, designation, orbitId: '1', body: 'Earth', jd: '2461348.2', calendarDate: '2026-Nov-03 17:29', time: 1, distance: 0.01, relativeVelocity: 5 })

const page = (rows: readonly CloseApproach[], total = rows.length) => ({ page: 1, pageSize: 50, total, rows, fetchedAt: 1, source: 'CAD', sourceVersion: '1.5' })

const FOUND = { kind: 'found', body: { spkId: '20099942', designation: '99942', name: '99942 Apophis', kind: 'asteroid' }, details: {} }

// Records the requests, answering each through `reply`.
function fakeIo(reply: (url: URL) => Response | Promise<Response> = () => Response.json(page([row('a')]))) {
	const urls: URL[] = []
	const io: CloseApproachesIo = {
		now: () => NOW,
		fetch: async (input) => {
			const url = new URL(input, 'http://localhost')
			urls.push(url)
			return await reply(url)
		},
	}
	return { io, urls }
}

const newState = () => proxy<CloseApproachesState>(initialCloseApproachesState(NOW))

describe('filters', () => {
	test('start on the Earth, the next 30 days, 10 LD, and no NEO filter', () => {
		expect(initialDraft(NOW)).toMatchObject({ dateMin: '2026-10-31', dateMax: '2026-11-30', body: 'Earth', distanceMax: 10, distanceUnit: 'LD', neoOnly: false, kind: 'all' })
	})

	test('presets are spans around today', () => {
		expect(periodDates('next7', NOW)).toEqual(['2026-10-31', '2026-11-07'])
		expect(periodDates('past30', NOW)).toEqual(['2026-10-01', '2026-10-31'])
	})

	test('are read at the boundary, with what is wrong', () => {
		const draft = initialDraft(NOW)
		expect(draftFilters(draft, 'date')).toMatchObject({ dateMin: '2026-10-31', kind: undefined, hMin: undefined })
		expect(draftFilters({ ...draft, kind: 'c', hMin: '18', hMax: '22.5' }, 'date')).toMatchObject({ kind: 'c', hMin: 18, hMax: 22.5 })
		expect(draftFilters({ ...draft, dateMin: '' }, 'date')).toBe('Enter the first and last days.')
		expect(draftFilters({ ...draft, dateMin: '2026-12-01' }, 'date')).toBe('The last day is before the first.')
		expect(draftFilters({ ...draft, dateMin: '2025-01-01', dateMax: '2026-01-02' }, 'date')).toBe('A search spans at most 366 days. Explore a longer time in steps.')
		expect(typeof draftFilters({ ...draft, dateMin: '2025-01-01', dateMax: '2026-01-01' }, 'date')).toBe('object')
		expect(draftFilters({ ...draft, distanceMax: 0 }, 'date')).toBe('Enter a distance above 0.')
		expect(draftFilters({ ...draft, hMin: 'x' }, 'date')).toBe('The absolute magnitude must be a number.')
		expect(draftFilters({ ...draft, hMin: '20', hMax: '18' }, 'date')).toBe('The largest absolute magnitude is below the smallest.')
	})

	test('editing a day makes the span custom, and a preset fills it', () => {
		const state = newState()
		setCloseApproachDate(state, 'dateMin', '2026-12-01')
		expect(state.draft.period).toBe('custom')

		setCloseApproachPeriod(state, 'next7', fakeIo().io)
		expect(state.draft).toMatchObject({ period: 'next7', dateMin: '2026-10-31', dateMax: '2026-11-07' })

		setCloseApproachPeriod(state, 'custom', fakeIo().io)
		expect(state.draft).toMatchObject({ period: 'custom', dateMin: '2026-10-31' })
	})
})

describe('urls', () => {
	test('send only the filters that apply', () => {
		const filters = draftFilters(initialDraft(NOW), 'date')
		if (typeof filters === 'string') throw new Error(filters)

		const { searchParams } = new URL(catalogUrl(filters, 2, 50, false), 'http://localhost')
		expect(Object.fromEntries(searchParams)).toEqual({ dateMin: '2026-10-31', dateMax: '2026-11-30', body: 'Earth', distanceMax: '10', distanceUnit: 'LD', neoOnly: 'false', phaOnly: 'false', sort: 'date', page: '2', pageSize: '50' })
		expect(new URL(catalogUrl({ ...filters, kind: 'c', hMin: 0, hMax: 20 }, 1, 50, true), 'http://localhost').searchParams.get('hMin')).toBe('0')
		expect(new URL(catalogUrl(filters, 1, 50, true), 'http://localhost').searchParams.get('refresh')).toBe('true')
	})

	test('the spans of the history stay within what CAD holds', () => {
		expect(historyDates('5y', NOW)).toEqual(['2021-01-01', '2031-12-31'])
		expect(historyDates('all', NOW)).toEqual(['1900-01-01', '2200-12-31'])
	})
})

describe('catalog', () => {
	test('the first opening searches once, and returning keeps the result', async () => {
		const state = newState()
		const { io, urls } = fakeIo()
		await openCloseApproaches(state, io)
		await openCloseApproaches(state, io)

		expect(urls).toHaveLength(1)
		expect(state.result?.rows).toHaveLength(1)
		expect(state.loading).toBeFalse()
	})

	test('filters it cannot read change nothing', async () => {
		const state = newState()
		const { io, urls } = fakeIo()
		await searchCloseApproaches(state, io)
		state.draft.distanceMax = 0
		await searchCloseApproaches(state, io)

		expect(state.inputError).toBe('Enter a distance above 0.')
		expect(state.result?.rows).toHaveLength(1)
		expect(urls).toHaveLength(1)
	})

	test('a new search restarts from page 1 and forgets the selection', async () => {
		const state = newState()
		const { io, urls } = fakeIo((url) => (url.pathname.endsWith('/objects') ? Response.json(FOUND) : Response.json(page([row('a')], 120))))
		await searchCloseApproaches(state, io)
		await pageCloseApproaches(state, 2, io)
		await selectCloseApproach(state, row('a'), io)
		await searchCloseApproaches(state, io)

		expect(state.page).toBe(1)
		expect(state.selected).toBeUndefined()
		expect(state.object).toBeUndefined()
		expect(urls.at(-1)?.searchParams.get('page')).toBe('1')
	})

	test('sorting asks JPL again from page 1, toggling the direction of the same column', async () => {
		const state = newState()
		const { io, urls } = fakeIo()
		await searchCloseApproaches(state, io)
		await pageCloseApproaches(state, 3, io)
		await sortCloseApproaches(state, 'dist', io)
		expect(urls.at(-1)?.searchParams.get('sort')).toBe('dist')
		expect(urls.at(-1)?.searchParams.get('page')).toBe('1')

		await sortCloseApproaches(state, 'dist', io)
		expect(urls.at(-1)?.searchParams.get('sort')).toBe('-dist')
		expect(nextSort('-dist', 'dist')).toBe('dist')
		expect(nextSort('dist', 'h')).toBe('h')
	})

	test('an old answer never replaces a newer one', async () => {
		const state = newState()
		const first = Promise.withResolvers<Response>()
		const { io } = fakeIo((url) => (url.searchParams.get('page') === '1' ? first.promise : Response.json(page([row('newer')]))))
		const search = searchCloseApproaches(state, io)
		await pageCloseApproaches(state, 2, io)
		first.resolve(Response.json(page([row('older')])))
		await search

		expect(state.result?.rows[0].id).toBe('newer')
		expect(state.loading).toBeFalse()
	})

	test('a failure says why and invents no rows, and the next read clears it', async () => {
		const state = newState()
		let online = false
		const { io } = fakeIo(() => (online ? Response.json(page([row('a')])) : Response.json({ error: 'JPL cannot be reached', code: 'serviceUnavailable' }, { status: 503 })))
		await searchCloseApproaches(state, io)

		expect(state.error).toBe('JPL cannot be reached')
		expect(state.result).toBeUndefined()

		online = true
		await loadCloseApproaches(state, false, io)
		expect(state.error).toBeUndefined()
		expect(state.result?.rows).toHaveLength(1)
	})

	test('a refresh keeps the rows until the answer and asks JPL again', async () => {
		const state = newState()
		const gate = Promise.withResolvers<Response>()
		const { io, urls } = fakeIo((url) => (url.searchParams.has('refresh') ? gate.promise : Response.json(page([row('a')]))))
		await searchCloseApproaches(state, io)
		const refresh = loadCloseApproaches(state, true, io)

		expect(state.loading).toBeTrue()
		expect(state.result?.rows[0].id).toBe('a')
		gate.resolve(Response.json(page([row('b')])))
		await refresh
		expect(state.result?.rows[0].id).toBe('b')
		expect(urls.at(-1)?.searchParams.get('refresh')).toBe('true')
	})
})

describe('selection', () => {
	const objectIo = () => fakeIo((url) => (url.pathname.endsWith('/approaches') ? Response.json(page([row('h')], 13)) : Response.json(FOUND)))

	test('reads the object by its exact designation, then its history by SPK-ID', async () => {
		const state = newState()
		const { io, urls } = objectIo()
		await selectCloseApproach(state, row('e1', '2004 MN4'), io)

		expect(urls[0].searchParams.get('designation')).toBe('2004 MN4')
		expect(urls[1].pathname).toBe('/api/close-approaches/objects/20099942/approaches')
		expect(state.object?.kind).toBe('found')
		expect(state.history?.total).toBe(13)
		expect(state.objectLoading).toBeFalse()
	})

	test('another encounter of the same object reads nothing again', async () => {
		const state = newState()
		const { io, urls } = objectIo()
		await selectCloseApproach(state, row('e1', '99942'), io)
		const reads = urls.length
		await selectCloseApproach(state, row('e2', '99942'), io)

		expect(state.selected?.id).toBe('e2')
		expect(urls).toHaveLength(reads)
	})

	test('an object that cannot be resolved leaves the encounter usable, and selecting it retries', async () => {
		const state = newState()
		let online = false
		const { io } = fakeIo(() => (online ? Response.json(FOUND) : Response.json({ error: 'SBDB cannot be reached' }, { status: 503 })))
		await selectCloseApproach(state, row('e1', '99942'), io)

		expect(state.selected?.id).toBe('e1')
		expect(state.objectError).toBe('SBDB cannot be reached')

		online = true
		await selectCloseApproach(state, row('e1', '99942'), io)
		expect(state.objectError).toBeUndefined()
		expect(state.object?.kind).toBe('found')
	})

	test('an ambiguous or unknown object never reads a history', async () => {
		const state = newState()
		const { io, urls } = fakeIo(() => Response.json({ kind: 'ambiguous', matches: [{ designation: '73P', name: '73P' }] }))
		await selectCloseApproach(state, row('e1', '73P'), io)

		expect(state.object?.kind).toBe('ambiguous')
		expect(urls).toHaveLength(1)
	})

	test('a slow object never lands on a newer selection', async () => {
		const state = newState()
		const slow = Promise.withResolvers<Response>()
		const { io } = fakeIo((url) => (url.searchParams.get('designation') === 'old' ? slow.promise : url.pathname.endsWith('/approaches') ? Response.json(page([])) : Response.json({ ...FOUND, body: { ...FOUND.body, designation: 'new' } })))
		const old = selectCloseApproach(state, row('e1', 'old'), io)
		await selectCloseApproach(state, row('e2', 'new'), io)
		slow.resolve(Response.json(FOUND))
		await old

		expect(state.object).toMatchObject({ body: { designation: 'new' } })
	})

	test('the history filters restart from its first page', async () => {
		const state = newState()
		const { io, urls } = objectIo()
		await selectCloseApproach(state, row('e1', '99942'), io)
		state.historyPage = 3
		await filterCloseApproachHistory(state, { historyBody: 'Moon', historyWindow: '25y' }, io)

		const url = urls.at(-1)!
		expect(url.searchParams.get('body')).toBe('Moon')
		expect(url.searchParams.get('dateMin')).toBe('2001-01-01')
		expect(url.searchParams.get('page')).toBe('1')
	})

	test('clearing abandons what was being read', async () => {
		const state = newState()
		const slow = Promise.withResolvers<Response>()
		const { io } = fakeIo(() => slow.promise)
		const selection = selectCloseApproach(state, row('e1', '99942'), io)
		clearCloseApproachSelection(state)
		slow.resolve(Response.json(FOUND))
		await selection

		expect(state.selected).toBeUndefined()
		expect(state.object).toBeUndefined()
		expect(state.objectLoading).toBeFalse()
	})
})

describe('formats', () => {
	// 0.000254090910419299 au, the approach of Apophis of 2029.
	const APOPHIS = 0.000254090910419299

	test('one instant reads the same in any zone, across a daylight change', () => {
		const time = Date.UTC(2029, 3, 13, 21, 45, 3)
		expect(formatApproachTime(time, 'UTC')).toBe('2029-04-13 21:45:03')
		expect(formatApproachTime(time, 'America/Sao_Paulo')).toBe('2029-04-13 18:45:03')
		expect(formatApproachTime(Date.UTC(2026, 2, 8, 6, 30), 'America/New_York')).toBe('2026-03-08 01:30:00')
		expect(formatApproachTime(Date.UTC(2026, 2, 8, 7, 30), 'America/New_York')).toBe('2026-03-08 03:30:00')
	})

	test("the zone is UTC, the observer's, or the browser's without one", () => {
		expect(displayTimeZone('utc', 'America/Sao_Paulo', 'Europe/Paris')).toBe('UTC')
		expect(displayTimeZone('observer', 'America/Sao_Paulo', 'Europe/Paris')).toBe('America/Sao_Paulo')
		expect(displayTimeZone('observer', undefined, 'Europe/Paris')).toBe('Europe/Paris')
	})

	test('a distance states its unit, the LD being 384400 km', () => {
		expect(formatDistance(APOPHIS, 'au')).toBe('0.0002541 au')
		expect(formatDistance(APOPHIS, 'km')).toBe('38011 km')
		expect(formatDistance(APOPHIS, 'LD')).toBe('0.09889 LD')
	})

	test('the 3-sigma range keeps one unit and tells its ends apart', () => {
		expect(formatDistanceRange(0.000254068999976389, 0.000254112821017663, 'au')).toBe('0.000254069 – 0.000254113 au')
		expect(formatDistanceRange(undefined, 1, 'au')).toBeUndefined()
	})

	test('a diameter names its uncertainty only when there is one', () => {
		expect(formatDiameter(0.34, 0.04)).toBe('0.34 ± 0.04 km')
		expect(formatDiameter(0.34)).toBe('0.34 km')
	})

	test('there is always one page', () => {
		expect(pageCount(0, 50)).toBe(1)
		expect(pageCount(51, 50)).toBe(2)
	})
})
