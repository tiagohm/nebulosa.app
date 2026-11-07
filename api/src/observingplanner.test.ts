import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { AstroWeatherNights } from './astroweather.night'
import { AppDatabase } from './database'
import {
	createObservingPlannerRoutes,
	OBSERVING_PRESETS,
	type ObservingConstraints,
	type ObservingDiscoveryPage,
	type ObservingPlan,
	type ObservingPlanEvent,
	type ObservingPlanPreview,
	type ObservingPlanSaveRequest,
	ObservingPlannerService,
	type PlanningSite,
	type TargetAnalysis,
	type TargetAnalysisRequest,
} from './observingplanner'
import { ObservingPlanStore } from './observingplanner.store'
import { fixtureCatalog } from './sky/fixture'
import type { SkyCatalogPage } from './sky/types'

const SAO_PAULO: PlanningSite = { name: 'São Paulo', latitude: -23.55, longitude: -46.633, elevation: 760, timeZone: 'America/Sao_Paulo' }
const NEW_YORK: PlanningSite = { name: 'New York', latitude: 40.7128, longitude: -74.006, elevation: 10, timeZone: 'America/New_York' }
const TROMSO: PlanningSite = { name: 'Tromsø', latitude: 69.6492, longitude: 18.9553, elevation: 0, timeZone: 'Europe/Oslo' }

const M42 = { kind: 'catalog', id: 1001879 } as const
const SIRIUS = { kind: 'catalog', id: 32263 } as const
const M31 = { kind: 'catalog', id: 1000255 } as const

const nights = new AstroWeatherNights()
const events: ObservingPlanEvent[] = []
const service = new ObservingPlannerService({ catalog: fixtureCatalog(), night: (request) => nights.night(request), store: new ObservingPlanStore(AppDatabase.memory()), listener: (event) => events.push(event) })
const routes = createObservingPlannerRoutes(service)

// Request with the path parameters of a route.
function routeRequest(url: string, params: Record<string, string>, init?: RequestInit) {
	return Object.assign(new Request(`http://localhost${url}`, init), { params }) as never
}

// The planner never reaches the network: any fetch fails the test.
const originalFetch = globalThis.fetch
beforeAll(() => {
	globalThis.fetch = Object.assign(() => Promise.reject(new Error('the Observing Planner must not use the network')), { preconnect: originalFetch.preconnect })
})
afterAll(() => {
	globalThis.fetch = originalFetch
})

function analyze(request: Partial<TargetAnalysisRequest> & Pick<TargetAnalysisRequest, 'target'>) {
	return service.analyze({ site: SAO_PAULO, eveningDate: '2026-01-15', constraints: OBSERVING_PRESETS.deepSky, ...request })
}

function expectFinite(analysis: TargetAnalysis) {
	for (const sample of analysis.samples) for (const value of Object.values(sample)) if (value !== undefined) expect(Number.isFinite(value)).toBe(true)
}

describe('catalog', () => {
	test('pages the listing through the route', async () => {
		const first = (await routes['/api/observing-planner/catalog'].GET(new Request('http://localhost/api/observing-planner/catalog?limit=4&classes=star,nebula') as never).json()) as SkyCatalogPage
		expect(first.total).toBe(5)
		expect(first.entries.map((e) => e.ref.id)).toEqual([32263, 27919, 22449, 1001879])
		const rest = (await routes['/api/observing-planner/catalog'].GET(new Request(`http://localhost/api/observing-planner/catalog?limit=4&classes=star,nebula&cursor=${first.nextCursor}`) as never).json()) as SkyCatalogPage
		expect(rest.entries.map((e) => e.ref.id)).toEqual([22509])
		expect(rest.nextCursor).toBeUndefined()
	})
})

