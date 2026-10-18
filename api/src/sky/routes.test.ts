import { expect, test } from 'bun:test'
import { fixtureCatalog } from './fixture'
import { createSkyRoutes } from './routes'
import type { SkyCatalogObject, SkySearchResult, SkyStarData } from './types'

const routes = createSkyRoutes({ catalog: fixtureCatalog(), constellations: { lines: [], boundaries: [], labels: [] } })

test('search lists solar-system bodies before catalog objects', async () => {
	const response = routes['/api/sky/search'].GET(new Request('http://localhost/api/sky/search?q=an'))
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
