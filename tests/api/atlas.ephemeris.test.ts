import { describe, expect, spyOn, test } from 'bun:test'
import * as coordinate from 'nebulosa/src/astronomy/coordinates/coordinate'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import { DEG2RAD, TAU } from 'nebulosa/src/core/constants'
import type { CsvRow } from 'nebulosa/src/io/csv'
import { deg, parseAngle, toDeg } from 'nebulosa/src/math/units/angle'
import { meter, toKilometer } from 'nebulosa/src/math/units/distance'
import {
	AtlasEphemeris,
	classifyHorizonsFailure,
	EphemerisInterpolationError,
	EphemerisUnavailableError,
	HORIZONS_BREAKER_FAILURE_THRESHOLD,
	HORIZONS_BREAKER_OPEN_MS,
	HorizonsEphemerisError,
	HorizonsHttpError,
	HorizonsTimeoutError,
	horizonsPositionAt,
	observeSolarSystemBody,
	planetTargetFromCode,
} from 'src/api/atlas.ephemeris'
import type { EphemerisProvider, EphemerisSampleRequest, EphemerisTarget, HorizonsObserver } from 'src/api/atlas.ephemeris'
import { makeTime } from 'src/api/util'
import type { OsculatingElementsInput } from '#/asteroid'
import { DEFAULT_BODY_POSITION, resolveBodyPositionFlags } from '#/atlas'
import type { BodyPosition, PositionOfBody } from '#/atlas'
import type { SkyObject } from '#/galaxy'

const REQ_A: PositionOfBody = {
	time: {
		utc: 1753628400000,
		offset: -180,
	},
	location: {
		latitude: deg(-22),
		longitude: deg(-45),
		elevation: meter(890),
	},
}

const REQ_B: PositionOfBody = {
	...REQ_A,
	location: {
		latitude: deg(-10),
		longitude: deg(-40),
		elevation: meter(200),
	},
}

function horizonsRows(startMs: number, azimuthDeg: number, count = 1441): CsvRow[] {
	const rows = new Array<CsvRow>(count)

	for (let i = 0; i < count; i++) {
		const utc = startMs + i * 60000
		rows[i] = [formatTemporal(utc, 'YYYY-MMM-DD HH:mm', 0), '', '', '0', '0', '0', '0', String(azimuthDeg), String(azimuthDeg + 1), '1.0', '', '8.3', '1', '0', '/T', 'and']
	}

	return rows
}

function observerLatitude(coord: Parameters<HorizonsObserver>[2]) {
	return Array.isArray(coord) ? coord[1] : 0
}

function observerLabel(input: Parameters<HorizonsObserver>[0]) {
	if (typeof input === 'string') return input
	if ('id' in input && typeof input.id === 'number') return `TLE:${input.id}`
	return 'elements'
}

function recordingObserver() {
	const calls: string[] = []
	const observer: HorizonsObserver = (input, _center, coord, startTime) => {
		calls.push(observerLabel(input))
		const startMs = typeof startTime === 'number' ? startTime : 0
		return Promise.resolve(horizonsRows(startMs, toDeg(observerLatitude(coord))))
	}
	return { observer, calls }
}

