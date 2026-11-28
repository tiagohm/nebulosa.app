import { expect, test } from 'bun:test'
import type { AstroWeatherNight, SatelliteEphemerisRow, SatelliteGroundTrackResponse, SatellitePassPrediction, SatelliteSearchPage } from 'api'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import type { SkyClock } from '../../sky/clock'
import type { SkyState } from '../../sky/sky'
import {
	type ArtificialSatellitesIo,
	type ArtificialSatellitesState,
	ensureSatelliteGroundTrack,
	ensureSatellitePasses,
	ensureTonight,
	ephemerisCsv,
	ephemerisDraftError,
	followSatelliteObserver,
	groundTrackInstant,
	initialArtificialSatellitesState,
	loadNextVisiblePass,
	loadSatelliteGroundTrack,
	loadSatellitePasses,
	loadTonight,
	tonightKey,
	type SatelliteSkyHandoff,
	searchSatelliteList,
	selectSatellite,
	showSatelliteInSky,
	tickSatelliteGroundTrack,
} from './artificialsatellites'

const NOW = Date.UTC(2026, 10, 4, 12)
const OBSERVER = { id: 'home', name: 'Home', latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }

interface Call {
	readonly url: string
	readonly body?: unknown
	readonly resolve: (response: Response) => void
}

// API answering each request once released, in any order.
function deferredIo() {
	const calls: Call[] = []
	const io: ArtificialSatellitesIo = {
		fetch: (url, init) =>
			new Promise((resolve) => {
				calls.push({ url, body: init?.body ? JSON.parse(init.body as string) : undefined, resolve })
			}),
		now: () => NOW,
		skyTime: () => NOW + 3_600_000,
	}
	return { io, calls }
}

function page(...ids: string[]): SatelliteSearchPage {
	return { items: ids.map((noradId) => ({ noradId, name: `SAT ${noradId}`, groups: [] })), total: ids.length }
}

function state() {
	return proxy<ArtificialSatellitesState>(initialArtificialSatellitesState())
}

test('the search lists the catalog, or the favorites by id, and asks nothing without favorites', async () => {
	const { io, calls } = routedIo(() => Response.json(page('25544')))
	const signal = new AbortController().signal
	expect((await searchSatelliteList(' iss ', undefined, signal, io)).items[0].noradId).toBe('25544')
	expect(calls[0].url).toBe('/api/satellites?limit=20&q=iss')
	await searchSatelliteList('', ['25544', '800000001'], signal, io)
	expect(calls[1].url).toBe('/api/satellites?limit=20&ids=25544%2C800000001')
	expect(await searchSatelliteList('x', [], signal, io)).toEqual({ items: [], total: 0 })
	expect(calls).toHaveLength(2)
})

test('selecting another satellite drops the predictions of the previous one at once', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.passes = { passes: [], truncated: false } as never
	tool.selectedPass = 0
	const selection = selectSatellite(tool, '48274', OBSERVER, io)
	expect(tool).toMatchObject({ selectedId: '48274', passes: undefined, selectedPass: undefined, ephemeris: undefined })
	expect(calls.map((call) => call.url)).toEqual(['/api/satellites/48274', '/api/satellites/48274/position', '/api/satellites/48274/passes'])
	// The position is asked for now, from the observing site with its elevation, without its name or zone.
	expect(calls[1].body).toEqual({ time: NOW, observer: { latitude: -23.5, longitude: -46.6, elevation: 760 } })
	calls[0].resolve(Response.json({ object: { noradId: '48274', name: 'CSS', groups: [] }, elementSets: [] }))
	calls[1].resolve(Response.json({ error: 'Satellite 48274 has no orbital elements', code: 'noElements' }, { status: 404 }))
	calls[2].resolve(Response.json({ error: 'Satellite 48274 has no orbital elements', code: 'noElements' }, { status: 404 }))
	await selection
	expect(tool.details?.object.name).toBe('CSS')
	expect(tool.positionError).toBe('Satellite 48274 has no orbital elements')
})

