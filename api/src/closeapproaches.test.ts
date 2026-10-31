import { expect, test } from 'bun:test'
import { approachTime, type CloseApproachFilters, type CloseApproachHistoryFilters, type CloseApproachPageResponse, CloseApproachesService, createCloseApproachRoutes } from './closeapproaches'
import { MinorBodies } from './sky/minorbodies'
import type { MinorBodyDetailsResponse } from './sky/types'
import { SsdRequestQueue } from './ssd'

const SIGNATURE = { source: 'NASA/JPL SBDB Close Approach Data API', version: '1.5' }
const FIELDS = ['des', 'orbit_id', 'jd', 'cd', 'dist', 'dist_min', 'dist_max', 'v_rel', 'v_inf', 't_sigma_f', 'body', 'h', 'diameter', 'diameter_sigma', 'fullname']
const EARTH_FIELDS = FIELDS.filter((e) => e !== 'body')
const APOPHIS = ['99942', '220', '2462240.407091969', '2029-Apr-13 21:46', '0.000254090910419299', '0.000254068999976389', '0.000254112821017663', '7.42253895678452', '5.84135589753103', '< 00:01', 'Earth', '19.09', '0.34', '0.04', ' 99942 Apophis (2004 MN4)']
const APOPHIS_EARTH = APOPHIS.filter((_, i) => i !== 10)

// Trimmed from an SBDB answer for Apophis.
const SBDB = {
	signature: { source: 'NASA/JPL Small-Body Database (SBDB) API', version: '1.3' },
	object: { spkid: '20099942', des: '99942', fullname: '99942 Apophis (2004 MN4)', kind: 'an', neo: true, pha: true, orbit_class: { name: 'Aten', code: 'ATE' }, des_alt: [] },
	orbit: { orbit_id: '220', epoch: '2461200.5', epoch_cd: '2026-Jun-05.0', equinox: 'J2000', soln_date: '2025-06-01', source: 'JPL', first_obs: '2004-03-15', last_obs: '2021-03-08', n_obs_used: 7364, elements: [] },
	phys_par: [],
}

// Test server over a fake JPL that answers each URL through `reply`, and records the requests.
function serve(reply: (url: URL) => Response | Promise<Response>) {
	const urls: URL[] = []
	let now = 1_000_000
	const fetch = ((url: string) => {
		const parsed = new URL(url)
		urls.push(parsed)
		return Promise.resolve(reply(parsed))
	}) as unknown as typeof globalThis.fetch
	const queue = new SsdRequestQueue({ fetch })
	const service = new CloseApproachesService(new MinorBodies({ queue }), queue, { now: () => now })
	const routes = createCloseApproachRoutes(service)

	return {
		urls,
		tick: (ms: number) => {
			now += ms
		},
		list: (query = '') => {
			const params = new URLSearchParams('dateMin=2026-11-01&dateMax=2026-11-30&body=Earth&distanceMax=10&distanceUnit=LD&sort=date&page=1&pageSize=50')
			for (const [name, value] of new URLSearchParams(query)) params.set(name, value)
			return routes['/api/close-approaches'].GET(new Request(`http://localhost/api/close-approaches?${params}`))
		},
		object: (designation: string) => routes['/api/close-approaches/objects'].GET(new Request(`http://localhost/api/close-approaches/objects?designation=${encodeURIComponent(designation)}`)),
		history: (spkId: string, query = '') => {
			const request = new Request(`http://localhost/api/close-approaches/objects/${spkId}/approaches?dateMin=2020-01-01&dateMax=2039-12-31&body=ALL&sort=date&page=1&pageSize=50${query}`)
			return routes['/api/close-approaches/objects/:spkId/approaches'].GET(Object.assign(request, { params: { spkId } }) as never)
		},
	}
}

// Answers one page of CAD with the Earth columns.
const earthPage = (total = 1) => Response.json({ signature: SIGNATURE, count: 1, total, fields: EARTH_FIELDS, data: [APOPHIS_EARTH] })

test('the instant of a CAD Julian date TDB is UTC, with leap seconds', () => {
	// astropy 8.0.2: Time(2462240, 0.407091969, format='jd', scale='tdb').utc is 2029-04-13T21:45:03.560 (1870811103560.5 ms).
	expect(approachTime('2462240.407091969')).toBe(Date.UTC(2029, 3, 13, 21, 45, 3, 560))
})

test('an instant before UTC existed takes TAI - UTC as zero, like the rest of the toolkit', () => {
	// 22:17:48.5 TDB, minus the 32.184 s of TT - TAI.
	expect(approachTime('2433287.429033323')).toBe(Date.UTC(1950, 0, 5, 22, 17, 16, 296))
})

test('a page of every object normalizes the encounters', async () => {
	const server = serve(() => earthPage(248))
	const response = await server.list('&neoOnly=true')
	const page = (await response.json()) as CloseApproachPageResponse<CloseApproachFilters>

	expect(response.status).toBe(200)
	expect(page).toMatchObject({ page: 1, pageSize: 50, total: 248, source: SIGNATURE.source, sourceVersion: '1.5', fetchedAt: 1_000_000 })
	expect(page.query).toMatchObject({ dateMin: '2026-11-01', body: 'Earth', neoOnly: true })
	expect(page.rows).toHaveLength(1)
	expect(page.rows[0]).toMatchObject({ id: 'Earth|99942|220|2462240.407091969', body: 'Earth', designation: '99942', fullName: '99942 Apophis (2004 MN4)', jd: '2462240.407091969', calendarDate: '2029-Apr-13 21:46', time: approachTime('2462240.407091969'), absoluteMagnitude: 19.09, diameterSigma: 0.04 })
	expect(server.urls[0].searchParams.get('neo')).toBe('true')
	expect(server.urls[0].searchParams.get('dist-max')).toBe('10LD')
})