describe('horizons cache identity', () => {
	test('two locations do not share a tile, and returning to A does not yield B', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		const a1 = await ephemeris.positionFromHorizons('10', REQ_A)
		const b = await ephemeris.positionFromHorizons('10', REQ_B)
		const a2 = await ephemeris.positionFromHorizons('10', REQ_A)

		expect(calls).toHaveLength(2)
		expect(a1.horizontal[0]).toBeCloseTo(REQ_A.location.latitude, 12)
		expect(b.horizontal[0]).toBeCloseTo(REQ_B.location.latitude, 12)
		expect(a2.horizontal[0]).toBeCloseTo(a1.horizontal[0], 12)
		expect(a2.horizontal[0]).not.toBeCloseTo(b.horizontal[0], 5)
	})

	test('identical concurrent requests share one Horizons fetch', async () => {
		const gate = Promise.withResolvers<CsvRow[]>()
		let fetches = 0
		const observer: HorizonsObserver = (_input, _center, _coord, startTime) => {
			fetches++
			const startMs = typeof startTime === 'number' ? startTime : 0
			gate.resolve(horizonsRows(startMs, 1))
			return gate.promise
		}
		const ephemeris = new AtlasEphemeris({ observer })

		const [first, second, third] = await Promise.all([ephemeris.positionFromHorizons('10', REQ_A), ephemeris.positionFromHorizons('10', REQ_A), ephemeris.positionFromHorizons('10', REQ_A)])

		expect(fetches).toBe(1)
		expect(first.horizontal[0]).toBeCloseTo(deg(1), 12)
		expect(second.horizontal[0]).toBeCloseTo(first.horizontal[0], 12)
		expect(third.horizontal[0]).toBeCloseTo(first.horizontal[0], 12)
	})

	test('different targets do not share a series', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.positionFromHorizons('10', REQ_A)
		await ephemeris.positionFromHorizons('301', REQ_A)

		expect(calls).toEqual(['10', '301'])
	})

	test('a new TLE for the same id does not reuse the previous tile', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const first = { id: 25544, line1: '1 25544U 98067A   25200.00000000  .00000000  00000-0  00000-0 0  9990', line2: '2 25544  51.6400 000.0000 0000000   0.0000   0.0000 15.50000000000000' }
		const second = { ...first, line1: '1 25544U 98067A   25201.00000000  .00000000  00000-0  00000-0 0  9991' }

		await ephemeris.positionFromHorizons(first, REQ_A)
		await ephemeris.positionFromHorizons(second, REQ_A)

		expect(calls).toHaveLength(2)
	})
})

describe('horizons sample immutability', () => {
	test('a later request does not mutate an earlier BodyPosition', async () => {
		const { observer } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const later: PositionOfBody = { ...REQ_A, time: { ...REQ_A.time, utc: REQ_A.time.utc + 3600000 } }

		const noon = await ephemeris.positionFromHorizons('10', REQ_A)
		const noonLst = noon.lst
		const afternoon = await ephemeris.positionFromHorizons('10', later)

		expect(noon.lst).toBe(noonLst)
		expect(afternoon.lst).not.toBe(noonLst)
		expect(noon).not.toBe(afternoon)
		expect((await ephemeris.positionFromHorizons('10', REQ_A)).lst).toBe(noonLst)

		const cached = ephemeris.cachedPositions('10', REQ_A)
		const sample = cached?.get(Math.trunc(REQ_A.time.utc / 1000))
		expect(sample).toBeDefined()
		expect(Object.isFrozen(sample)).toBe(true)
	})

	test('chart altitudes stay with the observer that fetched them', async () => {
		const { observer } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.positionFromHorizons('10', REQ_A)
		const chartA = ephemeris.chartFromHorizons('10', REQ_A)
		await ephemeris.positionFromHorizons('10', REQ_B)
		const chartAAgain = ephemeris.chartFromHorizons('10', REQ_A)
		const chartB = ephemeris.chartFromHorizons('10', REQ_B)

		expect(chartA).toHaveLength(1441)
		expect(chartAAgain[0]).toBe(chartA[0])
		expect(chartB[0]).not.toBe(chartA[0])
		expect(chartA[0]).toBeCloseTo(REQ_A.location.latitude + deg(1), 12)
		expect(chartB[0]).toBeCloseTo(REQ_B.location.latitude + deg(1), 12)
	})
})

describe('horizons series LRU', () => {
	test('the oldest series is evicted once the limit is exceeded', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer, cacheLimit: 2 })
		const loc = (latitudeDeg: number): PositionOfBody => ({
			...REQ_A,
			location: { ...REQ_A.location, latitude: deg(latitudeDeg) },
		})

		await ephemeris.positionFromHorizons('10', loc(0))
		await ephemeris.positionFromHorizons('10', loc(1))
		await ephemeris.positionFromHorizons('10', loc(2))
		expect(calls).toHaveLength(3)

		await ephemeris.positionFromHorizons('10', loc(2))
		expect(calls).toHaveLength(3)

		await ephemeris.positionFromHorizons('10', loc(0))
		expect(calls).toHaveLength(4)
	})
})