test('a pass search sends its window and limits in radians, from the time chosen', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.passDraft = { start: 'sky', days: 30, minAltitude: 10, twilight: 'nautical', showAll: true }
	const search = loadSatellitePasses(tool, OBSERVER, io)
	expect(calls[0].url).toBe('/api/satellites/25544/passes')
	const body = calls[0].body as { observer: unknown; start: number; end: number; minAltitude: number; maxSunAltitude: number }
	expect(body.observer).toEqual({ latitude: -23.5, longitude: -46.6, elevation: 760 })
	expect(body.start).toBe(NOW + 3_600_000)
	expect(body.end - body.start).toBe(7 * 86_400_000)
	expect(body.minAltitude).toBeCloseTo((10 * Math.PI) / 180, 12)
	expect(body.maxSunAltitude).toBeCloseTo((-12 * Math.PI) / 180, 12)
	calls[0].resolve(Response.json({ passes: [{ start: { time: 1 } }], truncated: false, elements: {}, quality: {} }))
	await search
	expect(tool.selectedPass).toBe(0)

	// Without a site nothing is asked.
	await loadSatellitePasses(tool, undefined, io)
	expect(calls).toHaveLength(1)
})

test('another place of the observing site drops the passes and the ephemeris and reads the position again', () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.passes = { passes: [], truncated: false } as never
	tool.selectedPass = 0

	// The first site seen, the same one again, and the same place renamed or in another zone change nothing.
	followSatelliteObserver(tool, OBSERVER, io)
	followSatelliteObserver(tool, { ...OBSERVER }, io)
	const renamed = { ...OBSERVER, name: 'Backyard', timeZone: 'UTC' }
	followSatelliteObserver(tool, renamed, io)
	expect(tool.passes).toBeDefined()
	expect(tool.observerKey).toBe('-23.5,-46.6,760')
	expect(calls).toHaveLength(0)

	// Another elevation is another place.
	followSatelliteObserver(tool, { ...OBSERVER, elevation: 800 }, io)
	expect(tool.passes).toBeUndefined()
	expect(calls[0].body).toEqual({ time: NOW, observer: { latitude: -23.5, longitude: -46.6, elevation: 800 } })
	tool.passes = { passes: [], truncated: false } as never
	tool.selectedPass = 0

	followSatelliteObserver(tool, undefined, io)
	expect(tool).toMatchObject({ passes: undefined, selectedPass: undefined, ephemeris: undefined, observerKey: '' })
	// The next visible pass is read again for the new place, and left absent without a site.
	expect(calls.map((call) => call.url)).toEqual(['/api/satellites/25544/position', '/api/satellites/25544/passes', '/api/satellites/25544/position'])
	expect(calls[2].body).toEqual({ time: NOW })
	expect(tool.nextPass).toBeUndefined()
})

test('an ephemeris draft is checked before it is sent', () => {
	expect(ephemerisDraftError({ start: 'now', hours: 2, stepSeconds: 60 })).toBeUndefined()
	expect(ephemerisDraftError({ start: 'now', hours: 2, stepSeconds: 0 })).toContain('step')
	expect(ephemerisDraftError({ start: 'now', hours: 100, stepSeconds: 60 })).toContain('length')
	expect(ephemerisDraftError({ start: 'now', hours: 72, stepSeconds: 10 })).toContain('rows')
})

test('the ephemeris export is CSV with units in the header, its civil time in the zone it names, and empty cells for absent values', () => {
	const row = {
		time: Date.UTC(2026, 0, 1),
		rightAscension: Math.PI,
		declination: -Math.PI / 4,
		rightAscensionJ2000: Math.PI,
		declinationJ2000: -Math.PI / 4,
		distanceKm: 1000.12345,
		subpointLatitude: 0,
		subpointLongitude: Math.PI / 2,
		heightKm: 420,
		shadow: 'sunlit',
		center: 'geocentric',
		geocentricDistanceKm: 6800,
		constellation: 'ORI',
	} as SatelliteEphemerisRow
	const csv = ephemerisCsv([row], 'UTC')
	const [header, line, end] = csv.split('\r\n')
	expect(header).toBe('time_utc,time_civil,time_zone,ra_of_date_deg,dec_of_date_deg,ra_j2000_deg,dec_j2000_deg,azimuth_deg,altitude_deg,distance_km,range_rate_km_s,subpoint_lat_deg,subpoint_lon_deg,height_km,shadow')
	expect(line).toBe('2026-01-01T00:00:00.000Z,2026-01-01 00:00:00,UTC,180.000000,-45.000000,180.000000,-45.000000,,,1000.123,,0.0000,90.0000,420.000,sunlit')
	expect(end).toBe('')

	// Another zone writes the same instant in its civil time and names it.
	expect(ephemerisCsv([row], 'America/Sao_Paulo').split('\r\n')[1]).toStartWith('2026-01-01T00:00:00.000Z,2025-12-31 21:00:00,America/Sao_Paulo,180.000000,')
})

