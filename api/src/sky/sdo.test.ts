import { expect, test } from 'bun:test'
import type { UpstreamFetch } from './remote'
import { createSolarImageRoutes, SolarImages, sdoImageUrl } from './sdo'

function request(query: string) {
	return new Request(`http://localhost/api/sky/sun/image?${query}`) as never
}

test('channels map to the fixed SDO latest images', () => {
	expect(sdoImageUrl('aia193', 512)).toBe('https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg')
	expect(sdoImageUrl('aia171', 1024)).toBe('https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_0171.jpg')
	expect(sdoImageUrl('aia304', 512)).toBe('https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0304.jpg')
	expect(sdoImageUrl('hmiIntensitygram', 512)).toBe('https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_HMIIC.jpg')
	expect(sdoImageUrl('hmiMagnetogram', 1024)).toBe('https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg')
})

test('the route answers the JPEG with its source times', async () => {
	const urls: string[] = []
	const fetch: UpstreamFetch = (url) => (urls.push(url), Promise.resolve(new Response(new Uint8Array([0xff, 0xd8]), { headers: { 'Content-Type': 'image/jpeg', 'Last-Modified': 'Wed, 28 Oct 2026 11:40:06 GMT' } })))
	const routes = createSolarImageRoutes(new SolarImages({ fetch, now: () => 1234 }))

	const response = await routes['/api/sky/sun/image'].GET(request('channel=hmiMagnetogram&size=1024'))
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/jpeg')
	expect(response.headers.get('Last-Modified')).toBe('Wed, 28 Oct 2026 11:40:06 GMT')
	expect(response.headers.get('X-Sun-Fetched-At')).toBe('1234')
	expect(response.headers.get('X-Sun-Stale')).toBe('0')
	expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0xff, 0xd8])

	await routes['/api/sky/sun/image'].GET(request('channel=aia193'))
	expect(urls).toEqual(['https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_HMIB.jpg', 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_512_0193.jpg'])
})

test('the route answers 502 when SDO is down and no image was read', async () => {
	const routes = createSolarImageRoutes(new SolarImages({ fetch: () => Promise.resolve(new Response('error', { status: 500 })) }))
	const response = await routes['/api/sky/sun/image'].GET(request('channel=aia171'))
	expect(response.status).toBe(502)
	expect(await response.json()).toEqual({ error: 'The SDO image is unavailable', code: 'upstreamUnavailable' })
})

test('the route answers the last image as stale when SDO goes down', async () => {
	let now = 0
	let down = false
	const fetch: UpstreamFetch = () => (down ? Promise.reject(new TypeError('offline')) : Promise.resolve(new Response(new Uint8Array([1]), { headers: { 'Content-Type': 'image/jpeg' } })))
	const routes = createSolarImageRoutes(new SolarImages({ fetch, now: () => now }))

	await routes['/api/sky/sun/image'].GET(request('channel=aia304'))
	down = true
	now = 16 * 60_000

	const response = await routes['/api/sky/sun/image'].GET(request('channel=aia304'))
	expect(response.status).toBe(200)
	expect(response.headers.get('X-Sun-Stale')).toBe('1')
	expect(response.headers.get('X-Sun-Fetched-At')).toBe('0')
	expect(response.headers.get('Last-Modified')).toBeNull()
})
