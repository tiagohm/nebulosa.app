import { expect, test } from 'bun:test'
import type { EarthOrientationCoverage } from './astronomicaltime.eop'
import { AppDatabase } from './database'
import { createSatelliteRoutes, type SatelliteDetails, type SatelliteImportResponse, type SatellitePassesResponse, type SatellitePositionResponse, type SatelliteRefreshResponse, SatelliteService, type SatellitesChangedEvent, type SatelliteSourcesSnapshot, type SatelliteTracksResponse } from './satellites'
import { SatelliteEphemeris } from './satellites.ephemeris'
import { type SatelliteSearchPage, SatelliteStore } from './satellites.store'
import { SatelliteSync } from './satellites.sync'

type Routes = ReturnType<typeof createSatelliteRoutes>
type Handler = (req: Request) => Response | Promise<Response>

// Status and JSON body of a route's answer, the body typed as the route documents it.
interface Reply<T> {
	readonly status: number
	readonly body: T
}

const DAY = 86_400_000
const SITE = { latitude: -23.5475, longitude: -46.6361, elevation: 760 }
const ISS_TLE = 'ISS (ZARYA)\n1 25544U 98067A   23231.51768399  .00014050  00000+0  25837-3 0  9996\n2 25544  51.6415  14.7889 0003559 325.3396 149.4637 15.49477580411611'
const ISS_EPOCH = Date.UTC(2023, 7, 19, 12, 25, 27, 897)

function gp(noradId: number, name: string) {
	return {
		OBJECT_NAME: name,
		OBJECT_ID: '1998-067A',
		EPOCH: '2023-08-19T12:25:27.896736',
		MEAN_MOTION: 15.4947758,
		ECCENTRICITY: 0.0003559,
		INCLINATION: 51.6415,
		RA_OF_ASC_NODE: 14.7889 + noradId / 1000,
		ARG_OF_PERICENTER: 325.3396,
		MEAN_ANOMALY: 149.4637,
		NORAD_CAT_ID: noradId,
		ELEMENT_SET_NO: 999,
		BSTAR: 0.00025837,
		MEAN_MOTION_DOT: 0.0001405,
		MEAN_MOTION_DDOT: 0,
	}
}

// A service over a catalog in memory and a fake CelesTrak answering the queued bodies.
function setup(...bodies: unknown[][]) {
	const events: SatellitesChangedEvent[] = []
	const requests: string[] = []
	const fetch = (url: string) => {
		requests.push(url)
		const body = bodies.shift()
		return Promise.resolve(body ? Response.json(body) : new Response('Forbidden', { status: 403 }))
	}
	const store = new SatelliteStore(AppDatabase.memory())
	const sync = new SatelliteSync(store, () => service.changed(), { fetch })
	const service = new SatelliteService(store, sync, new SatelliteEphemeris((): EarthOrientationCoverage => ({ status: 'covered' })), (event) => events.push(event))
	return { routes: createSatelliteRoutes(service), events, requests, store }
}

async function call(routes: Routes, path: keyof Routes, method: string, params: Record<string, string> = {}, body?: unknown, query = ''): Promise<Reply<unknown>> {
	const handler = (routes[path] as unknown as Record<string, Handler>)[method]
	const req = new Request(`http://localhost${path}${query}`, { method, body: body === undefined ? undefined : JSON.stringify(body) })
	const response = await handler(Object.assign(req, { params }))
	return { status: response.status, body: response.status === 204 ? undefined : ((await response.json()) as unknown) }
}

