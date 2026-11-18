import { expect, test } from 'bun:test'
import { createHipsCutoutRoutes, cutoutUrl, type FramingCutoutRequest, HipsCutouts } from './framings.hips'
import { sortHipsSurveys } from './framings.surveys'
import type { UpstreamFetch } from './remote'

const DEG = Math.PI / 180

const REQUEST: FramingCutoutRequest = { survey: 'CDS/P/DSS2/color', rightAscension: 83.82 * DEG, declination: -5.39 * DEG, fov: 2 * DEG, width: 800, height: 600 }

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9])

function jpeg() {
	return new Response(JPEG, { headers: { 'Content-Type': 'image/jpeg' } })
}

function get(routes: ReturnType<typeof createHipsCutoutRoutes>, request: FramingCutoutRequest) {
	const params = new URLSearchParams({ survey: request.survey, ra: `${request.rightAscension}`, dec: `${request.declination}`, fov: `${request.fov}`, width: `${request.width}`, height: `${request.height}` })
	return routes['/api/framings/cutout'].GET(new Request(`http://localhost/api/framings/cutout?${params}`) as never, { timeout: () => undefined })
}

test('asks for a north-up TAN JPEG of the field on the larger side', () => {
	const url = new URL(cutoutUrl(REQUEST))

	expect(url.host).toBe('alasky.cds.unistra.fr')
	expect(url.searchParams.get('hips')).toBe('CDS/P/DSS2/color')
	expect(+url.searchParams.get('ra')!).toBeCloseTo(83.82, 10)
	expect(+url.searchParams.get('dec')!).toBeCloseTo(-5.39, 10)
	expect(+url.searchParams.get('fov')!).toBeCloseTo(2, 10)
	expect(url.searchParams.get('width')).toBe('800')
	expect(url.searchParams.get('height')).toBe('600')
	expect(url.searchParams.get('rotation_angle')).toBe('0')
	expect(url.searchParams.get('projection')).toBe('TAN')
	expect(url.searchParams.get('coordsys')).toBe('icrs')
	expect(url.searchParams.get('format')).toBe('jpg')
})

test('serves a cutout and keeps it for the same request', async () => {
	const urls: string[] = []
	const fetch: UpstreamFetch = (url) => {
		urls.push(url)
		return Promise.resolve(jpeg())
	}
	const routes = createHipsCutoutRoutes(new HipsCutouts({ fetch, now: () => 1000 }))

	const response = await get(routes, REQUEST)
	expect(response.status).toBe(200)
	expect(response.headers.get('Content-Type')).toBe('image/jpeg')
	expect(response.headers.get('X-Framing-Fetched-At')).toBe('1000')
	expect(new Uint8Array(await response.arrayBuffer())).toEqual(JPEG)

	await get(routes, REQUEST)
	expect(urls).toHaveLength(1)
})

test('falls back to the mirror, and answers 502 when neither host serves a JPEG', async () => {
	const hosts: string[] = []
	let mirrorUp = true
	const fetch: UpstreamFetch = (url) => {
		const host = new URL(url).host
		hosts.push(host)
		if (host === 'alaskybis.cds.unistra.fr' && mirrorUp) return Promise.resolve(jpeg())
		return Promise.resolve(new Response('Service Unavailable', { status: 503 }))
	}
	const routes = createHipsCutoutRoutes(new HipsCutouts({ fetch }))

	expect((await get(routes, REQUEST)).status).toBe(200)
	expect(hosts).toEqual(['alasky.cds.unistra.fr', 'alaskybis.cds.unistra.fr'])

	mirrorUp = false
	const failed = await get(routes, { ...REQUEST, survey: 'CDS/P/2MASS/color' })
	expect(failed.status).toBe(502)
	expect(await failed.json()).toMatchObject({ code: 'upstreamUnavailable' })

	// A failure is remembered, so the same request answers at once without asking again.
	const count = hosts.length
	expect((await get(routes, { ...REQUEST, survey: 'CDS/P/2MASS/color' })).status).toBe(502)
	expect(hosts).toHaveLength(count)
})

test('sorts surveys by regime, coverage, and id', () => {
	const survey = (id: string, regime: 'optical' | 'infrared' | 'radio', skyFraction: number) => ({ id, category: 'Image', frame: 'equatorial' as const, regime, bitpix: 0 as const, pixelScale: 1e-4, skyFraction })
	const sorted = sortHipsSurveys([survey('B', 'infrared', 1), survey('C', 'optical', 0.995), survey('A', 'radio', 1), survey('D', 'optical', 1), survey('A', 'optical', 1)])
	expect(sorted.map((e) => `${e.regime} ${e.id}`)).toEqual(['optical A', 'optical D', 'optical C', 'infrared B', 'radio A'])
})