const JUPITER: EphemerisTarget = { type: 'planet', code: '599', name: 'jupiter' }

const STUB_STAR: SkyObject = {
	id: 1,
	name: 'Stub',
	type: 29,
	rightAscension: 0,
	declination: 0,
	pmRA: 0,
	pmDEC: 0,
	magnitude: 5,
	distance: 0,
	rv: 0,
	constellation: 0,
}

function stubSeries(source: 'offline' | 'horizons', request: EphemerisSampleRequest) {
	const samples = new Map<number, typeof DEFAULT_BODY_POSITION>()
	if (request.start === request.end) {
		samples.set(request.start, DEFAULT_BODY_POSITION)
	} else {
		const startSec = Math.trunc(request.start / 1000)
		const endSec = Math.trunc(request.end / 1000)
		for (let s = startSec; s <= endSec; s += 60) samples.set(s, DEFAULT_BODY_POSITION)
	}
	return { key: `${source}|stub`, source, samples }
}

function stubProvider(source: 'offline' | 'horizons', types: ReadonlySet<EphemerisTarget['type']>) {
	let calls = 0
	const provider: EphemerisProvider = {
		source,
		supports: (target) => types.has(target.type),
		samples: (request) => {
			calls++
			return Promise.resolve(stubSeries(source, request))
		},
	}
	return {
		provider,
		get calls() {
			return calls
		},
	}
}

describe('planetTargetFromCode', () => {
	test('maps sun, moon, pluto, and VSOP planets', () => {
		expect(planetTargetFromCode('10')).toEqual({ type: 'sun' })
		expect(planetTargetFromCode('301')).toEqual({ type: 'moon' })
		expect(planetTargetFromCode('999')).toEqual({ type: 'pluto' })
		expect(planetTargetFromCode('199')).toEqual({ type: 'planet', code: '199', name: 'mercury' })
		expect(planetTargetFromCode('599')).toEqual({ type: 'planet', code: '599', name: 'jupiter' })
	})

	test('maps natural satellites, minor-body commands, and opaque Horizons codes', () => {
		expect(planetTargetFromCode('901')).toEqual({ type: 'naturalSatellite', code: '901' })
		expect(planetTargetFromCode('401')).toEqual({ type: 'naturalSatellite', code: '401' })
		expect(planetTargetFromCode('DES=20000001;')).toEqual({ type: 'minorBody', command: 'DES=20000001;' })
		expect(planetTargetFromCode('1;')).toEqual({ type: 'minorBody', command: '1;' })
		expect(planetTargetFromCode(';')).toEqual({ type: 'minorBody', command: ';' })
		expect(planetTargetFromCode('505')).toEqual({ type: 'horizons', command: '505' })
	})
})

describe('provider selection', () => {
	test('fast true and offline available never calls observer', async () => {
		const { observer, calls } = recordingObserver()
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		const position = await ephemeris.position(JUPITER, { ...REQ_A, fast: true })

		expect(calls).toHaveLength(0)
		expect(offline.calls).toBe(1)
		expect(position).toBe(DEFAULT_BODY_POSITION)
	})

	test('fast false uses Horizons when it supports the target', async () => {
		const { observer, calls } = recordingObserver()
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		const position = await ephemeris.position(JUPITER, REQ_A)

		expect(calls).toEqual(['599'])
		expect(offline.calls).toBe(0)
		expect(position).not.toBe(DEFAULT_BODY_POSITION)
	})

	test('star and sky point stay offline when fast is false', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.position({ type: 'star', object: STUB_STAR }, REQ_A)
		await ephemeris.position({ type: 'skyPoint', rightAscension: 0, declination: 0 }, REQ_A)

		expect(calls).toHaveLength(0)
	})

	test('fast true still calls Horizons for Charon', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.position(planetTargetFromCode('901'), { ...REQ_A, fast: true })

		expect(calls).toEqual(['901'])
	})

	test('fast true still calls Horizons for DES without elements', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.position(planetTargetFromCode('DES=20000001;'), { ...REQ_A, fast: true })

		expect(calls).toEqual(['DES=20000001;'])
	})

	test('fast true on a VSOP planet does not call observer', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		await ephemeris.position(JUPITER, { ...REQ_A, fast: true })

		expect(calls).toHaveLength(0)
	})

	test('a target with no provider throws EphemerisUnavailableError', () => {
		const none = stubProvider('offline', new Set())
		const ephemeris = new AtlasEphemeris({ horizons: none.provider, offline: none.provider })

		expect(ephemeris.position(JUPITER, REQ_A)).rejects.toBeInstanceOf(EphemerisUnavailableError)
	})

	test('a semantic Horizons failure is not masked by an offline model', () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsHttpError(400))
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		expect(ephemeris.position(JUPITER, REQ_A)).rejects.toBeInstanceOf(HorizonsEphemerisError)
		expect(offline.calls).toBe(0)
	})
})

