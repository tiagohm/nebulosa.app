import { expect, test } from 'bun:test'
import { createSunAlmanacRoutes, nextSeasons, SunAlmanac, sunPhysicalData, zonedDay } from './sun'

const MINUTE = 60_000

const london = { latitude: 51.5074, longitude: -0.1278, elevation: 0 }
const tromso = { latitude: 69.6492, longitude: 18.9553, elevation: 0 }
const quito = { latitude: -0.1807, longitude: -78.4678, elevation: 0 }
const saoPaulo = { latitude: -23.5505, longitude: -46.6333, elevation: 0 }

const almanac = new SunAlmanac()

function expectNear(actual: number | undefined, expected: number, tolerance = 2 * MINUTE) {
	expect(actual).toBeDefined()
	expect(Math.abs(actual! - expected)).toBeLessThanOrEqual(tolerance)
}

test('civil days follow the time zone, with 23 and 25 hour days', () => {
	expect(zonedDay(Date.UTC(2026, 9, 28, 2), 'America/Sao_Paulo')).toEqual({ localDate: '2026-10-27', start: Date.UTC(2026, 9, 27, 3), end: Date.UTC(2026, 9, 28, 3) })

	const spring = zonedDay(Date.UTC(2026, 2, 8, 17), 'America/New_York')
	expect(spring).toEqual({ localDate: '2026-03-08', start: Date.UTC(2026, 2, 8, 5), end: Date.UTC(2026, 2, 9, 4) })

	const autumn = zonedDay(Date.UTC(2026, 10, 1, 17), 'America/New_York')
	expect(autumn.end - autumn.start).toBe(25 * 60 * MINUTE)
})

test('a skipped midnight starts the day when the clocks jump', () => {
	// Chile moves its clocks forward at local midnight.
	const day = zonedDay(Date.UTC(2026, 8, 6, 12), 'America/Santiago')
	expect(day.localDate).toBe('2026-09-06')
	expect(day.end - day.start).toBe(23 * 60 * MINUTE)
	expect(zonedDay(day.start, 'America/Santiago').localDate).toBe('2026-09-06')
	expect(zonedDay(day.start - 1, 'America/Santiago').localDate).toBe('2026-09-05')
})

test('sunrise, sunset, and daylight of a temperate summer day', () => {
	const day = almanac.localDay(Date.UTC(2026, 5, 21, 12), london, 'Europe/London')
	expect(day.localDate).toBe('2026-06-21')
	expect(day.daylight).toBe('normal')
	expectNear(day.sunrise, Date.UTC(2026, 5, 21, 3, 43))
	expectNear(day.sunset, Date.UTC(2026, 5, 21, 20, 21))
	expect(day.daylightSeconds).toBeCloseTo((day.sunset! - day.sunrise!) / 1000, -1)
	expect(day.transit).toBeGreaterThan(day.sunrise!)
	expect(day.transit).toBeLessThan(day.sunset!)
	expect(day.civil.state).toBe('normal')
	expect(day.astronomical.state).toBe('continuousAbove')
	expect(day.astronomicalNight).toEqual({ state: 'continuousAbove' })
})

test('twilight limits are ordered in the southern hemisphere', () => {
	const day = almanac.localDay(Date.UTC(2026, 9, 28, 15), saoPaulo, 'America/Sao_Paulo')
	expect(day.astronomical.dawn!).toBeLessThan(day.nautical.dawn!)
	expect(day.nautical.dawn!).toBeLessThan(day.civil.dawn!)
	expect(day.civil.dawn!).toBeLessThan(day.sunrise!)
	expect(day.sunset!).toBeLessThan(day.civil.dusk!)
	expect(day.civil.dusk!).toBeLessThan(day.nautical.dusk!)
	expect(day.nautical.dusk!).toBeLessThan(day.astronomical.dusk!)

	const night = day.astronomicalNight
	expect(night.state).toBe('normal')
	expect(night.start).toBe(day.astronomical.dusk)
	expect(night.end!).toBeGreaterThan(day.end)
	expect(night.durationSeconds).toBe((night.end! - night.start!) / 1000)
})

