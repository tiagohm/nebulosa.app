import { describe, expect, test } from 'bun:test'
import { nearestLunarEclipse } from 'nebulosa/src/astronomy/bodies/moon'
import { bodyFixedMatrix, MOON_ROTATION } from 'nebulosa/src/astronomy/bodies/orientation'
import { frameToFrame, ICRS, ITRS } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import { timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD } from 'nebulosa/src/core/constants'
import { type Mat3, matMulVec, matTransposeMulVec } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import { makeTime } from './ephemeris'
import { createMoonAlmanacRoutes, MoonAlmanac, moonAppearance, moonCalendar, moonPhaseName } from './moon'

const SAO_PAULO = { latitude: -23.5505, longitude: -46.6333, elevation: 760 }
const LONDON = { latitude: 51.5074, longitude: -0.1278, elevation: 11 }
const TIME = Date.UTC(2026, 9, 28, 22)
const HOUR = 3_600_000
const DAY = 24 * HOUR

function longitudeLatitude([x, y, z]: Vec3) {
	return { longitude: Math.atan2(y, x), latitude: Math.asin(z / Math.hypot(x, y, z)) }
}

function surface(latitudeDeg: number, longitudeDeg: number): Vec3 {
	const lat = latitudeDeg * DEG2RAD
	const lon = longitudeDeg * DEG2RAD
	return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

function expectAngle(actual: number, expected: number, tolerance: number) {
	expect(Math.abs(normalizePI(actual - expected))).toBeLessThan(tolerance)
}

function expectRotation(m: Mat3) {
	for (const [i, row] of [
		[0, 1, 2],
		[3, 4, 5],
		[6, 7, 8],
	].entries()) {
		for (const [j, other] of [
			[0, 1, 2],
			[3, 4, 5],
			[6, 7, 8],
		].entries()) {
			expect(row.reduce((sum, k, n) => sum + m[k] * m[other[n]], 0)).toBeCloseTo(i === j ? 1 : 0, 12)
		}
	}
}

describe('appearance', () => {
	test('the view rotation is the frame of the sub-observer point, the pole, and the sub-solar point', () => {
		for (const observer of [undefined, SAO_PAULO, LONDON]) {
			for (const time of [TIME, TIME + 7 * DAY, TIME + 200 * DAY]) {
				const appearance = moonAppearance(time, observer)
				const m = appearance.bodyToCamera
				expectRotation(m)

				// The view axis toward the observer is the center of the disk.
				const center = longitudeLatitude(matTransposeMulVec(m, [0, 0, 1]))
				expectAngle(center.longitude, appearance.subObserver.longitude, 1e-9)
				expect(center.latitude).toBeCloseTo(appearance.subObserver.latitude, 9)

				// The body's north pole is drawn at its position angle, measured from north through east (−X).
				const [px, py] = matMulVec(m, [0, 0, 1])
				expectAngle(Math.atan2(-px, py), appearance.poleAngle, 1e-6)

				const sun = longitudeLatitude(appearance.sunDirection)
				expectAngle(sun.longitude, appearance.subSolar.longitude, 1e-9)
				expect(sun.latitude).toBeCloseTo(appearance.subSolar.latitude, 9)
			}
		}
	})

	test('lunar east is drawn on the west of the sky: Mare Crisium right, Copernicus and Aristarchus left, Tycho below', () => {
		const m = moonAppearance(TIME).bodyToCamera
		const crisium = matMulVec(m, surface(16.1774, 59.1037))
		const copernicus = matMulVec(m, surface(9.6209, -20.0786))
		const aristarchus = matMulVec(m, surface(23.7299, -47.4901))
		const tycho = matMulVec(m, surface(-43.2958, -11.2153))
		const farSide = matMulVec(m, surface(0, 180))

		expect(crisium[0]).toBeGreaterThan(0.5)
		expect(copernicus[0]).toBeLessThan(0)
		expect(aristarchus[0]).toBeLessThan(copernicus[0])
		expect(tycho[1]).toBeLessThan(-0.5)
		for (const point of [crisium, copernicus, aristarchus, tycho]) expect(point[2]).toBeGreaterThan(0)
		expect(farSide[2]).toBeLessThan(0)
	})

	test('an observer sees a slightly different libration than the geocenter, and gets the parallactic angle of its zenith', () => {
		for (const observer of [SAO_PAULO, LONDON]) {
			for (const time of [TIME, TIME + 6 * HOUR, TIME + 12 * HOUR]) {
				const geocentric = moonAppearance(time)
				const topocentric = moonAppearance(time, observer)
				const shift = Math.hypot(normalizePI(topocentric.subObserver.longitude - geocentric.subObserver.longitude), topocentric.subObserver.latitude - geocentric.subObserver.latitude)

				expect(geocentric.center).toBe('geocentric')
				expect(geocentric.parallacticAngle).toBeUndefined()
				expect(topocentric.center).toBe('topocentric')
				expect(shift).toBeGreaterThan(0.1 * DEG2RAD)
				expect(shift).toBeLessThan(1.1 * DEG2RAD)
				expect(topocentric.distanceKm).not.toBeCloseTo(geocentric.distanceKm, 0)

				// The site's geocentric vertical drawn in the north-up view points along the parallactic angle
				// (within the 0.2° between geocentric and geodetic verticals; the Moon's rotation over the light
				// time is negligible).
				const instant = makeTime(time, observer)
				const up = frameToFrame(itrs(instant.location!), ITRS, ICRS, instant)
				const [zx, zy] = matMulVec(topocentric.bodyToCamera, matMulVec(bodyFixedMatrix(MOON_ROTATION, instant), up))
				expectAngle(Math.atan2(-zx, zy), topocentric.parallacticAngle!, 0.5 * DEG2RAD)
			}
		}
	})

	test('names the phase and measures the light around the phases', () => {
		const calendar = moonCalendar(TIME)
		const at = (kind: string) => calendar.phases.find((e) => e.kind === kind)!.time
		const full = moonAppearance(at('fullMoon'))
		const fresh = moonAppearance(at('newMoon') + 3 * DAY)
		const quarter = moonAppearance(at('firstQuarter'))

		expect(full.phase).toBe('fullMoon')
		expect(full.illuminatedFraction).toBeGreaterThan(0.99)
		expectAngle(full.colongitude, Math.PI / 2, 10 * DEG2RAD)
		expect(moonAppearance(at('newMoon')).illuminatedFraction).toBeLessThan(0.01)
		expect(moonAppearance(at('newMoon') + HOUR).ageDays).toBeCloseTo(1 / 24, 6)
		expect(fresh.phase).toBe('waxingCrescent')
		expect(fresh.ageDays).toBeCloseTo(3, 6)
		expect(quarter.phase).toBe('firstQuarter')
		expect(quarter.illuminatedFraction).toBeCloseTo(0.5, 1)
		expect(moonAppearance(at('lastQuarter')).phase).toBe('lastQuarter')
		expect(moonAppearance(at('fullMoon') - 4 * DAY).phase).toBe('waxingGibbous')
		expect(moonAppearance(at('fullMoon') + 4 * DAY).phase).toBe('waningGibbous')

		// A waxing Moon is lit on its west limb (position angle near 270°), a waning one on its east limb.
		expectAngle(fresh.brightLimbAngle, 1.5 * Math.PI, 30 * DEG2RAD)
		expectAngle(moonAppearance(at('fullMoon') + 8 * DAY).brightLimbAngle, Math.PI / 2, 30 * DEG2RAD)
	})

	test('phase names follow the elongation', () => {
		expect(moonPhaseName(0)).toBe('newMoon')
		expect(moonPhaseName(6 * DEG2RAD)).toBe('newMoon')
		expect(moonPhaseName(7 * DEG2RAD)).toBe('waxingCrescent')
		expect(moonPhaseName(354 * DEG2RAD)).toBe('newMoon')
		expect(moonPhaseName(90 * DEG2RAD)).toBe('firstQuarter')
		expect(moonPhaseName(120 * DEG2RAD)).toBe('waxingGibbous')
		expect(moonPhaseName(180 * DEG2RAD)).toBe('fullMoon')
		expect(moonPhaseName(200 * DEG2RAD)).toBe('waningGibbous')
		expect(moonPhaseName(270 * DEG2RAD)).toBe('lastQuarter')
		expect(moonPhaseName(300 * DEG2RAD)).toBe('waningCrescent')
	})
})

describe('calendar', () => {
	test('the next four principal phases and the next perigee and apogee, strictly after the instant and in order', () => {
		for (const time of [TIME, Date.UTC(2027, 0, 1), Date.UTC(2030, 5, 15, 12)]) {
			const { phases, apsides, from, until } = moonCalendar(time)
			expect(phases).toHaveLength(4)
			expect(new Set(phases.map((e) => e.kind)).size).toBe(4)
			expect(phases[0].time).toBeGreaterThan(time)
			expect(phases[3].time - phases[0].time).toBeLessThan(23 * DAY)
			for (let i = 1; i < 4; i++) expect(phases[i].time).toBeGreaterThan(phases[i - 1].time)
			expect(apsides.map((e) => e.kind).sort()).toEqual(['apogee', 'perigee'])
			expect(apsides[0].time).toBeGreaterThan(time)
			expect(apsides[1].time).toBeGreaterThan(apsides[0].time)
			expect(apsides.find((e) => e.kind === 'perigee')!.distanceKm).toBeWithin(356_000, 371_000)
			expect(apsides.find((e) => e.kind === 'apogee')!.distanceKm).toBeWithin(404_000, 407_000)
			expect(from).toBeLessThanOrEqual(time)
			expect(time - from).toBeLessThan(30 * DAY)
			expect(until).toBe(Math.min(phases[0].time, apsides[0].time))
		}
	})

	test('a total lunar eclipse falls within an hour of the full Moon', () => {
		const eclipse = nearestLunarEclipse(timeUnix(Date.UTC(2026, 0, 1) / 1000), true)
		const maximum = timeToUnixMillis(eclipse.maximalTime)
		const full = moonCalendar(maximum - 5 * DAY).phases.find((e) => e.kind === 'fullMoon')!
		expect(Math.abs(full.time - maximum)).toBeLessThan(HOUR)
	})

	test('a calendar is reused while it holds and computed again past an event or back in time', () => {
		const almanac = new MoonAlmanac()
		const first = almanac.calendar(TIME)
		expect(almanac.calendar(TIME + HOUR)).toBe(first)
		expect(almanac.calendar(first.until - 1)).toBe(first)

		const next = almanac.calendar(first.until)
		expect(next).not.toBe(first)
		expect(next.phases[0].time).toBeGreaterThan(first.until)

		const before = almanac.calendar(first.from - 1)
		expect(before).not.toBe(first)
		expect(before.until).toBeLessThanOrEqual(first.from)
		expect(almanac.calendar(TIME)).toBe(first)
	})
})

test('the route answers the almanac of the request', async () => {
	const routes = createMoonAlmanacRoutes(new MoonAlmanac())
	const response = await routes['/api/sky/moon/almanac'].POST(new Request('http://localhost/api/sky/moon/almanac', { method: 'POST', body: JSON.stringify({ time: TIME, observer: SAO_PAULO }) }) as never)
	const body = await response.json()

	expect(response.status).toBe(200)
	expect(body.time).toBe(TIME)
	expect(body.source).toBe('local')
	expect(body.appearance.center).toBe('topocentric')
	expect(body.appearance.bodyToCamera).toHaveLength(9)
	expect(body.phases).toHaveLength(4)
	expect(body.apsides).toHaveLength(2)
})
