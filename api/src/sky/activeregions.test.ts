import { expect, test } from 'bun:test'
import { createActiveRegionRoutes, latestSolarRegionReport, NOAA_SOLAR_REGIONS_URL, SolarActiveRegions } from './activeregions'
import type { UpstreamFetch } from './remote'

// Records trimmed from the NOAA SWPC feed of 2026-10-28, with the fields it carries.
const RECORDS = [
	{ observed_date: '2026-10-28', region: 4562, latitude: -17, longitude: 20, location: 'S17E20', carrington_longitude: 265, old_carrington_longitude: 264, area: 10, spot_class: 'Axx', extent: 1, number_spots: 1, mag_class: 'A', mag_string: null, status: 'f', first_date: '2026-10-26T06:31:17' },
	{ observed_date: '2026-10-28', region: 4561, latitude: -11, longitude: 0, location: 'S11W0*', carrington_longitude: 285, old_carrington_longitude: 284, area: null, spot_class: null, extent: null, number_spots: null, mag_class: null, mag_string: null, status: 'f', first_date: '2026-10-25T00:00:00' },
	{ observed_date: '2026-10-28', region: 4562, latitude: -17, longitude: 20, location: 'S17E20', carrington_longitude: 265, old_carrington_longitude: 264, area: 10, spot_class: 'Axx', extent: 1, number_spots: 1, mag_class: 'A', mag_string: null, status: 'f', first_date: '2026-10-26T06:31:17' },
	{ observed_date: '2026-10-27', region: 4560, latitude: 12, longitude: -35, location: 'N12W35', carrington_longitude: 300, old_carrington_longitude: 299, area: 240, spot_class: 'Dko', extent: 9, number_spots: 14, mag_class: 'BG', mag_string: 'Beta-Gamma', status: 'f', first_date: '2026-10-20T00:00:00' },
]

function feed(body: unknown, contentType = 'application/json'): UpstreamFetch {
	return () => Promise.resolve(new Response(typeof body === 'string' ? body : JSON.stringify(body), { headers: { 'Content-Type': contentType } }))
}

test('the report is the latest observed date, one record per region', () => {
	const report = latestSolarRegionReport(RECORDS)
	expect(report.observedDate).toBe('2026-10-28')
	expect(report.regions.map((e) => e.id)).toEqual(['4561', '4562'])
	expect(report.regions[1]).toEqual({ id: '4562', latitude: -17, longitude: 20, location: 'S17E20', carringtonLongitude: 265, spotCount: 1, area: 10, mcintoshClass: 'Axx', magneticClass: 'A' })
})

test('null fields are absent, never zero', () => {
	const region = latestSolarRegionReport(RECORDS).regions[0]
	expect(region.spotCount).toBeUndefined()
	expect(region.area).toBeUndefined()
	expect(region.mcintoshClass).toBeUndefined()
	expect(region.magneticClass).toBeUndefined()
	expect(region.longitude).toBe(0)
})

test('an empty feed has no observed date nor regions', () => {
	expect(latestSolarRegionReport([])).toEqual({ observedDate: undefined, regions: [] })
})

test('the route answers the latest report with its source', async () => {
	const urls: string[] = []
	const fetch: UpstreamFetch = (url, init) => (urls.push(url), feed(RECORDS)(url, init))
	const routes = createActiveRegionRoutes(new SolarActiveRegions({ fetch, now: () => 5 }))
	const response = await routes['/api/sky/sun/active-regions'].GET()
	const body = await response.json()
	expect(urls).toEqual([NOAA_SOLAR_REGIONS_URL])
	expect(body.source).toBe('NOAA/SWPC')
	expect(body.observedDate).toBe('2026-10-28')
	expect(body.fetchedAt).toBe(5)
	expect(body.stale).toBeFalse()
	expect(body.regions).toHaveLength(2)
})

test('a corrupt feed is unavailable, and the last report is answered stale', async () => {
	const corrupt = createActiveRegionRoutes(new SolarActiveRegions({ fetch: feed('{"observed') }))
	expect((await corrupt['/api/sky/sun/active-regions'].GET()).status).toBe(502)

	const notAList = createActiveRegionRoutes(new SolarActiveRegions({ fetch: feed({ regions: [] }) }))
	expect((await notAList['/api/sky/sun/active-regions'].GET()).status).toBe(502)

	let now = 0
	let body: unknown = RECORDS
	const routes = createActiveRegionRoutes(new SolarActiveRegions({ fetch: (url, init) => feed(body)(url, init), now: () => now }))
	await routes['/api/sky/sun/active-regions'].GET()
	body = 'not json'
	now = 31 * 60_000

	const stale = await (await routes['/api/sky/sun/active-regions'].GET()).json()
	expect(stale.stale).toBeTrue()
	expect(stale.fetchedAt).toBe(0)
	expect(stale.observedDate).toBe('2026-10-28')
})