// Ground track answered for an instant, of a 90-minute orbit.
function groundTrack(time: number) {
	return {
		start: time - 5_400_000,
		end: time + 5_400_000,
		step: 30_000,
		periodMinutes: 90,
		times: [time - 5_400_000, time + 5_400_000],
		latitude: [0, 0],
		longitude: [0, 1],
		heightKm: [420, 420],
		footprint: [0.35, 0.35],
		speedKmPerSecond: [7.66, 7.66],
		shadow: ['sunlit', 'sunlit'],
		shadowEntries: [],
		shadowExits: [],
		sunLatitude: [0, 0],
		sunLongitude: [0, 0],
		truncated: false,
		elements: { digest: 'd', epoch: time, kind: 'gp', sourceKey: 'gp:GROUP:STATIONS' },
		quality: { suitability: 'usable', reasons: [], elementAgeDays: 0, eop: 'covered' },
	} satisfies SatelliteGroundTrackResponse
}

test('a ground track is asked around the instant chosen, and an older answer never replaces a newer one', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.groundTrackDraft = { start: 'sky', orbits: 9 }
	const first = loadSatelliteGroundTrack(tool, io)
	tool.groundTrackDraft.start = 'now'
	const second = loadSatelliteGroundTrack(tool, io)
	expect(calls.map((call) => call.url)).toEqual(['/api/satellites/25544/ground-track', '/api/satellites/25544/ground-track'])
	expect(calls[0].body).toEqual({ time: NOW + 3_600_000, orbits: 5 })
	expect(calls[1].body).toEqual({ time: NOW, orbits: 5 })
	calls[1].resolve(Response.json(groundTrack(NOW)))
	await second
	calls[0].resolve(Response.json(groundTrack(NOW + 3_600_000)))
	await first
	expect(tool.groundTrack?.start).toBe(NOW - 5_400_000)
	expect(tool.groundTrackAnchor).toEqual({ start: 'now', time: NOW })
	expect(groundTrackInstant(tool)).toBe(NOW)
	tool.groundTrackCursor = NOW + 60_000
	expect(groundTrackInstant(tool)).toBe(NOW + 60_000)

	// Another satellite drops it at once, and the answer still on its way is ignored.
	const pending = loadSatelliteGroundTrack(tool, io)
	void selectSatellite(tool, '48274', OBSERVER, io)
	expect(tool).toMatchObject({ groundTrack: undefined, groundTrackAnchor: undefined, groundTrackCursor: undefined, groundTrackLoading: false })
	calls[2].resolve(Response.json(groundTrack(NOW)))
	await pending
	expect(tool.groundTrack).toBeUndefined()
})

test('a ground track following the real time is read again once an orbit has gone by', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	let now = NOW
	const clock: ArtificialSatellitesIo = { ...io, now: () => now }
	tool.selectedId = '25544'
	const load = loadSatelliteGroundTrack(tool, clock)
	calls[0].resolve(Response.json(groundTrack(NOW)))
	await load

	now = NOW + 60 * 60_000
	tickSatelliteGroundTrack(tool, clock)
	expect(tool.groundTrackNow).toBe(now)
	expect(groundTrackInstant(tool)).toBe(now)
	expect(calls).toHaveLength(1)

	// A chosen instant stops following the real time.
	tool.groundTrackCursor = NOW
	now = NOW + 91 * 60_000
	tickSatelliteGroundTrack(tool, clock)
	expect(calls).toHaveLength(1)

	tool.groundTrackCursor = undefined
	tickSatelliteGroundTrack(tool, clock)
	expect(calls).toHaveLength(2)
	expect(calls[1].body).toEqual({ time: now, orbits: 2 })

	// A ground track of the Sky's time never follows the real time.
	tool.groundTrackDraft.start = 'sky'
	const sky = loadSatelliteGroundTrack(tool, clock)
	calls[2].resolve(Response.json(groundTrack(NOW + 3_600_000)))
	await sky
	now = NOW + 10 * 3_600_000
	tickSatelliteGroundTrack(tool, clock)
	expect(calls).toHaveLength(3)
	expect(groundTrackInstant(tool)).toBe(NOW + 3_600_000)
})

