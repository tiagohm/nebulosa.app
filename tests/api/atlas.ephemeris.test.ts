import { describe, expect, test } from 'bun:test'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { CsvRow } from 'nebulosa/src/io/csv'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { AtlasEphemeris } from 'src/api/atlas.ephemeris'
import type { HorizonsObserver } from 'src/api/atlas.ephemeris'
import type { PositionOfBody } from '#/atlas'

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