function angularSeparationArcsec(a: readonly [number, number], b: readonly [number, number]) {
	const dRa = (a[0] - b[0]) * Math.cos((a[1] + b[1]) / 2)
	const dDec = a[1] - b[1]
	return Math.hypot(dRa, dDec) * (180 / Math.PI) * 3600
}

const CERES_ELEMENTS: OsculatingElementsInput = {
	epoch: 2461000.5,
	referenceEclipticFrame: 'J2000',
	ec: 0.07957631994408416,
	tpqr: { ma: 231.5397330043706 * DEG2RAD, a: 2.765615651508659 },
	om: 80.24963090816965 * DEG2RAD,
	w: 73.29975464616518 * DEG2RAD,
	i: 10.58788658206854 * DEG2RAD,
	h: 3.35,
	g: 0.12,
}

describe('offline solar-system models', () => {
	test('observeSolarSystemBody sun stays within a few arcseconds of Horizons', () => {
		const time = makeTime(REQ_A.time.utc, REQ_A.location)
		const position = observeSolarSystemBody(vsop.sun, time, -26.74)
		const horizons: readonly [number, number] = [parseAngle('08 28 44.08', true)!, parseAngle('19 02 29.5')!]

		expect(angularSeparationArcsec(position.equatorial, horizons)).toBeLessThan(5)
		expect(toKilometer(position.distance)).toBeCloseTo(151909927.865284, -4)
		expect(position.magnitude).toBe(-26.74)
		expect(position.illuminated).toBe(1)
		expect(position.elongation).toBe(0)
	})

	test('fast true Jupiter and Moon stay within a few arcseconds of Horizons', async () => {
		const ephemeris = new AtlasEphemeris({ observer: recordingObserver().observer })
		const req = { ...REQ_A, fast: true }
		const jupiter = await ephemeris.position(JUPITER, req)
		const moon = await ephemeris.position({ type: 'moon' }, req)

		expect(angularSeparationArcsec(jupiter.equatorial, [parseAngle('06 46 51.69', true)!, parseAngle('22 53 45.8')!])).toBeLessThan(5)
		expect(jupiter.magnitude).toBeCloseTo(-1.908, 1)
		expect(angularSeparationArcsec(moon.equatorial, [parseAngle('10 48 30.64', true)!, parseAngle('09 07 43.3')!])).toBeLessThan(10)
		expect(moon.magnitude).toBeNull()
	})

	test('fast true uses local models for moon, pluto, phobos, and miranda', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const req = { ...REQ_A, fast: true }

		await ephemeris.position({ type: 'moon' }, req)
		await ephemeris.position({ type: 'pluto' }, req)
		await ephemeris.position(planetTargetFromCode('401'), req)
		await ephemeris.position(planetTargetFromCode('705'), req)

		expect(calls).toHaveLength(0)
	})

	test('code 607 uses Hyperion, not Iapetus', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const req = { ...REQ_A, fast: true }

		const hyperion = await ephemeris.position(planetTargetFromCode('607'), req)
		const iapetus = await ephemeris.position(planetTargetFromCode('608'), req)

		expect(calls).toHaveLength(0)
		expect(angularSeparationArcsec(hyperion.equatorial, iapetus.equatorial)).toBeGreaterThan(60)
	})

	test('fast true with osculating elements uses Kepler and skips observer', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const target = planetTargetFromCode('DES=20000001;', CERES_ELEMENTS)

		const position = await ephemeris.position(target, { ...REQ_A, fast: true })

		expect(calls).toHaveLength(0)
		expect(position.magnitude).not.toBeNull()
	})

	test('B1950 elements stay on Horizons even when fast is true', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const target = planetTargetFromCode(';', { ...CERES_ELEMENTS, referenceEclipticFrame: 'B1950' })

		await ephemeris.position(target, { ...REQ_A, fast: true })

		expect(calls).toEqual([';'])
	})

	test('eccentricity at or above 1 uses the perihelion Kepler branch', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const target = planetTargetFromCode(';', {
			...CERES_ELEMENTS,
			ec: 1.2,
			tpqr: { qr: 0.5, tp: 2461000.5 },
		})

		await ephemeris.position(target, { ...REQ_A, fast: true })

		expect(calls).toHaveLength(0)
	})

	test('SGP4 at the requested timestamp does not call observer', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const satellite = {
			id: 25544,
			name: 'ISS',
			groups: [],
			line1: '1 25544U 98067A   25200.00000000  .00000000  00000-0  00000-0 0  9990',
			line2: '2 25544  51.6400 000.0000 0000000   0.0000   0.0000 15.50000000000000',
		}

		await ephemeris.position({ type: 'satellite', satellite }, { ...REQ_A, fast: true })

		expect(calls).toHaveLength(0)
	})
})