test('pages are offsets of CAD, the first one with none', async () => {
	const server = serve(() => earthPage())
	await server.list()
	await server.list('&page=3&pageSize=50')

	expect(server.urls[0].searchParams.has('limit-from')).toBeFalse()
	expect(server.urls[1].searchParams.get('limit')).toBe('50')
	expect(server.urls[1].searchParams.get('limit-from')).toBe('100')
})

test('a page past the end keeps the total', async () => {
	const server = serve(() => Response.json({ signature: SIGNATURE, count: 0, total: 53 }))
	const page = (await (await server.list('&page=9')).json()) as CloseApproachPageResponse<CloseApproachFilters>

	expect(page.rows).toBeEmpty()
	expect(page.total).toBe(53)
})

test('pages are cached, shared while pending, and read again on refresh', async () => {
	const gate = Promise.withResolvers<Response>()
	const server = serve(() => gate.promise)
	const pending = [server.list(), server.list()]
	gate.resolve(earthPage())
	await Promise.all(pending)
	expect(server.urls).toHaveLength(1)

	const again = serve(() => earthPage())
	await again.list()
	await again.list()
	expect(again.urls).toHaveLength(1)

	await again.list('&refresh=true')
	expect(again.urls).toHaveLength(2)

	again.tick(300_000)
	await again.list()
	expect(again.urls).toHaveLength(3)
})

test('the history of an object selects its SPK-ID, to any distance, without the NEO filter', async () => {
	const server = serve(() => Response.json({ signature: SIGNATURE, count: 1, total: 13, fields: FIELDS, data: [APOPHIS.with(10, 'Venus')] }))
	const page = (await (await server.history('20099942')).json()) as CloseApproachPageResponse<CloseApproachHistoryFilters>
	const { searchParams } = server.urls[0]

	expect(searchParams.get('spk')).toBe('20099942')
	expect(searchParams.get('body')).toBe('ALL')
	expect(searchParams.get('dist-max')).toBe('100')
	expect(searchParams.has('neo')).toBeFalse()
	expect(page.total).toBe(13)
	expect(page.rows[0].body).toBe('Venus')
})

test('one object is resolved once by exact designation', async () => {
	const server = serve(() => Response.json(SBDB))
	const found = (await (await server.object('99942')).json()) as MinorBodyDetailsResponse
	await server.object('99942')

	expect(found.kind).toBe('found')
	if (found.kind === 'found') {
		expect(found.body.spkId).toBe('20099942')
		expect(found.details.orbitClassCode).toBe('ATE')
	}
	expect(server.urls).toHaveLength(1)
	expect(server.urls[0].searchParams.get('des')).toBe('99942')
})

test('an unknown object is an answer, not a failure', async () => {
	const server = serve(() => Response.json({ message: 'specified object was not found', code: '200' }))
	const response = await server.object('2099 ZZ999')

	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ kind: 'notFound', message: 'specified object was not found' })
})

test('failures of JPL have stable codes and are not retried', async () => {
	const cases: readonly [() => Response, number, string][] = [
		[() => Response.json({ code: '400', message: 'invalid SPKID' }, { status: 400 }), 502, 'rejected'],
		[() => new Response('', { status: 500 }), 503, 'serviceUnavailable'],
		[() => new Response('', { status: 429, headers: { 'Retry-After': '60' } }), 503, 'rateLimited'],
		[() => new Response('', { status: 503 }), 503, 'rateLimited'],
		[() => Response.json({ signature: { ...SIGNATURE, version: '2.0' }, count: 0, total: 0 }), 502, 'upstreamSchemaChanged'],
		[() => Response.json({ signature: SIGNATURE, count: 1, total: 1, fields: ['des'], data: [['99942']] }), 502, 'invalidResponse'],
		[() => new Response('<html>'), 502, 'invalidResponse'],
	]

	for (const [reply, status, code] of cases) {
		const server = serve(reply)
		const response = await server.list()
		expect(response.status).toBe(status)
		expect(((await response.json()) as { code: string }).code).toBe(code)
		expect(server.urls).toHaveLength(1)
	}
})

test('a throttled answer says how long to wait', async () => {
	const server = serve(() => new Response('', { status: 429, headers: { 'Retry-After': '60' } }))
	const body = (await (await server.list()).json()) as { readonly retryAfter: number }

	expect(body.retryAfter).toBe(60_000)
})

test('an unreachable JPL is unavailable, with no list made up', async () => {
	const server = serve(() => {
		throw new TypeError('fetch failed')
	})
	const response = await server.list()

	expect(response.status).toBe(503)
	expect(((await response.json()) as { code: string }).code).toBe('serviceUnavailable')
})

test('a throttled object lookup keeps its code', async () => {
	const server = serve(() => new Response('', { status: 429 }))
	const response = await server.object('99942')

	expect(response.status).toBe(503)
	expect(((await response.json()) as { code: string }).code).toBe('rateLimited')
})
