import { expect, test } from 'bun:test'
import type { SatelliteEphemerisRow, SatelliteGroundTrackResponse, SatelliteSearchPage } from 'api'
import { proxy } from 'valtio'
import type { RouteState } from '../../shell/route'
import type { SkyClock } from '../../sky/clock'
import type { SkyState } from '../../sky/sky'
import {
	type ArtificialSatellitesIo,
	type ArtificialSatellitesState,
	ensureSatelliteGroundTrack,
	ephemerisCsv,
	ephemerisDraftError,
	followSatelliteObserver,
	groundTrackInstant,
	initialArtificialSatellitesState,
	loadSatelliteGroundTrack,
	loadSatellitePasses,
	type SatelliteSkyHandoff,
	searchSatellites,
	selectSatellite,
	showSatelliteInSky,
	tickSatelliteGroundTrack,
} from './artificialsatellites'

const NOW = Date.UTC(2026, 10, 4, 12)
const OBSERVER = { latitude: -23.5, longitude: -46.6, elevation: 760, timeZone: 'America/Sao_Paulo' }

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

test('an older search never replaces a newer one, and favorites are searched by id', async () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.query = 'iss'
	const first = searchSatellites(tool, [], 0, io)
	tool.favoritesOnly = true
	const second = searchSatellites(tool, ['25544', '800000001'], 50, io)
	expect(calls[1].url).toBe('/api/satellites?limit=50&offset=50&q=iss&ids=25544%2C800000001')
	calls[1].resolve(Response.json(page('25544')))
	await second
	calls[0].resolve(Response.json(page('1', '2')))
	await first
	expect(tool.results?.items.map((item) => item.noradId)).toEqual(['25544'])
	expect(tool.offset).toBe(50)

	// Favorites only without favorites asks nothing.
	await searchSatellites(tool, [], 0, io)
	expect(tool.results).toEqual({ items: [], total: 0 })
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
	expect(calls.map((call) => call.url)).toEqual(['/api/satellites/48274', '/api/satellites/48274/position'])
	// The position is asked for now, from the Sky observer with its elevation.
	expect(calls[1].body).toEqual({ time: NOW, observer: { latitude: -23.5, longitude: -46.6, elevation: 760 } })
	calls[0].resolve(Response.json({ object: { noradId: '48274', name: 'CSS', groups: [] }, elementSets: [] }))
	calls[1].resolve(Response.json({ error: 'Satellite 48274 has no orbital elements', code: 'noElements' }, { status: 404 }))
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

	// Without an observer nothing is asked.
	await loadSatellitePasses(tool, undefined, io)
	expect(calls).toHaveLength(1)
})

test('another Sky observer drops the passes and the ephemeris and reads the position again', () => {
	const tool = state()
	const { io, calls } = deferredIo()
	tool.selectedId = '25544'
	tool.passes = { passes: [], truncated: false } as never
	tool.selectedPass = 0

	// The first observer seen, and the same one again, change nothing.
	followSatelliteObserver(tool, OBSERVER, io)
	followSatelliteObserver(tool, { ...OBSERVER }, io)
	expect(tool.passes).toBeDefined()
	expect(calls).toHaveLength(0)

	followSatelliteObserver(tool, undefined, io)
	expect(tool).toMatchObject({ passes: undefined, selectedPass: undefined, ephemeris: undefined, observerKey: '' })
	expect(calls.map((call) => call.url)).toEqual(['/api/satellites/25544/position'])
	expect(calls[0].body).toEqual({ time: NOW })
})

test('an ephemeris draft is checked before it is sent', () => {
	expect(ephemerisDraftError({ start: 'now', hours: 2, stepSeconds: 60 })).toBeUndefined()
	expect(ephemerisDraftError({ start: 'now', hours: 2, stepSeconds: 0 })).toContain('step')
	expect(ephemerisDraftError({ start: 'now', hours: 100, stepSeconds: 60 })).toContain('length')
	expect(ephemerisDraftError({ start: 'now', hours: 72, stepSeconds: 10 })).toContain('rows')
})

test('the ephemeris export is CSV with units in the header and empty cells for absent values', () => {
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
	expect(header).toBe('time_utc,time_local,ra_of_date_deg,dec_of_date_deg,ra_j2000_deg,dec_j2000_deg,azimuth_deg,altitude_deg,distance_km,range_rate_km_s,subpoint_lat_deg,subpoint_lon_deg,height_km,shadow')
	expect(line).toBe('2026-01-01T00:00:00.000Z,2026-01-01 00:00:00,180.000000,-45.000000,180.000000,-45.000000,,,1000.123,,0.0000,90.0000,420.000,sunlit')
	expect(end).toBe('')
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
		shadow: ['sunlit', 'sunlit'],
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
	const sky = proxy<SkyState>({ panel: 'observer' })
	const clock = proxy<SkyClock>({ mode: 'now', anchor: 0, startedAt: 0, rate: 1 })
	const route = proxy<RouteState>({ route: { workspace: 'tools' } })
	const handoff: SatelliteSkyHandoff = { sky, clock, route, io: { fetch: () => new Promise<Response>(() => {}), time: () => NOW }, history: { pushState: () => undefined } }

	showSatelliteInSky('25544', 'ISS (ZARYA)', OBSERVER, undefined, handoff)
	expect(sky.selection).toMatchObject({ ref: { kind: 'satellite', noradId: '25544' }, key: 'satellite:25544', category: 'satellite', name: 'ISS (ZARYA)' })
	expect(clock.mode).toBe('now')
	expect(route.route.workspace).toBe('sky')

	showSatelliteInSky('25544', 'ISS (ZARYA)', OBSERVER, NOW, handoff)
	expect(clock).toMatchObject({ mode: 'fixed', anchor: NOW })
})