function frozenSample(overrides: Partial<BodyPosition>): BodyPosition {
	return {
		...DEFAULT_BODY_POSITION,
		equatorial: [0, 0],
		equatorialJ2000: [0, 0],
		horizontal: [0, 0],
		...overrides,
	}
}

describe('Horizons exact-time interpolation', () => {
	test('the on-grid instant still uses the frozen sample', async () => {
		const { observer } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })
		const onGrid = await ephemeris.positionFromHorizons('10', REQ_A)

		expect(onGrid.horizontal[0]).toBeCloseTo(REQ_A.location.latitude, 12)
	})

	test('RA wrapping through 0 is interpolated along the short arc', () => {
		const t0 = REQ_A.time.utc / 1000
		const samples = new Map<number, BodyPosition>([
			[t0, frozenSample({ equatorial: [deg(359.9), 0], equatorialJ2000: [deg(359.9), 0], horizontal: [deg(359.9), 0] })],
			[t0 + 60, frozenSample({ equatorial: [deg(0.1), 0], equatorialJ2000: [deg(0.1), 0], horizontal: [deg(0.1), 0] })],
		])
		const mid = horizonsPositionAt(samples, { ...REQ_A, time: { ...REQ_A.time, utc: REQ_A.time.utc + 30000 } })

		expect(Math.min(mid.equatorial[0], TAU - mid.equatorial[0])).toBeLessThan(1e-9)
		expect(Math.min(mid.horizontal[0], TAU - mid.horizontal[0])).toBeLessThan(1e-9)
	})

	test('an instant outside the tile throws EphemerisInterpolationError', () => {
		const t0 = REQ_A.time.utc / 1000
		const samples = new Map<number, BodyPosition>([
			[t0, frozenSample({})],
			[t0 + 60, frozenSample({})],
		])

		expect(() => horizonsPositionAt(samples, { ...REQ_A, time: { ...REQ_A.time, utc: REQ_A.time.utc - 1 } })).toThrow(EphemerisInterpolationError)
		expect(() => horizonsPositionAt(samples, { ...REQ_A, time: { ...REQ_A.time, utc: REQ_A.time.utc + 120000 } })).toThrow(EphemerisInterpolationError)
	})

	test('a millisecond between samples is honoured', () => {
		const t0 = REQ_A.time.utc / 1000
		const samples = new Map<number, BodyPosition>([
			[t0, frozenSample({ distance: 1, equatorial: [0, 0], equatorialJ2000: [0, 0] })],
			[t0 + 60, frozenSample({ distance: 2, equatorial: [deg(1), 0], equatorialJ2000: [deg(1), 0] })],
		])
		const atMs = horizonsPositionAt(samples, { ...REQ_A, time: { ...REQ_A.time, utc: REQ_A.time.utc + 1 } })

		expect(atMs.distance).toBeGreaterThan(1)
		expect(atMs.distance).toBeLessThan(1 + (1 / 60000) * 2)
		expect(atMs.equatorial[0]).toBeGreaterThan(0)
		expect(atMs.equatorial[0]).toBeLessThan(deg(1) / 1000)
	})
})

