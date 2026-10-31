import { expect, test } from 'bun:test'
import type { SmallBodySearch, SmallBodySearchFound } from 'nebulosa/src/adapters/orbits/sbd'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { SsdRequestQueue, SsdThrottledError } from '../ssd'
import { detailsOf, elementsOf, MinorBodies, SbdbUnavailableError } from './minorbodies'

// Minimal SBDB answer for Ceres with the fields the service reads.
const CERES = {
	object: { spkid: '20000001', des: '1', fullname: '1 Ceres (A801 AA)', kind: 'an', neo: false, pha: false, orbit_class: { name: 'Main-belt Asteroid', code: 'MBA' } },
	orbit: {
		epoch: '2461200.5',
		equinox: 'J2000',
		soln_date: '2025-06-01 05:04:56',
		elements: [
			{ name: 'e', title: 'eccentricity', value: '0.0795', units: null },
			{ name: 'a', title: 'semi-major axis', value: '2.7656', units: 'au' },
			{ name: 'i', title: 'inclination', value: '10.588', units: 'deg' },
			{ name: 'om', title: 'longitude of the ascending node', value: '80.25', units: 'deg' },
			{ name: 'w', title: 'argument of perihelion', value: '73.3', units: 'deg' },
			{ name: 'ma', title: 'mean anomaly', value: '268.9', units: 'deg' },
		],
	},
	phys_par: [
		{ name: 'H', title: 'absolute magnitude', value: '3.34', units: null },
		{ name: 'G', title: 'magnitude slope', value: '0.12', units: null },
	],
} as unknown as SmallBodySearchFound

test('elements of an SBDB match', () => {
	const elements = elementsOf(CERES)!
	expect(elements.epoch).toBe(2461200.5)
	expect(elements.ec).toBe(0.0795)
	expect(toDeg(elements.i)).toBeCloseTo(10.588, 6)
	expect(elements.tpqr).toEqual({ a: 2.7656, ma: expect.any(Number) })
	expect(elements.h).toBe(3.34)
	expect(elements.g).toBe(0.12)
	expect(elements.m1).toBeUndefined()
})

test('search outcomes', async () => {
	const answers: Record<string, SmallBodySearch> = {
		ceres: CERES,
		halley: {
			list: [
				{ pdes: '2688', name: '2688 Halley (1982 HG1)' },
				{ pdes: '1P', name: '1P/Halley' },
			],
		},
		xyzzy: { message: 'specified object was not found' },
	}
	const queries: string[] = []
	const bodies = new MinorBodies({ fetch: (text) => (queries.push(text), Promise.resolve(answers[text])) })

	const found = await bodies.search('ceres')
	expect(found.kind).toBe('found')
	if (found.kind === 'found') {
		expect(found.body).toMatchObject({ spkId: '20000001', designation: '1', name: '1 Ceres (A801 AA)', kind: 'asteroid', numbered: true, orbitClass: 'Main-belt Asteroid', epoch: 2461200.5 })
		expect(found.body.parameters.map((e) => e.name)).toEqual(['e', 'a', 'i', 'om', 'w', 'ma', 'H', 'G'])
	}

	expect(await bodies.search('halley')).toEqual({
		kind: 'ambiguous',
		matches: [
			{ designation: '2688', name: '2688 Halley (1982 HG1)' },
			{ designation: '1P', name: '1P/Halley' },
		],
	})
	expect(await bodies.search('xyzzy')).toEqual({ kind: 'notFound', message: 'specified object was not found' })

	// A body found by a search is cached by SPK-ID.
	expect((await bodies.body('20000001'))?.elements?.ec).toBe(0.0795)
	expect(queries).toEqual(['ceres', 'halley', 'xyzzy'])
})

// Trimmed from an SBDB answer for Apophis of 2026-10-31, with the blocks the details read.
const APOPHIS = {
	signature: { source: 'NASA/JPL Small-Body Database (SBDB) API', version: '1.3' },
	object: { spkid: '20099942', des: '99942', fullname: '99942 Apophis (2004 MN4)', kind: 'an', neo: true, pha: true, orbit_class: { name: 'Aten', code: 'ATE' }, des_alt: [{ pri: '2004 MN4' }] },
	orbit: {
		orbit_id: '220',
		epoch: '2461200.5',
		epoch_cd: '2026-Jun-05.0',
		equinox: 'J2000',
		soln_date: '2025-06-01 05:04:56',
		producer: null,
		source: 'JPL',
		first_obs: '2004-03-15',
		last_obs: '2021-03-08',
		data_arc: '6202',
		n_obs_used: 7364,
		n_del_obs_used: 25,
		n_dop_obs_used: null,
		rms: '.3',
		condition_code: '0',
		moid: '.000103',
		moid_jup: '4.15',
		t_jup: '6.46',
		pe_used: 'DE441',
		sb_used: 'SB441-N16',
		comment: null,
		not_valid_after: null,
		elements: [{ name: 'e', title: 'eccentricity                ', value: '.1911', sigma: '1.6e-07', units: null }],
		model_pars: [{ name: 'A1', title: 'non-grav. radial accel.', value: '5.E-13', sigma: '4.892E-13', units: 'au/d^2', kind: 'EST', desc: 'radial' }],
	},
	phys_par: [{ name: 'H', title: 'absolute magnitude', value: '19.09', sigma: '0.19', units: null, notes: null, ref: 'Pravec et al.' }],
	discovery: { date: '2004-Jun-19', location: 'Kitt Peak', who: 'Tholen, D. J.', discovery: 'Discovered by...', citation: null, site: null },
	alt_orbits: [],
	radar_obs: [{ epoch: '2005-01-27 23:31:00', value: '-100849.1434', sigma: '0.250', units: 'Hz', freq: '2380', observer: 'M. C. Nolan', bp: 'C', rcvr: '-1', xmit: '-1', notes: null }],
	sat: [],
	vi_data: [],
	ca_data: [{ jd: '2462240.407091969' }],
} as unknown as SmallBodySearchFound