describe('analysis', () => {
	test('a winter-sky nebula is observable in one window bounded by the constraints', () => {
		const analysis = analyze({ target: M42 })
		expect(analysis.status).toBe('observable')
		expect(analysis.reasons).toEqual([])
		expect(analysis.name).toBe('Great Orion Nebula')
		expect(analysis.night.sun.localDate).toBe('2026-01-15')
		expect(analysis.windows).toHaveLength(1)
		const [window] = analysis.windows
		expect(window.durationMs).toBe(window.end - window.start)
		expect(window.durationMs).toBeGreaterThan(OBSERVING_PRESETS.deepSky.minimumContinuousMs)
		// The window opens when the Sun reaches −18° (the almanac uses a geocentric Sun, a second away) and closes before dawn.
		expect(window.start).toBeGreaterThanOrEqual(analysis.night.sun.astronomical.dusk! - 5000)
		expect(window.end).toBeLessThanOrEqual(analysis.night.sun.astronomical.dawn! + 5000)
		expect(analysis.score?.value).toBeGreaterThan(50)
		expect(analysis.score?.value).toBeLessThanOrEqual(100)
		expect(analysis.score?.factors.twilight).toBe(1)
		expect(analysis.summary.longestWindowMs).toBe(window.durationMs)
		expect(analysis.summary.culminationAltitude).toBeGreaterThan(60 * DEG2RAD)
		expect(analysis.samples.length).toBeGreaterThan(50)
		expect(analysis.samples.filter((e) => e.score !== undefined).every((e) => e.time >= window.start && e.time <= window.end)).toBe(true)
		expectFinite(analysis)
	})

	test('the reasons name the constraint that leaves nothing', () => {
		// Sirius is behind the Sun in July, M 31 never climbs to 30° from São Paulo, and Tromsø has no astronomical night in June.
		expect(analyze({ target: SIRIUS, eveningDate: '2026-07-15' })).toMatchObject({ status: 'notObservable', reasons: ['notDuringDarkness'], windows: [] })
		expect(analyze({ target: M31, eveningDate: '2026-10-10' })).toMatchObject({ status: 'notObservable', reasons: ['belowMinimumAltitude'] })
		const polar = analyze({ target: M31, site: TROMSO, eveningDate: '2026-06-21' })
		expect(polar.night.sun.darkness).toEqual([])
		expect(polar).toMatchObject({ status: 'notObservable', reasons: ['noAstronomicalDarkness'] })
		expect(analyze({ target: M31, site: TROMSO, eveningDate: '2026-06-21', constraints: OBSERVING_PRESETS.planetary }).reasons).toEqual(['sunTooHigh'])
		const airmass: ObservingConstraints = { ...OBSERVING_PRESETS.deepSky, minimumAltitude: 0, maximumAirmass: 1.01 }
		expect(analyze({ target: M42, constraints: airmass }).reasons).toEqual(['airmassTooHigh'])
		const long: ObservingConstraints = { ...OBSERVING_PRESETS.deepSky, minimumContinuousMs: 20 * 3_600_000 }
		expect(analyze({ target: M42, constraints: long }).reasons).toEqual(['windowTooShort'])
	})

	test('a requested duration longer than every window limits the target', () => {
		const analysis = analyze({ target: M42, requestedDurationMs: 10 * 3_600_000 })
		expect(analysis.status).toBe('limitedDuration')
		expect(analysis.reasons).toEqual(['shorterThanRequested'])
		expect(analysis.score!.factors.duration).toBeLessThan(1)
	})

	test('the lunar separation only applies while the Moon is up', () => {
		// No separation can reach 179°, so every window lies where the Moon is below the horizon.
		const constraints: ObservingConstraints = { ...OBSERVING_PRESETS.visual, minimumMoonSeparation: 179 * DEG2RAD }
		const analysis = analyze({ target: M42, eveningDate: '2026-01-28', constraints })
		const free = analyze({ target: M42, eveningDate: '2026-01-28', constraints: { ...constraints, minimumMoonSeparation: undefined } })
		expect(free.windows.length).toBeGreaterThan(0)
		expect(analysis.summary.totalUsableMs).toBeLessThan(free.summary.totalUsableMs)
		for (const sample of analysis.samples) if (sample.score !== undefined) expect(sample.moonAltitude).toBeLessThanOrEqual(0.001)
	})

	test('fixed coordinates match the catalog object at the same place', () => {
		const catalog = analyze({ target: M42 })
		const coordinates = analyze({ target: { kind: 'coordinates', name: 'Orion', rightAscension: catalog.rightAscension!, declination: catalog.declination! } })
		expect(coordinates.name).toBe('Orion')
		expect(coordinates.windows).toHaveLength(1)
		expect(Math.abs(coordinates.windows[0].start - catalog.windows[0].start)).toBeLessThan(1000)
		expect(Math.abs(coordinates.windows[0].end - catalog.windows[0].end)).toBeLessThan(1000)
	})

	test('a planet moves with its local model', () => {
		const analysis = analyze({ target: { kind: 'body', code: '699' }, eveningDate: '2026-10-10', constraints: OBSERVING_PRESETS.planetary })
		expect(analysis.name).toBe('Saturn')
		expect(analysis.typeName).toBe('Planet')
		expect(analysis.status).toBe('observable')
		expect(analysis.score?.factors.twilight).toBeUndefined()
		expect(analysis.score?.factors.moon).toBeUndefined()
		expectFinite(analysis)
	})

	test('an unknown catalog object is unresolved, not an error', () => {
		expect(analyze({ target: { kind: 'catalog', id: 999 } })).toMatchObject({ status: 'unresolved', reasons: ['unresolvedTarget'], name: 'Catalog object 999', windows: [], samples: [] })
	})

	test('the evening date names the night in the site zone across daylight saving changes', () => {
		for (const eveningDate of ['2026-03-07', '2026-03-08', '2026-10-31', '2026-11-01']) {
			const { night } = analyze({ target: SIRIUS, site: NEW_YORK, eveningDate })
			expect(night.sun.localDate).toBe(eveningDate)
			expect(night.sun.end - night.sun.start).toBeGreaterThan(23 * 3_600_000)
			expect(night.sun.end - night.sun.start).toBeLessThan(25 * 3_600_000)
		}
	})

	test('the route answers the analysis', async () => {
		const request = new Request('http://localhost/api/observing-planner/analyze', { method: 'POST', body: JSON.stringify({ target: M42, site: SAO_PAULO, eveningDate: '2026-01-15', constraints: OBSERVING_PRESETS.deepSky } satisfies TargetAnalysisRequest) })
		const analysis = (await (await routes['/api/observing-planner/analyze'].POST(request as never)).json()) as TargetAnalysis
		expect(analysis.status).toBe('observable')
	})
})