describe('BodyPosition flags', () => {
	test('omitted flags resolve to every field', () => {
		expect(resolveBodyPositionFlags({})).toEqual({
			equatorial: true,
			equatorialJ2000: true,
			horizontal: true,
			ecliptic: true,
			galactic: true,
			constellation: true,
			lst: true,
			names: true,
			magnitude: true,
			distance: true,
			illuminated: true,
			elongation: true,
			leading: true,
		})
	})

	test('one true flag does not enable the others', () => {
		expect(resolveBodyPositionFlags({ horizontal: true })).toMatchObject({
			horizontal: true,
			galactic: false,
			ecliptic: false,
			equatorial: false,
			illuminated: false,
			lst: false,
		})
	})

	test('omitted flags still yield a complete BodyPosition', async () => {
		const ephemeris = new AtlasEphemeris({ observer: recordingObserver().observer })
		const position = await ephemeris.position({ type: 'sun' }, { ...REQ_A, fast: true })

		expect(position.equatorial[0]).not.toBe(0)
		expect(position.equatorialJ2000[0]).not.toBe(0)
		expect(position.horizontal[1]).not.toBe(0)
		expect(position.ecliptic[0]).not.toBe(0)
		expect(position.galactic[0]).not.toBe(0)
		expect(position.lst).not.toBe(0)
		expect(position.constellation).not.toBe('AND')
		expect(position.magnitude).toBe(-26.74)
		expect(position.distance).toBeGreaterThan(0)
		expect(position.illuminated).toBe(1)
		expect(position.elongation).toBe(0)
		expect(position.pierSide).not.toBe('NEITHER')
	})

	test('horizontal true does not compute galactic or ecliptic', async () => {
		const galactic = spyOn(coordinate, 'equatorialToGalatic')
		const ecliptic = spyOn(coordinate, 'equatorialToEcliptic')
		const ephemeris = new AtlasEphemeris({ observer: recordingObserver().observer })

		try {
			const position = await ephemeris.position({ type: 'sun' }, { ...REQ_A, fast: true, horizontal: true })

			expect(position.horizontal[1]).not.toBe(0)
			expect(position.galactic).toEqual([0, 0])
			expect(position.ecliptic).toEqual([0, 0])
			expect(position.equatorial).toEqual([0, 0])
			expect(position.lst).toBe(0)
			expect(position.constellation).toBe('AND')
			expect(position.magnitude).toBe(0)
			expect(position.illuminated).toBe(0)
			expect(galactic).not.toHaveBeenCalled()
			expect(ecliptic).not.toHaveBeenCalled()
		} finally {
			galactic.mockRestore()
			ecliptic.mockRestore()
		}
	})

	test('galactic true fills galactic from J2000 and leaves horizontal at the default', async () => {
		const ephemeris = new AtlasEphemeris({ observer: recordingObserver().observer })
		const position = await ephemeris.position({ type: 'sun' }, { ...REQ_A, fast: true, galactic: true })

		expect(position.galactic).not.toEqual([0, 0])
		expect(position.horizontal).toEqual([0, 0])
		expect(position.equatorial).toEqual([0, 0])
		expect(position.ecliptic).toEqual([0, 0])
		expect(position.lst).toBe(0)
	})

	test('illuminated true does not fill unrelated frames', async () => {
		const galactic = spyOn(coordinate, 'equatorialToGalatic')
		const ephemeris = new AtlasEphemeris({ observer: recordingObserver().observer })

		try {
			const position = await ephemeris.position({ type: 'sun' }, { ...REQ_A, fast: true, illuminated: true })

			expect(position.illuminated).toBe(1)
			expect(position.horizontal).toEqual([0, 0])
			expect(position.galactic).toEqual([0, 0])
			expect(position.ecliptic).toEqual([0, 0])
			expect(position.equatorial).toEqual([0, 0])
			expect(position.magnitude).toBe(0)
			expect(galactic).not.toHaveBeenCalled()
		} finally {
			galactic.mockRestore()
		}
	})

	test('different flags reuse the same Horizons series', async () => {
		const { observer, calls } = recordingObserver()
		const ephemeris = new AtlasEphemeris({ observer })

		const horizontal = await ephemeris.position({ type: 'sun' }, { ...REQ_A, horizontal: true })
		const galactic = await ephemeris.position({ type: 'sun' }, { ...REQ_A, galactic: true })

		expect(calls).toHaveLength(1)
		expect(horizontal.horizontal[0]).toBeCloseTo(REQ_A.location.latitude, 12)
		expect(horizontal.galactic).toEqual([0, 0])
		expect(galactic.galactic).not.toEqual([0, 0])
		expect(galactic.horizontal).toEqual([0, 0])
	})
})