test('details of an SBDB match keep the published text and drop what is not published', () => {
	const details = detailsOf(APOPHIS, 1000)

	expect(details.alternateDesignations).toEqual(['2004 MN4'])
	expect(details.orbitClassCode).toBe('ATE')
	expect(details.orbit.elements).toEqual([{ name: 'e', title: 'eccentricity', value: '.1911', sigma: '1.6e-07' }])
	expect(details.orbit.model).toEqual([{ name: 'A1', title: 'non-grav. radial accel.', value: '5.E-13', sigma: '4.892E-13', units: 'au/d^2' }])
	expect(details.orbit.delayObservations).toBe(25)
	expect(details.orbit.dopplerObservations).toBeUndefined()
	expect(details.orbit.producer).toBeUndefined()
	expect(details.physical[0]).toEqual({ name: 'H', title: 'absolute magnitude', value: '19.09', sigma: '0.19', reference: 'Pravec et al.' })
	expect(details.discovery).toEqual({ date: '2004-Jun-19', location: 'Kitt Peak', who: 'Tholen, D. J.', narrative: 'Discovered by...' })
	expect(details.radar).toEqual([{ epoch: '2005-01-27 23:31:00', value: '-100849.1434', sigma: '0.250', units: 'Hz', frequency: '2380', observer: 'M. C. Nolan' }])
	expect(details.virtualImpactors).toBeEmpty()
	expect(details.sourceVersion).toBe('1.3')
	expect(details.fetchedAt).toBe(1000)
})

test('details are looked up by exact designation, once an hour, sharing the cache of the bodies', async () => {
	let now = 1000
	const lookups: string[] = []
	const bodies = new MinorBodies({
		now: () => now,
		fetch: (text, _, selector) => {
			lookups.push(`${selector}:${text}`)
			return Promise.resolve(text === '99942' ? APOPHIS : { message: 'specified object was not found' })
		},
	})

	const found = await bodies.details('99942')
	expect(found.kind).toBe('found')
	if (found.kind === 'found') expect(found.body).toMatchObject({ spkId: '20099942', designation: '99942', pha: true })

	await bodies.details('99942')
	expect((await bodies.body('20099942'))?.body.name).toBe('99942 Apophis (2004 MN4)')
	expect(lookups).toEqual(['des:99942'])

	now += 3_600_000
	await bodies.details('99942')
	expect(lookups).toEqual(['des:99942', 'des:99942'])

	expect(await bodies.details('2099 ZZ999')).toEqual({ kind: 'notFound', message: 'specified object was not found' })
})

test('details of a format of another major version are refused', async () => {
	const bodies = new MinorBodies({ fetch: () => Promise.resolve({ ...APOPHIS, signature: { ...APOPHIS.signature, version: '2.0' } }) })
	expect(await bodies.details('99942').catch((e: unknown) => e)).toMatchObject({ kind: 'unsupportedVersion', version: '2.0' })
})

test('a designation SBDB cannot read names no body', async () => {
	const fetch = (() => Promise.resolve(Response.json({ code: '400', message: 'invalid designation' }, { status: 400 }))) as unknown as typeof globalThis.fetch
	const bodies = new MinorBodies({ queue: new SsdRequestQueue({ fetch }) })

	expect(await bodies.details('???')).toEqual({ kind: 'notFound', message: 'invalid designation' })
	expect(await bodies.search('???').catch((e: unknown) => e)).toBeInstanceOf(SbdbUnavailableError)
})

test('lookups go through the JPL queue, identified', async () => {
	const urls: string[] = []
	const agents: (string | null)[] = []
	const fetch = ((url: string, init: RequestInit) => {
		urls.push(url)
		agents.push(new Headers(init.headers).get('User-Agent'))
		return Promise.resolve(Response.json(CERES))
	}) as unknown as typeof globalThis.fetch
	const queue = new SsdRequestQueue({ fetch })
	queue.identify('1.2.3')

	expect((await new MinorBodies({ queue }).search('ceres')).kind).toBe('found')
	expect(new URL(urls[0]).searchParams.get('sstr')).toBe('ceres')
	expect(agents[0]).toBe('Nebulosa/1.2.3 (+https://github.com/tiagohm/nebulosa.app)')
})

test('a throttling answer of SBDB is unavailable, keeping its cause', async () => {
	const queue = new SsdRequestQueue({ fetch: (() => Promise.resolve(new Response('', { status: 429 }))) as unknown as typeof fetch })
	const error = (await new MinorBodies({ queue }).search('ceres').catch((e: unknown) => e)) as SbdbUnavailableError

	expect(error).toBeInstanceOf(SbdbUnavailableError)
	expect(error.cause).toBeInstanceOf(SsdThrottledError)
})

test('unreachable or slow SBDB', async () => {
	const offline = new MinorBodies({ fetch: () => Promise.reject(new TypeError('fetch failed')) })
	expect(await offline.search('ceres').catch((e: unknown) => e)).toBeInstanceOf(SbdbUnavailableError)

	const slow = new MinorBodies({
		timeoutMs: 20,
		fetch: (_, signal) =>
			new Promise((_, reject) => {
				signal.addEventListener('abort', () => reject(new Error('aborted')))
			}),
	})
	const error = await slow.search('ceres').catch((e: unknown) => e)
	expect(error).toBeInstanceOf(SbdbUnavailableError)
	expect((error as Error).message).toBe('SBDB did not answer in time')
})
