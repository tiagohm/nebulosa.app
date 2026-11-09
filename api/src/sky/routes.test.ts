import { expect, test } from 'bun:test'
import { AppDatabase } from '../database'
import { SatelliteService, satelliteSkyAdapter } from '../satellites'
import { SatelliteEphemeris } from '../satellites.ephemeris'
import { SatelliteStore } from '../satellites.store'
import { SatelliteSync } from '../satellites.sync'
import { SkyEphemeris } from './ephemeris'
import { fixtureCatalog } from './fixture'
import { MinorBodies } from './minorbodies'
import { createSkyLocator, createSkyRoutes } from './routes'
import type { SkyBodyPosition, SkyCatalogObject, SkyPositionResponse, SkySearchResult, SkyStarData } from './types'

const routes = createSkyRoutes({ catalog: fixtureCatalog(), constellations: { lines: [], boundaries: [], labels: [] }, ephemeris: new SkyEphemeris({ observer: () => Promise.reject(new TypeError('offline')) }), minorBodies: new MinorBodies({ fetch: () => Promise.reject(new TypeError('offline')) }) })

test('search lists solar-system bodies before catalog objects', async () => {
	const response = await routes['/api/sky/search'].GET(new Request('http://localhost/api/sky/search?q=an'))
	const results = (await response.json()) as SkySearchResult[]
	expect(results.map((e) => e.name)).toEqual(['Uranus', 'Andromeda Galaxy'])
	expect(results[0].ref).toEqual({ kind: 'body', code: '799' })
})

test('object details and 404', async () => {
	const found = routes['/api/sky/objects/:id'].GET(Object.assign(new Request('http://localhost/api/sky/objects/32263'), { params: { id: '32263' } }) as never)
	expect(((await found.json()) as SkyCatalogObject).name).toBe('Sirius')

	const missing = routes['/api/sky/objects/:id'].GET(Object.assign(new Request('http://localhost/api/sky/objects/5'), { params: { id: '5' } }) as never)
	expect(missing.status).toBe(404)
})

test('star data honors the requested time', async () => {
	const response = routes['/api/sky/catalog/stars'].GET(new Request('http://localhost/api/sky/catalog/stars?time=946728000000'))
	const stars = (await response.json()) as SkyStarData
	expect(stars.time).toBe(946728000000)
	expect(stars.ids).toHaveLength(4)
})

test('position of a catalog object with events', async () => {
	const body = { target: { kind: 'catalog', id: 32263 }, time: Date.UTC(2026, 9, 18, 12), observer: { latitude: -23.5, longitude: -46.6, elevation: 760 } }
	const response = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify(body) }) as never)
	const { position, events } = (await response.json()) as SkyPositionResponse
	expect(position.source).toBe('local')
	expect(position.altitude).toBeDefined()
	expect(events?.state).toBe('normal')
})

test('a fast position of a body has its events too', async () => {
	const body = { target: { kind: 'body', code: '499' }, time: Date.UTC(2026, 9, 18, 12), observer: { latitude: -23.5, longitude: -46.6, elevation: 760 }, mode: 'fast' }
	const response = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify(body) }) as never)
	const { position, events } = (await response.json()) as SkyPositionResponse
	expect(position.source).toBe('local')
	expect(events).toBeDefined()
})

test('position errors', async () => {
	const unknown = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify({ target: { kind: 'catalog', id: 5 }, time: 0 }) }) as never)
	expect(unknown.status).toBe(404)

	// SBDB and Horizons are both offline, and without elements there is no local model.
	const minor = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify({ target: { kind: 'minorBody', spkId: '20000001', designation: '1' }, time: 0 }) }) as never)
	expect(minor.status).toBe(503)
})

test('minor body search is unavailable offline', async () => {
	const response = await routes['/api/sky/minorbodies/search'].GET(new Request('http://localhost/api/sky/minorbodies/search?q=ceres'))
	expect(response.status).toBe(503)
	expect(((await response.json()) as { error: string }).error).toBe('SBDB cannot be reached')
})

test('local positions of the major bodies', async () => {
	const response = await routes['/api/sky/bodies'].POST(new Request('http://localhost/api/sky/bodies', { method: 'POST', body: JSON.stringify({ time: Date.UTC(2026, 9, 18, 12) }) }) as never)
	const bodies = (await response.json()) as SkyBodyPosition[]
	expect(bodies.map((e) => e.code)).toEqual(['10', '301', '199', '299', '499', '599', '699', '799', '899', '999'])
	expect(bodies[0].magnitude).toBe(-26.74)
})