function abortError() {
	const error = new Error('aborted')
	error.name = 'AbortError'
	return error
}

function connectionError(code: string) {
	const error = new Error(code) as Error & { code: string }
	error.code = code
	return error
}

describe('Horizons failure classification', () => {
	test('timeout, abort, TypeError, connection reset, 429, and 5xx are transient', () => {
		expect(classifyHorizonsFailure(new HorizonsTimeoutError())).toBe('transient')
		expect(classifyHorizonsFailure(abortError())).toBe('transient')
		expect(classifyHorizonsFailure(new TypeError('fetch failed'))).toBe('transient')
		expect(classifyHorizonsFailure(connectionError('ECONNRESET'))).toBe('transient')
		expect(classifyHorizonsFailure(new HorizonsHttpError(429))).toBe('transient')
		expect(classifyHorizonsFailure(new HorizonsHttpError(503))).toBe('transient')
	})

	test('HTTP 400, empty ephemeris, and unknown errors are semantic', () => {
		expect(classifyHorizonsFailure(new HorizonsHttpError(400))).toBe('semantic')
		expect(classifyHorizonsFailure(new HorizonsEphemerisError('empty ephemeris'))).toBe('semantic')
		expect(classifyHorizonsFailure(new Error('bug'))).toBe('semantic')
	})
})