test('a group download is searchable and its SATCAT is downloaded along with it', async () => {
	const { routes, events, requests } = setup([gp(25544, 'ISS (ZARYA)'), gp(48274, 'CSS (TIANHE)')], [{ OBJECT_NAME: 'ISS (ZARYA)', OBJECT_ID: '1998-067A', NORAD_CAT_ID: 25544, OBJECT_TYPE: 'PAY', OPS_STATUS_CODE: '+' }])

	const { status, body } = (await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: encodeURIComponent('gp:GROUP:STATIONS') })) as Reply<SatelliteRefreshResponse>
	expect(status).toBe(200)
	expect(body.results).toEqual([
		{ sourceKey: 'gp:GROUP:STATIONS', records: 2, rejected: 0 },
		{ sourceKey: 'satcat:GROUP:STATIONS', records: 1, rejected: 0 },
	])
	expect(requests).toEqual(['https://celestrak.org/NORAD/elements/gp.php?GROUP=STATIONS&FORMAT=JSON', 'https://celestrak.org/satcat/records.php?GROUP=STATIONS&FORMAT=JSON'])
	expect(events).toEqual([
		{ type: 'satellites:changed', revision: 1 },
		{ type: 'satellites:changed', revision: 2 },
	])
	const stations = body.snapshot.groups.find((group) => group.group === 'STATIONS')!
	expect(stations).toMatchObject({ members: 2, large: false, gp: { recordCount: 2 }, satcat: { recordCount: 1 } })
	expect(stations.gpAllowedAt).toBeGreaterThan(Date.now())
	expect(body.snapshot).toMatchObject({ revision: 2, objects: 2, imported: 0 })

	const page = (await call(routes, '/api/satellites', 'GET', {}, undefined, '?q=zarya&limit=10')) as Reply<SatelliteSearchPage>
	expect(page.body.items.map((item) => [item.noradId, item.objectType])).toEqual([['25544', 'payload']])
	const favorites = (await call(routes, '/api/satellites', 'GET', {}, undefined, '?ids=48274,1&group=gp:GROUP:STATIONS')) as Reply<SatelliteSearchPage>
	expect(favorites.body.items.map((item) => item.noradId)).toEqual(['48274'])

	// A second download inside the GP interval is refused without a request.
	const again = (await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:GROUP:STATIONS' })) as Reply<{ code: string; source: { nextAllowedAt: number } }>
	expect(again.status).toBe(409)
	expect(again.body.code).toBe('sourceCooldown')
	expect(requests).toHaveLength(2)
	expect((await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:URL:x' })).status).toBe(404)
})

test('a refused download answers 502 with the state of the source and blocks the next', async () => {
	const { routes } = setup()
	const failed = (await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:GROUP:GEO' })) as Reply<{ code: string; source: { lastStatus: number } }>
	expect(failed.status).toBe(502)
	expect(failed.body).toMatchObject({ code: 'upstreamUnavailable', source: { lastStatus: 403 } })
	const blocked = (await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:GROUP:STATIONS' })) as Reply<{ code: string }>
	expect(blocked).toMatchObject({ status: 409, body: { code: 'sourceBlocked' } })
	const snapshot = (await call(routes, '/api/satellites/sources', 'GET')) as Reply<SatelliteSourcesSnapshot>
	expect(snapshot.body.groups.every((group) => group.gpAllowedAt > Date.now())).toBeTrue()
})

test('imported elements predict positions, passes, and ephemerides', async () => {
	const { routes, events } = setup()
	const imported = (await call(routes, '/api/satellites/import', 'POST', {}, { text: ISS_TLE })) as Reply<SatelliteImportResponse>
	expect(imported.body).toEqual({ imported: [{ noradId: '25544', name: 'ISS (ZARYA)', epoch: ISS_EPOCH }], rejected: [] })
	expect(events).toHaveLength(1)
	expect(((await call(routes, '/api/satellites/import', 'POST', {}, { text: 'nothing' })) as Reply<{ code: string }>).body.code).toBe('invalidImport')

	const details = (await call(routes, '/api/satellites/:noradId', 'GET', { noradId: '25544' })) as Reply<SatelliteDetails>
	expect(details.body).toMatchObject({ object: { noradId: '25544', elementSource: 'manual', groups: ['manual'] }, elements: { kind: 'manual', epoch: ISS_EPOCH }, orbit: { model: 'nearEarth' } })

	const position = (await call(routes, '/api/satellites/:noradId/position', 'POST', { noradId: '25544' }, { time: ISS_EPOCH + DAY, observer: SITE })) as Reply<SatellitePositionResponse>
	expect(position.body).toMatchObject({ position: { center: 'topocentric', time: ISS_EPOCH + DAY }, elements: { digest: details.body.elements!.digest }, quality: { suitability: 'usable', elementAgeDays: 1 } })

	const passes = (await call(routes, '/api/satellites/:noradId/passes', 'POST', { noradId: '25544' }, { observer: SITE, start: ISS_EPOCH, end: ISS_EPOCH + DAY, minAltitude: 0, maxSunAltitude: -0.1 })) as Reply<SatellitePassesResponse>
	expect(passes.body.passes.length).toBeGreaterThan(3)
	expect(passes.body.elements.kind).toBe('manual')

	const old = (await call(routes, '/api/satellites/:noradId/passes', 'POST', { noradId: '25544' }, { observer: SITE, start: ISS_EPOCH + 30 * DAY, end: ISS_EPOCH + 31 * DAY, minAltitude: 0, maxSunAltitude: -0.1 })) as Reply<{ code: string; quality: { reasons: string[] } }>
	expect(old).toMatchObject({ status: 422, body: { code: 'predictionUnreliable', quality: { reasons: ['elementsOld'] } } })

	const ephemeris = (await call(routes, '/api/satellites/:noradId/ephemeris', 'POST', { noradId: '25544' }, { start: ISS_EPOCH, end: ISS_EPOCH + 3_600_000, step: 600_000 })) as Reply<{ rows: unknown[]; truncated: boolean }>
	expect(ephemeris.body.rows).toHaveLength(7)

	expect((await call(routes, '/api/satellites/:noradId', 'GET', { noradId: '1' })).status).toBe(404)
	expect((await call(routes, '/api/satellites/:noradId/position', 'POST', { noradId: '1' }, { time: ISS_EPOCH })).status).toBe(404)
})

test('a metadata-only object has details but no prediction', async () => {
	const { routes } = setup([], [{ OBJECT_NAME: 'OLD SAT', OBJECT_ID: '1960-001A', NORAD_CAT_ID: 5, OBJECT_TYPE: 'PAY', DECAY_DATE: '1970-01-01' }])
	await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:CATNR:5' })
	await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'satcat:CATNR:5' })
	const details = (await call(routes, '/api/satellites/:noradId', 'GET', { noradId: '5' })) as Reply<SatelliteDetails>
	expect(details.body).toEqual({ object: expect.objectContaining({ noradId: '5', decayDate: '1970-01-01' }), elementSets: [] })
	expect(((await call(routes, '/api/satellites/:noradId/position', 'POST', { noradId: '5' }, { time: 0 })) as Reply<{ code: string }>).body.code).toBe('noElements')
})

test('the element source can be switched back to GP', async () => {
	const { routes } = setup([gp(25544, 'ISS (ZARYA)')])
	await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:CATNR:25544' })
	await call(routes, '/api/satellites/import', 'POST', {}, { text: ISS_TLE })
	expect(((await call(routes, '/api/satellites/:noradId', 'GET', { noradId: '25544' })) as Reply<SatelliteDetails>).body.elements?.kind).toBe('manual')
	expect((await call(routes, '/api/satellites/:noradId/element-source', 'PUT', { noradId: '25544' }, { kind: null })).status).toBe(204)
	const details = (await call(routes, '/api/satellites/:noradId', 'GET', { noradId: '25544' })) as Reply<SatelliteDetails>
	expect(details.body.elements?.kind).toBe('gp')
	expect(details.body.elementSets.map((set) => set.kind)).toEqual(['gp', 'manual'])
	expect((await call(routes, '/api/satellites/:noradId/element-source', 'PUT', { noradId: '9' }, { kind: 'gp' })).status).toBe(404)
})

test('tracks sample the objects asked for, then the members of a group above the horizon', async () => {
	// Sixty objects of the ISS orbit with their nodes and mean anomalies spread, so some are above the site and most are not.
	const group = Array.from({ length: 60 }, (_, i) => ({ ...gp(1000 + i, `OBJECT ${i}`), RA_OF_ASC_NODE: i * 6, MEAN_ANOMALY: (i * 37) % 360 }))
	const { routes } = setup(group)
	await call(routes, '/api/satellites/sources/:sourceKey/refresh', 'POST', { sourceKey: 'gp:GROUP:VISUAL' })
	await call(routes, '/api/satellites/import', 'POST', {}, { text: ISS_TLE })

	const request = { ids: ['1', '25544'], group: 'gp:GROUP:VISUAL', observer: SITE, start: ISS_EPOCH, end: ISS_EPOCH + 60_000, step: 10_000 }
	const { body } = (await call(routes, '/api/satellites/tracks', 'POST', {}, request)) as Reply<SatelliteTracksResponse>
	expect(body.tracks.slice(0, 2)).toMatchObject([
		{ noradId: '1', code: 'notFound' },
		{ noradId: '25544', name: 'ISS (ZARYA)', elements: { kind: 'manual' } },
	])
	const members = body.tracks.slice(2)
	expect(members.length).toBeGreaterThan(0)
	expect(members.length).toBeLessThan(60)
	const altitudes = members.map((entry) => ('track' in entry ? entry.track.altitude![0] : Number.NaN))
	for (const altitude of altitudes) expect(altitude).toBeGreaterThan(0)
	expect(altitudes).toEqual([...altitudes].sort((a, b) => b - a))
	expect('track' in body.tracks[1] && body.tracks[1].track.times).toEqual([0, 1, 2, 3, 4, 5, 6].map((i) => ISS_EPOCH + i * 10_000))

	// Without an observer, the first members by NORAD id, at most fifty objects in all.
	const geocentric = (await call(routes, '/api/satellites/tracks', 'POST', {}, { ...request, observer: undefined })) as Reply<SatelliteTracksResponse>
	expect(geocentric.body.tracks).toHaveLength(50)
	expect(geocentric.body.tracks[2].noradId).toBe('1000')
})