test('constellations are located at their label', async () => {
	const withLabels = createSkyRoutes({ catalog: fixtureCatalog(), constellations: { lines: [], boundaries: [], labels: [{ name: 'Orion', rightAscension: 1.45, declination: 0.05 }] }, ephemeris: new SkyEphemeris(), minorBodies: new MinorBodies() })
	const details = withLabels['/api/sky/constellations/:code'].GET(Object.assign(new Request('http://localhost/api/sky/constellations/ori'), { params: { code: 'ori' } }) as never)
	expect(((await details.json()) as { name: string }).name).toBe('Orion')

	const body = { target: { kind: 'constellation', code: 'ORI' }, time: Date.UTC(2026, 9, 18, 12) }
	const response = await withLabels['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify(body) }) as never)
	const { position } = (await response.json()) as SkyPositionResponse
	expect(position.source).toBe('local')
	expect(position.rightAscensionJ2000).toBe(1.45)
	expect(position.distance).toBeUndefined()
	expect(position.constellationName).toBe('Orion')
})

test('satellites are searched and located through the satellite catalog, without events', async () => {
	const store = new SatelliteStore(AppDatabase.memory())
	const satellites = new SatelliteService(store, new SatelliteSync(store, () => undefined), new SatelliteEphemeris(() => ({ status: 'covered' })), () => undefined)
	satellites.import('ISS (ZARYA)\n1 25544U 98067A   23231.51768399  .00014050  00000+0  25837-3 0  9996\n2 25544  51.6415  14.7889 0003559 325.3396 149.4637 15.49477580411611')
	store.publish({ sourceKey: 'satcat:CATNR:5', objects: [{ noradId: '5', name: 'VANGUARD 1', cosparId: '1958-002B', catalog: { objectType: 'payload' } }], elements: [], at: 0 })
	const sky = createSkyRoutes({ catalog: fixtureCatalog(), constellations: { lines: [], boundaries: [], labels: [] }, ephemeris: new SkyEphemeris(), minorBodies: new MinorBodies(), satellites: satelliteSkyAdapter(satellites) })

	const found = (await (await sky['/api/sky/search'].GET(new Request('http://localhost/api/sky/search?q=zarya'))).json()) as SkySearchResult[]
	expect(found).toEqual([{ ref: { kind: 'satellite', noradId: '25544' }, name: 'ISS (ZARYA)', designations: ['NORAD 25544', '1998-067A'], category: 'satellite', typeName: 'Artificial satellite' }])
	expect(((await (await sky['/api/sky/search'].GET(new Request('http://localhost/api/sky/search?q=5'))).json()) as SkySearchResult[]).map((result) => result.name)).toContain('VANGUARD 1')

	const locate = (noradId: string, observer?: object) => sky['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify({ target: { kind: 'satellite', noradId }, time: Date.UTC(2023, 7, 19, 13), observer }) }) as never)
	const response = await locate('25544', { latitude: -23.5, longitude: -46.6, elevation: 760 })
	const { position, events } = (await response.json()) as SkyPositionResponse
	expect(position).toMatchObject({ source: 'local', center: 'topocentric', time: Date.UTC(2023, 7, 19, 13) })
	expect(position.distance! * 149_597_870.7).toBeGreaterThan(400)
	expect(position.constellationName).toBeString()
	expect(position.magnitude).toBeUndefined()
	expect(events).toBeUndefined()
	expect(((await (await locate('25544')).json()) as SkyPositionResponse).position.center).toBe('geocentric')

	const noElements = await locate('5')
	expect(noElements.status).toBe(404)
	expect(((await noElements.json()) as { code: string }).code).toBe('noElements')
	expect((await locate('1')).status).toBe(404)
	// Without a satellite catalog a satellite is unknown.
	expect((await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify({ target: { kind: 'satellite', noradId: '25544' }, time: 0 }) }) as never)).status).toBe(404)
})

test('a meteor shower radiant is a direction the position route refuses and a mount never locates', async () => {
	const response = await routes['/api/sky/position'].POST(new Request('http://localhost/api/sky/position', { method: 'POST', body: JSON.stringify({ target: { kind: 'meteorShower', id: 'iau:4' }, time: 0 }) }) as never)
	expect(response.status).toBe(422)
	expect(((await response.json()) as { code: string }).code).toBe('unsupportedTarget')
	const locate = createSkyLocator({ catalog: fixtureCatalog(), constellations: { lines: [], boundaries: [], labels: [] }, ephemeris: new SkyEphemeris({ observer: () => Promise.reject(new TypeError('offline')) }), minorBodies: new MinorBodies({ fetch: () => Promise.reject(new TypeError('offline')) }) })
	expect(await locate({ kind: 'meteorShower', id: 'iau:4' }, { time: 0 })).toBeUndefined()
})