test('a ground track is read when its view shows a satellite with elements', () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.details = { object: { noradId: '25544', name: 'ISS', groups: [] }, elementSets: [] } as never
	ensureSatelliteGroundTrack(tool, io)
	tool.tab = 'groundTrack'
	ensureSatelliteGroundTrack(tool, io)
	expect(calls).toHaveLength(0)
	tool.details = { object: { noradId: '25544', name: 'ISS', groups: [] }, elementSets: [], elements: { digest: 'd', epoch: NOW, kind: 'gp', sourceKey: 'gp:GROUP:STATIONS' } } as never
	ensureSatelliteGroundTrack(tool, io)
	ensureSatelliteGroundTrack(tool, io)
	expect(calls).toHaveLength(1)
})

test('Open in Sky selects the satellite and moves the clock only when asked', () => {
	const sky = proxy<SkyState>({ following: false, panel: 'display' })
	const clock = proxy<SkyClock>({ mode: 'now', anchor: 0, startedAt: 0, rate: 1 })
	const route = proxy<RouteState>({ route: { workspace: 'tools' } })
	const bodies: unknown[] = []
	const fetch = (_: string, init?: RequestInit) => {
		if (init?.body) bodies.push(JSON.parse(init.body as string))
		return new Promise<Response>(() => {})
	}
	const handoff: SatelliteSkyHandoff = { sky, clock, route, io: { fetch, time: () => NOW }, history: { pushState: () => undefined } }

	showSatelliteInSky('25544', 'ISS (ZARYA)', OBSERVER, undefined, handoff)
	expect(sky.selection).toMatchObject({ ref: { kind: 'satellite', noradId: '25544' }, key: 'satellite:25544', category: 'satellite', name: 'ISS (ZARYA)' })
	expect(sky.panel).toBe('inspector')
	expect(clock.mode).toBe('now')
	expect(route.route.workspace).toBe('sky')
	// The Sky predicts it for the active site, without its name or zone.
	expect(bodies).toContainEqual(expect.objectContaining({ observer: { latitude: -23.5, longitude: -46.6, elevation: 760 } }))

	showSatelliteInSky('25544', 'ISS (ZARYA)', OBSERVER, NOW, handoff)
	expect(clock).toMatchObject({ mode: 'fixed', anchor: NOW })
})

const HOUR = 3_600_000

// Pass from start to end (Unix milliseconds), visible over the parts given.
function pass(start: number, end: number, visible: readonly (readonly [number, number])[] = []) {
	const point = (time: number, altitude = 0.5) => ({ time, azimuth: 1, altitude, rangeKm: 800 })
	return {
		start: point(start),
		culmination: point((start + end) / 2, 1),
		end: point(end),
		startsBeforeWindow: false,
		endsAfterWindow: false,
		culminationShadow: 'sunlit',
		culminationSunAltitude: -0.3,
		visible: visible.map(([from, to]) => ({ start: from, end: to, culmination: point((from + to) / 2, 0.8) })),
	} satisfies SatellitePassPrediction
}

// Night of the site from noon to noon, with its civil twilight at dusk and dawn, Unix milliseconds.
function night(start: number, dusk: number | undefined, dawn: number | undefined, state: 'normal' | 'continuousAbove' = 'normal') {
	const crossings = { dusk, dawn, state }
	return {
		sun: { start, end: start + 24 * HOUR, localDate: '2026-11-04', sunset: dusk, sunrise: dawn, daylight: crossings, civil: crossings, nautical: crossings, astronomical: crossings, darkness: [] },
		display: { start, end: start + 24 * HOUR },
		moon: { time: start, illuminatedFraction: 0, phase: 'newMoon', above: [] },
	} as unknown as AstroWeatherNight
}

// API answering at once by the path of each request, recording them.
function routedIo(answer: (url: string, body: unknown) => Response) {
	const calls: { url: string; body?: unknown }[] = []
	const io: ArtificialSatellitesIo = {
		fetch: (url, init) => {
			const body = init?.body ? JSON.parse(init.body as string) : undefined
			calls.push({ url, body })
			return Promise.resolve(answer(url, body))
		},
		now: () => NOW,
		skyTime: () => NOW,
	}
	return { io, calls }
}