describe('discovery', () => {
	const request = { site: SAO_PAULO, eveningDate: '2026-01-15', constraints: OBSERVING_PRESETS.deepSky, filter: {}, includeBodies: true }

	test('ranks the observable candidates of a batch and counts every evaluated one', async () => {
		const page = await service.discover(request)
		expect(page.total).toBe(7 + 9)
		expect(page.evaluated).toBe(16)
		expect(page.nextCursor).toBeUndefined()
		expect(page.candidates.length).toBeGreaterThan(0)
		for (let i = 1; i < page.candidates.length; i++) expect(page.candidates[i - 1].score).toBeGreaterThanOrEqual(page.candidates[i].score)
		// M 31 never reaches 30° and is left out; the rest match their full analysis.
		expect(page.candidates.some((e) => e.target.kind === 'catalog' && e.target.id === M31.id)).toBe(false)
		const m42 = page.candidates.find((e) => e.target.kind === 'catalog' && e.target.id === M42.id)!
		expect(m42).toMatchObject({ class: 'nebula', constellation: 'Ori', status: 'observable' })
		expect(m42.score).toBe(analyze({ target: M42 }).score!.value)
		expect(await service.discover(request)).toEqual(page)
	})

	test('filters the candidates and leaves the bodies out on request', async () => {
		const page = await service.discover({ ...request, filter: { classes: ['star'] }, includeBodies: false })
		expect(page.total).toBe(4)
		expect(page.candidates.every((e) => e.class === 'star')).toBe(true)
	})

	test('stops when the request is aborted', async () => {
		const controller = new AbortController()
		controller.abort(new Error('left'))
		await expect(service.discover(request, controller.signal)).rejects.toThrow('left')
	})

	test('the route answers a batch', async () => {
		const response = await routes['/api/observing-planner/discover'].POST(new Request('http://localhost/api/observing-planner/discover', { method: 'POST', body: JSON.stringify({ ...request, includeBodies: false }) }) as never)
		const page = (await response.json()) as ObservingDiscoveryPage
		expect(page.evaluated).toBe(7)
	})
})

