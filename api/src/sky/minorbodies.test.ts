import { expect, test } from 'bun:test'
import type { SmallBodySearch, SmallBodySearchFound } from 'nebulosa/src/adapters/orbits/sbd'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { elementsOf, MinorBodies, SbdbUnavailableError } from './minorbodies'

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