const QUALITY = { suitability: 'usable', reasons: [], elementAgeDays: 1, eop: 'covered' }

test('tonight is the next night once the morning twilight is past, and lists the visible passes of the favorites in order', async () => {
	const tool = state()
	// The night containing NOW ended its dark part four hours before, so the next one, from its closing noon, is asked for.
	const today = night(NOW - 23 * HOUR, NOW - 16 * HOUR, NOW - 4 * HOUR)
	const next = night(NOW + HOUR, NOW + 10 * HOUR, NOW + 20 * HOUR)
	const { io, calls } = routedIo((url, body) => {
		if (url === '/api/astro-weather/night') return Response.json((body as { time: number }).time === NOW ? today : next)
		if (url.startsWith('/api/satellites?')) return Response.json(page('25544', '48274', '1'))
		if (url === '/api/satellites/25544/passes') return Response.json({ passes: [pass(NOW + 12 * HOUR, NOW + 12.2 * HOUR, [[NOW + 12.1 * HOUR, NOW + 12.2 * HOUR]]), pass(NOW + 15 * HOUR, NOW + 15.1 * HOUR)], truncated: false, quality: QUALITY })
		if (url === '/api/satellites/48274/passes') return Response.json({ passes: [pass(NOW + 11 * HOUR, NOW + 11.2 * HOUR, [[NOW + 11 * HOUR, NOW + 11.1 * HOUR]])], truncated: false, quality: QUALITY })
		return Response.json({ error: 'Satellite 1 has no orbital elements', code: 'noElements' }, { status: 404 })
	})

	await loadTonight(tool, '', ['25544', '48274', '1'], OBSERVER, 'k', io)
	expect(calls[0].body).toEqual({ observer: { latitude: -23.5, longitude: -46.6, elevation: 760 }, timeZone: 'America/Sao_Paulo', time: NOW })
	expect(calls[1].body).toMatchObject({ time: NOW + HOUR })
	// The window runs from the noon starting the next night to the one ending it.
	const passes = calls.find((call) => call.url === '/api/satellites/25544/passes')!.body as { start: number; end: number; maxSunAltitude: number }
	expect(passes.start).toBe(NOW + HOUR)
	expect(passes.end).toBe(NOW + 25 * HOUR)
	expect(passes.maxSunAltitude).toBeCloseTo((-6 * Math.PI) / 180, 12)
	// Passes without a visible part are left out, the others are in the order they appear, and a failure is listed.
	expect(tool.tonight?.passes.map((entry) => entry.name)).toEqual(['SAT 48274', 'SAT 25544'])
	expect(tool.tonight?.failures).toEqual([{ noradId: '1', name: 'SAT 1', error: 'Satellite 1 has no orbital elements' }])
	expect(tool).toMatchObject({ tonightKey: 'k', tonightSelected: undefined, tonightLoading: false })
	expect(tool.tonight).toMatchObject({ predicted: 3, leftOut: 0 })
})

test('tonight searches nothing when the Sun never goes below the twilight limit, and waits for a site and a favorite', async () => {
	const tool = state()
	const { io, calls } = routedIo((url) => Response.json(url.startsWith('/api/satellites?') ? page('25544') : night(NOW - 6 * HOUR, undefined, undefined, 'continuousAbove')))
	await loadTonight(tool, '', ['25544'], OBSERVER, 'k', io)
	expect(calls.map((call) => call.url)).toEqual(['/api/astro-weather/night', '/api/satellites?ids=25544&limit=50'])
	expect(tool.tonight?.passes).toEqual([])
	expect(tool.tonight?.start).toBe(NOW)

	// Shown for the same inputs and a night not over, it is not read again; another key reads it again.
	ensureTonight(tool, '', ['25544'], OBSERVER, 'k', io)
	expect(calls).toHaveLength(2)
	ensureTonight(tool, '', ['25544'], OBSERVER, 'other', io)
	await Bun.sleep(0)
	expect(calls).toHaveLength(4)
	expect(tool.tonightKey).toBe('other')

	// Without a favorite or a site nothing is asked.
	await loadTonight(tool, '', [], OBSERVER, 'k', io)
	await loadTonight(tool, '', ['25544'], undefined, 'k', io)
	expect(calls).toHaveLength(4)
})