test('equatorial days are about twelve hours long', () => {
	const day = almanac.localDay(Date.UTC(2026, 2, 20, 17), quito, 'America/Guayaquil')
	expect(day.daylightSeconds! / 3600).toBeGreaterThan(12)
	expect(day.daylightSeconds! / 3600).toBeLessThan(12.2)
})

test('polar day and polar night have no sunrise nor sunset', () => {
	const summer = almanac.localDay(Date.UTC(2026, 5, 21, 12), tromso, 'Europe/Oslo')
	expect(summer.sunrise).toBeUndefined()
	expect(summer.sunset).toBeUndefined()
	expect(summer.daylight).toBe('continuousAbove')
	expect(summer.daylightSeconds).toBe(24 * 3600)
	expect(summer.civil).toEqual({ state: 'continuousAbove' })

	const winter = almanac.localDay(Date.UTC(2026, 11, 21, 12), tromso, 'Europe/Oslo')
	expect(winter.sunrise).toBeUndefined()
	expect(winter.sunset).toBeUndefined()
	expect(winter.daylight).toBe('continuousBelow')
	expect(winter.daylightSeconds).toBeUndefined()
	expect(winter.transit).toBeDefined()
	expect(winter.civil.state).toBe('normal')
})

test('a day with one crossing is partial', () => {
	// The midnight Sun begins at Tromsø on May 18–19: the Sun sets after midnight and never again.
	const days = [16, 17, 18, 19, 20].map((day) => almanac.localDay(Date.UTC(2026, 4, day, 12), tromso, 'Europe/Oslo'))
	const partial = days.filter((e) => e.daylight === 'partial')
	expect(partial.length).toBeGreaterThan(0)
	for (const day of partial) expect((day.sunrise === undefined) !== (day.sunset === undefined)).toBeTrue()
	for (const day of days) expect(day.daylightSeconds!).toBeLessThanOrEqual((day.end - day.start) / 1000)
})

test('the next four seasons follow the instant across the year', () => {
	const seasons = nextSeasons(Date.UTC(2026, 10, 4))
	expect(seasons.map((e) => e.kind)).toEqual(['decemberSolstice', 'marchEquinox', 'juneSolstice', 'septemberEquinox'])
	expectNear(seasons[0].time, Date.UTC(2026, 11, 21, 20, 50))
	expectNear(seasons[1].time, Date.UTC(2027, 2, 20, 20, 25))

	const after = nextSeasons(seasons[0].time)
	expect(after[0].kind).toBe('marchEquinox')
	expect(after).toHaveLength(4)
})

test('equation of time and Carrington rotation', () => {
	const data = sunPhysicalData(Date.UTC(2026, 10, 4))
	expect(data.equationOfTimeSeconds / 60).toBeCloseTo(16.4, 1)
	expect(data.carringtonRotation).toBe(2317)
	expect(data.source).toBe('local')

	expect(sunPhysicalData(Date.UTC(2026, 1, 11)).equationOfTimeSeconds / 60).toBeCloseTo(-14.2, 0)
})

test('the almanac route answers without an observer', async () => {
	const routes = createSunAlmanacRoutes(almanac)
	const time = Date.UTC(2026, 9, 28, 15)
	const request = new Request('http://localhost/api/sky/sun/almanac', { method: 'POST', body: JSON.stringify({ time, timeZone: 'UTC' }) })
	const response = await routes['/api/sky/sun/almanac'].POST(request as never)
	const body = await response.json()
	expect(body.time).toBe(time)
	expect(body.localDay).toBeUndefined()
	expect(body.seasons).toHaveLength(4)
	expect(body.physical.source).toBe('local')
})