describe('Horizons fallback and circuit breaker', () => {
	test('timeout with an offline model falls back', async () => {
		const observer: HorizonsObserver = () => new Promise(() => {})
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider, horizonsTimeoutMs: 20 })

		const position = await ephemeris.position(JUPITER, REQ_A)

		expect(offline.calls).toBe(1)
		expect(position).toBe(DEFAULT_BODY_POSITION)
	})

	test('network error with an offline model falls back', async () => {
		const observer: HorizonsObserver = () => Promise.reject(new TypeError('fetch failed'))
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		await ephemeris.position(JUPITER, REQ_A)

		expect(offline.calls).toBe(1)
	})

	test('HTTP 429 with an offline model falls back', async () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsHttpError(429))
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		await ephemeris.position(JUPITER, REQ_A)

		expect(offline.calls).toBe(1)
	})

	test('HTTP 500 with an offline model falls back', async () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsHttpError(500))
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		await ephemeris.position(JUPITER, REQ_A)

		expect(offline.calls).toBe(1)
	})

	test('HTTP 400 does not fall back even with elements', () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsHttpError(400))
		const ephemeris = new AtlasEphemeris({ observer })
		const target = planetTargetFromCode('DES=20000001;', CERES_ELEMENTS)

		expect(ephemeris.position(target, REQ_A)).rejects.toBeInstanceOf(HorizonsEphemerisError)
	})

	test('empty Horizons CSV does not fall back', () => {
		const observer: HorizonsObserver = () => Promise.resolve([])
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		expect(ephemeris.position(JUPITER, REQ_A)).rejects.toBeInstanceOf(HorizonsEphemerisError)
		expect(offline.calls).toBe(0)
	})

	test('Horizons down without an offline model preserves the cause', () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsTimeoutError())
		const ephemeris = new AtlasEphemeris({ observer })

		expect(ephemeris.position(planetTargetFromCode('901'), REQ_A)).rejects.toMatchObject({
			name: 'EphemerisUnavailableError',
			cause: expect.any(HorizonsTimeoutError),
		})
	})

	test('fast true plus Horizons timeout without an offline model does not hop again', () => {
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsTimeoutError())
		}
		const ephemeris = new AtlasEphemeris({ observer })

		expect(ephemeris.position(planetTargetFromCode('901'), { ...REQ_A, fast: true })).rejects.toBeInstanceOf(EphemerisUnavailableError)
		expect(calls).toBe(1)
	})

	test('an open breaker with an offline model does not wait for Horizons', async () => {
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsTimeoutError())
		}
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider })

		for (let i = 0; i < HORIZONS_BREAKER_FAILURE_THRESHOLD; i++) await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD)

		await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD)
		expect(offline.calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD + 1)
	})

	test('an open breaker without an offline model still calls Horizons when fast is true', async () => {
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsTimeoutError())
		}
		const ephemeris = new AtlasEphemeris({ observer })
		const req = { ...REQ_A, fast: true }
		const target = planetTargetFromCode('901')

		for (let i = 0; i < HORIZONS_BREAKER_FAILURE_THRESHOLD; i++) {
			try {
				await ephemeris.position(target, req)
				throw new Error('expected Horizons to fail')
			} catch (error) {
				expect(error).toBeInstanceOf(EphemerisUnavailableError)
			}
		}

		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD)
		try {
			await ephemeris.position(target, req)
			throw new Error('expected Horizons to fail')
		} catch (error) {
			expect(error).toBeInstanceOf(EphemerisUnavailableError)
		}
		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD + 1)
	})

	test('an open breaker without an offline model throws immediately when fast is false', async () => {
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsTimeoutError())
		}
		const ephemeris = new AtlasEphemeris({ observer })

		for (let i = 0; i < HORIZONS_BREAKER_FAILURE_THRESHOLD; i++) await ephemeris.position(planetTargetFromCode('901'), REQ_A).catch(() => {})

		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD)
		expect(ephemeris.position(planetTargetFromCode('901'), REQ_A)).rejects.toBeInstanceOf(HorizonsEphemerisError)
		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD)
	})

	test('HTTP 429 opens the breaker until Retry-After', async () => {
		let now = 1_000
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsHttpError(429, 'too many requests', { retryAfterMs: 5_000 }))
		}
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider, now: () => now })

		await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(1)

		await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(1)

		now += 5_000
		await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(2)
	})

	test('timeout plus elements falls back to Kepler', async () => {
		const observer: HorizonsObserver = () => Promise.reject(new HorizonsTimeoutError())
		const ephemeris = new AtlasEphemeris({ observer })
		const target = planetTargetFromCode('DES=20000001;', CERES_ELEMENTS)

		const position = await ephemeris.position(target, REQ_A)

		expect(position.magnitude).not.toBeNull()
		expect(position.equatorial[0]).not.toBe(0)
	})

	test('an expired breaker window tries Horizons again', async () => {
		let now = 0
		let calls = 0
		const observer: HorizonsObserver = () => {
			calls++
			return Promise.reject(new HorizonsTimeoutError())
		}
		const offline = stubProvider('offline', new Set(['planet']))
		const ephemeris = new AtlasEphemeris({ observer, offline: offline.provider, now: () => now })

		for (let i = 0; i < HORIZONS_BREAKER_FAILURE_THRESHOLD; i++) await ephemeris.position(JUPITER, REQ_A)
		now += HORIZONS_BREAKER_OPEN_MS
		await ephemeris.position(JUPITER, REQ_A)
		expect(calls).toBe(HORIZONS_BREAKER_FAILURE_THRESHOLD + 1)
	})
})