describe('plans', () => {
	const plan: ObservingPlanSaveRequest = {
		name: 'Orion',
		eveningDate: '2026-01-15',
		site: SAO_PAULO,
		constraints: OBSERVING_PRESETS.deepSky,
		items: [
			{ id: 'a', target: M42, targetName: 'Great Orion Nebula', priority: 3, requestedDurationMs: 3_600_000, notes: '' },
			{ id: 'b', target: SIRIUS, targetName: 'Sirius', priority: 3, requestedDurationMs: 3_600_000, notes: '' },
		],
		revision: 0,
	}

	function put(id: string, body: ObservingPlanSaveRequest) {
		return routes['/api/observing-planner/plans/:id'].PUT(routeRequest(`/api/observing-planner/plans/${id}`, { id }, { method: 'PUT', body: JSON.stringify(body) }))
	}

	test('saves, conflicts, duplicates, and removes, publishing only committed changes', async () => {
		events.length = 0
		const created = (await (await put('p1', plan)).json()) as ObservingPlan
		expect(created.revision).toBe(1)
		expect(events).toEqual([{ type: 'observingPlan:updated', plan: created }])

		const stale = await put('p1', { ...plan, name: 'Stale' })
		expect(stale.status).toBe(409)
		expect(await stale.json()).toMatchObject({ code: 'conflict', plan: { name: 'Orion', revision: 1 } })
		expect(events).toHaveLength(1)

		const copy = await routes['/api/observing-planner/plans/:id/duplicate'].POST(routeRequest('/api/observing-planner/plans/p1/duplicate', { id: 'p1' }, { method: 'POST', body: JSON.stringify({ id: 'p2', name: 'Orion copy' }) }))
		expect(await copy.json()).toMatchObject({ id: 'p2', name: 'Orion copy', revision: 1 })
		expect(((await routes['/api/observing-planner/plans'].GET().json()) as { plans: ObservingPlan[] }).plans.map((e) => e.id).sort()).toEqual(['p1', 'p2'])

		const missing = routes['/api/observing-planner/plans/:id'].GET(routeRequest('/api/observing-planner/plans/none', { id: 'none' }))
		expect(missing.status).toBe(404)
		const conflict = routes['/api/observing-planner/plans/:id'].DELETE(routeRequest('/api/observing-planner/plans/p2?revision=5', { id: 'p2' }, { method: 'DELETE' }))
		expect(conflict.status).toBe(409)
		const removed = routes['/api/observing-planner/plans/:id'].DELETE(routeRequest('/api/observing-planner/plans/p2?revision=1', { id: 'p2' }, { method: 'DELETE' }))
		expect(removed.status).toBe(204)
		expect(events.at(-1)).toEqual({ type: 'observingPlan:removed', id: 'p2' })
		expect(events).toHaveLength(3)
	})

	test('previews the schedule of an unsaved document without changing it', async () => {
		const evening = analyze({ target: M42 }).windows[0]
		const document = {
			...plan,
			items: [
				{ ...plan.items[0], scheduledStartAt: evening.start },
				{ ...plan.items[1], scheduledStartAt: evening.start + 1_800_000 },
			],
		}
		const response = await routes['/api/observing-planner/preview'].POST(routeRequest('/api/observing-planner/preview', {}, { method: 'POST', body: JSON.stringify(document) }))
		const preview = (await response.json()) as ObservingPlanPreview
		expect(preview.night.sun.localDate).toBe('2026-01-15')
		expect(preview.items.map((e) => e.itemId)).toEqual(['a', 'b'])
		expect(preview.items[0].scheduledEndAt).toBe(evening.start + 3_600_000)
		expect(preview.items[0].conflicts).toEqual([{ code: 'overlapsItem', itemId: 'b' }])
		expect(preview.items[1].conflicts.map((e) => e.code)).toContain('overlapsItem')
		expect(preview.totals).toMatchObject({ requestedMs: 7_200_000, scheduledMs: 7_200_000, unscheduled: 0 })
		expect(preview.totals.scopeMs).toBeGreaterThan(0)
	})

	test('an item replaces only the constraints it names', () => {
		const strict = service.preview({ ...plan, items: [{ ...plan.items[0], constraints: { minimumAltitude: 80 * DEG2RAD } }] })
		expect(strict.items[0].analysis.constraints).toEqual({ ...OBSERVING_PRESETS.deepSky, minimumAltitude: 80 * DEG2RAD })
		expect(strict.items[0].conflicts).toEqual([{ code: 'notObservable' }])
	})
})
