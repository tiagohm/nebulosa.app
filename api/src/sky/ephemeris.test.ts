import { expect, test } from 'bun:test'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { EphemerisUnavailableError, findEvents, HorizonsEphemerisError, type HorizonsObserver, SkyEphemeris } from './ephemeris'

const observer = { latitude: -23.5, longitude: -46.6, elevation: 760 }

// 2026-10-18T12:00:00Z.
const TIME = Date.UTC(2026, 9, 18, 12)

// Mars at TIME seen from the observer, from an airless Horizons table (2026-10-18).
const MARS_ROW = ['', '', '', '134.01710', '18.69990', '134.39780', '18.59740', '326.690', '40.847', '0.960', '4.508', '89.80117', '12.79711001', '73.5840', '/L', 'Cnc', '']

// Builds a Horizons mock returning `rows` copies of a row, and counts its calls.
function horizons(row: readonly string[] | undefined) {
	const calls: string[] = []
	const observe = ((command: string, _center: string, _coord: unknown, start: number, end: number) => {
		calls.push(command)
		const count = Math.round((end - start) / 600_000) + 1
		return Promise.resolve(row ? Array.from({ length: count }, () => [...row]) : [])
	}) as unknown as HorizonsObserver
	return { observe, calls }
}

test('accurate positions come from Horizons', async () => {
	const { observe, calls } = horizons(MARS_ROW)
	const ephemeris = new SkyEphemeris({ observer: observe })
	const position = await ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer })

	expect(calls).toEqual(['499'])
	expect(position.source).toBe('horizons')
	expect(position.fallbackReason).toBeUndefined()
	expect(position.center).toBe('topocentric')
	expect(toDeg(position.rightAscension)).toBeCloseTo(134.3978, 4)
	expect(toDeg(position.declinationJ2000)).toBeCloseTo(18.6999, 4)
	// The airless elevation is refracted: about 1′ at 40°.
	expect(toDeg(position.altitude!) - 40.847).toBeCloseTo(0.019, 2)
	expect(position.magnitude).toBe(0.96)
	expect(position.illuminated).toBeCloseTo(0.898, 3)
	expect(position.distance).toBeCloseTo(1.5387, 4)
	expect(toDeg(position.elongation!)).toBeCloseTo(73.584, 3)
	expect(position.constellation).toBe('CNC')

	// The table is cached for the hour.
	await ephemeris.position({ type: 'body', code: '499' }, { time: TIME + 60_000, observer })
	expect(calls).toHaveLength(1)
})

test('local models agree with Horizons', async () => {
	const ephemeris = new SkyEphemeris({ observer: horizons(undefined).observe })
	const position = await ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer, mode: 'fast' })

	expect(position.source).toBe('local')
	expect(toDeg(position.rightAscension)).toBeCloseTo(134.3978, 2)
	expect(toDeg(position.declination)).toBeCloseTo(18.5974, 2)
	expect(toDeg(position.altitude!)).toBeCloseTo(40.867, 1)
	expect(position.distance).toBeCloseTo(1.5387, 3)
})

test('fast positions never call Horizons', async () => {
	const { observe, calls } = horizons(MARS_ROW)
	const ephemeris = new SkyEphemeris({ observer: observe })
	const position = await ephemeris.position({ type: 'body', code: '301' }, { time: TIME, mode: 'fast' })

	expect(calls).toEqual([])
	expect(position.center).toBe('geocentric')
	expect(position.altitude).toBeUndefined()
})

test('transient Horizons failures fall back to the local model and open the breaker', async () => {
	let calls = 0
	const observe = (() => {
		calls++
		return Promise.reject(new TypeError('fetch failed'))
	}) as unknown as HorizonsObserver
	const ephemeris = new SkyEphemeris({ observer: observe, now: () => TIME })

	for (let i = 0; i < 3; i++) {
		const position = await ephemeris.position({ type: 'body', code: '599' }, { time: TIME + i * 3_600_000, observer })
		expect(position.source).toBe('local')
		expect(position.fallbackReason).toBe('network')
	}

	const position = await ephemeris.position({ type: 'body', code: '599' }, { time: TIME, observer })
	expect(position.fallbackReason).toBe('breakerOpen')
	expect(calls).toBe(3)
})