test('the next visible pass is the first one with a visible part not over, or null', async () => {
	const tool = state()
	tool.selectedId = '25544'
	let answer = [pass(NOW - HOUR, NOW + HOUR, [[NOW - HOUR, NOW - HOUR / 2]]), pass(NOW + 2 * HOUR, NOW + 3 * HOUR), pass(NOW + 5 * HOUR, NOW + 6 * HOUR, [[NOW + 5 * HOUR, NOW + 5.5 * HOUR]])]
	const { io, calls } = routedIo(() => Response.json({ passes: answer, truncated: false, quality: QUALITY }))

	await loadNextVisiblePass(tool, OBSERVER, io)
	expect(tool.nextPass?.start.time).toBe(NOW + 5 * HOUR)
	const body = calls[0].body as { start: number; end: number; minAltitude: number }
	expect(body.end - body.start).toBe(2 * 24 * HOUR)
	expect(body.minAltitude).toBeCloseTo((10 * Math.PI) / 180, 12)

	answer = [pass(NOW + 2 * HOUR, NOW + 3 * HOUR)]
	await loadNextVisiblePass(tool, OBSERVER, io)
	expect(tool.nextPass).toBeNull()

	// Without a site nothing is asked and the pass is dropped.
	await loadNextVisiblePass(tool, undefined, io)
	expect(calls).toHaveLength(2)
	expect(tool.nextPass).toBeUndefined()
})

test('the passes are searched when their view shows a satellite with elements and a site, once', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	ensureSatellitePasses(tool, OBSERVER, io)
	tool.tab = 'passes'
	ensureSatellitePasses(tool, OBSERVER, io)
	expect(calls).toHaveLength(0)

	tool.details = { object: { noradId: '25544', name: 'ISS', groups: [] }, elementSets: [], elements: { digest: 'd', epoch: NOW, kind: 'gp', sourceKey: 'gp:GROUP:STATIONS' } } as never
	ensureSatellitePasses(tool, undefined, io)
	expect(calls).toHaveLength(0)
	ensureSatellitePasses(tool, OBSERVER, io)
	ensureSatellitePasses(tool, OBSERVER, io)
	expect(calls).toHaveLength(1)

	// Another satellite cancels the search, so the view searches again for it.
	const selection = selectSatellite(tool, '48274', OBSERVER, io)
	expect(tool.passesLoading).toBe(false)
	for (const call of calls.slice(1)) call.resolve(Response.json({ error: 'gone', code: 'notFound' }, { status: 404 }))
	await selection
})

test('tonight lists the first members of a group, counting the others, and keys a group apart from the favorites', async () => {
	const tool = state()
	const { io, calls } = routedIo((url) => {
		if (url === '/api/astro-weather/night') return Response.json(night(NOW - 6 * HOUR, NOW + 6 * HOUR, NOW + 16 * HOUR))
		if (url.startsWith('/api/satellites?')) return Response.json({ ...page('25544'), total: 60 })
		return Response.json({ passes: [pass(NOW + 7 * HOUR, NOW + 7.1 * HOUR, [[NOW + 7 * HOUR, NOW + 7.1 * HOUR]])], truncated: false, quality: QUALITY })
	})

	await loadTonight(tool, 'gp:GROUP:STATIONS', [], OBSERVER, 'k', io)
	expect(calls[1].url).toBe('/api/satellites?group=gp%3AGROUP%3ASTATIONS&limit=50')
	expect(tool.tonight).toMatchObject({ source: 'gp:GROUP:STATIONS', predicted: 1, leftOut: 59 })
	expect(tool.tonight?.passes.map((entry) => entry.name)).toEqual(['SAT 25544'])

	// The favorites do not key a group; the place and the catalog revision do.
	expect(tonightKey('gp:GROUP:STATIONS', ['1'], OBSERVER, 3)).toBe(tonightKey('gp:GROUP:STATIONS', ['2'], OBSERVER, 3))
	expect(tonightKey('', ['1'], OBSERVER, 3)).not.toBe(tonightKey('', ['2'], OBSERVER, 3))
	expect(tonightKey('gp:GROUP:STATIONS', [], OBSERVER, 3)).not.toBe(tonightKey('gp:GROUP:STATIONS', [], OBSERVER, 4))
})