test('Horizons timeouts fall back to the local model', async () => {
	const observe = (() => new Promise<never>(() => {})) as unknown as HorizonsObserver
	const ephemeris = new SkyEphemeris({ observer: observe, timeoutMs: 20 })
	const position = await ephemeris.position({ type: 'body', code: '10' }, { time: TIME, observer })

	expect(position.source).toBe('local')
	expect(position.fallbackReason).toBe('timeout')
	expect(position.magnitude).toBe(-26.74)
})

test('semantic Horizons failures are reported', async () => {
	const ephemeris = new SkyEphemeris({ observer: horizons(undefined).observe })
	expect(await ephemeris.position({ type: 'body', code: '499' }, { time: TIME, observer }).catch((e: unknown) => e)).toBeInstanceOf(HorizonsEphemerisError)
})

test('minor bodies without elements need Horizons', async () => {
	const observe = (() => Promise.reject(new TypeError('fetch failed'))) as unknown as HorizonsObserver
	const ephemeris = new SkyEphemeris({ observer: observe })
	expect(await ephemeris.position({ type: 'minorBody', spkId: '20000001' }, { time: TIME, observer }).catch((e: unknown) => e)).toBeInstanceOf(EphemerisUnavailableError)
	expect(ephemeris.events({ type: 'minorBody', spkId: '20000001' }, TIME, observer, 'minor:20000001')).toBeUndefined()
})

test('minor bodies with elements have a local model', async () => {
	// Ceres, SBDB solution of epoch JD 2461200.5.
	const elements = { epoch: 2461200.5, ec: 0.0795, tpqr: { a: 2.7656, ma: deg(268.9) }, i: deg(10.588), om: deg(80.25), w: deg(73.3), h: 3.34, g: 0.12 }
	const ephemeris = new SkyEphemeris({ observer: horizons(undefined).observe })
	const position = await ephemeris.position({ type: 'minorBody', spkId: '20000001', elements }, { time: TIME, observer, mode: 'fast' })

	expect(position.source).toBe('local')
	expect(position.distance).toBeGreaterThan(1)
	expect(position.magnitude).toBeGreaterThan(6)
	expect(position.magnitude).toBeLessThan(10)
})

test('catalog positions are local', async () => {
	const ephemeris = new SkyEphemeris({ observer: horizons(MARS_ROW).observe })
	const sirius = { rightAscension: 1.7677953696021995, declination: -0.291751258517685, pmRA: -0.0000027639303691821937, pmDEC: -0.000005929659164, magnitude: -1.44 }
	const position = await ephemeris.position({ type: 'catalog', object: sirius }, { time: TIME, observer })

	expect(position.source).toBe('local')
	expect(toDeg(position.rightAscension)).toBeCloseTo(101.586, 2)
	expect(toDeg(position.altitude!)).toBeCloseTo(34.75, 1)
	expect(position.constellation).toBe('CMA')

	const events = ephemeris.events({ type: 'catalog', object: sirius }, TIME, observer, 'catalog:32263')!
	expect(events.state).toBe('normal')
	// Sirius culminates near 08:05 UTC from São Paulo on 2026-10-18.
	expect(Math.abs(events.transit! - Date.UTC(2026, 9, 18, 8, 5, 26))).toBeLessThan(120_000)
	expect(toDeg(events.transitAltitude!)).toBeCloseTo(83.2, 0)
})

test('find events in sampled altitudes', () => {
	const times = Array.from({ length: 145 }, (_, i) => i * 600_000)
	// One sinusoidal day: rises at 6 h, culminates at 12 h, sets at 18 h.
	const altitudes = times.map((t) => Math.sin(((t / 3_600_000 - 6) / 24) * 2 * Math.PI))
	const events = findEvents(times, altitudes, 0, 12 * 3_600_000)

	expect(events.state).toBe('normal')
	expect(events.rise! / 3_600_000).toBeCloseTo(6, 2)
	expect(events.transit! / 3_600_000).toBeCloseTo(12, 2)
	expect(events.transitAltitude!).toBeCloseTo(1, 3)
	expect(events.set! / 3_600_000).toBeCloseTo(18, 2)

	expect(
		findEvents(
			times,
			times.map(() => 0.5),
			0,
			0,
		).state,
	).toBe('circumpolar')
	expect(
		findEvents(
			times,
			times.map(() => -0.5),
			0,
			0,
		).state,
	).toBe('belowHorizon')
})
