import { expect, test } from 'bun:test'
import { pauseSkyTime, playSkyTime, setSkyTime, setSkyTimeNow, type SkyClock, skyTime, stepSkyTime, zonedWallTime, zonedWallTimeToUtc } from './clock'

const clock = (): SkyClock => ({ mode: 'now', anchor: 0, startedAt: 0, rate: 1 })

test('now follows the real time', () => {
	const c = clock()
	expect(skyTime(c, 5_000)).toBe(5_000)
	expect(skyTime(c, 9_000)).toBe(9_000)
})

test('a fixed instant does not move', () => {
	const c = clock()
	setSkyTime(c, 1_000_000, 5_000)
	expect(c.mode).toBe('fixed')
	expect(skyTime(c, 99_000)).toBe(1_000_000)
	setSkyTimeNow(c)
	expect(skyTime(c, 99_000)).toBe(99_000)
})

test('playing advances at the rate and pausing keeps the instant reached', () => {
	const c = clock()
	setSkyTime(c, 1_000_000, 0)
	playSkyTime(c, 60, 10_000)
	expect(skyTime(c, 10_000)).toBe(1_000_000)
	expect(skyTime(c, 12_000)).toBe(1_120_000)
	pauseSkyTime(c, 12_000)
	expect(c.mode).toBe('fixed')
	expect(skyTime(c, 50_000)).toBe(1_120_000)
	expect(c.rate).toBe(60)
})

test('a negative rate runs backwards', () => {
	const c = clock()
	playSkyTime(c, -3600, 1_000)
	expect(skyTime(c, 2_000)).toBe(1_000 - 3_600_000)
})

test('steps move the instant and keep playing', () => {
	const c = clock()
	stepSkyTime(c, 3_600_000, 1_000)
	expect(c.mode).toBe('fixed')
	expect(skyTime(c, 7_000)).toBe(3_601_000)

	playSkyTime(c, 10, 7_000)
	stepSkyTime(c, -60_000, 8_000)
	expect(c.mode).toBe('playing')
	expect(skyTime(c, 8_000)).toBe(3_601_000 + 10_000 - 60_000)
})

test('wall times of a time zone', () => {
	const time = Date.UTC(2026, 9, 18, 14, 23, 45)
	expect(zonedWallTime(time, 'America/Sao_Paulo')).toEqual({ year: 2026, month: 10, day: 18, hour: 11, minute: 23, second: 45 })
	expect(zonedWallTime(time, 'UTC')).toEqual({ year: 2026, month: 10, day: 18, hour: 14, minute: 23, second: 45 })
	expect(zonedWallTimeToUtc({ year: 2026, month: 10, day: 18, hour: 11, minute: 23, second: 45 }, 'America/Sao_Paulo')).toBe(time)
	expect(zonedWallTimeToUtc({ year: 2026, month: 10, day: 18, hour: 14, minute: 23, second: 45 }, 'UTC')).toBe(time)
})

test('wall times across daylight saving changes', () => {
	// Summer and winter offsets of Berlin.
	expect(zonedWallTimeToUtc({ year: 2025, month: 7, day: 1, hour: 12, minute: 0, second: 0 }, 'Europe/Berlin')).toBe(Date.UTC(2025, 6, 1, 10))
	expect(zonedWallTimeToUtc({ year: 2025, month: 1, day: 1, hour: 12, minute: 0, second: 0 }, 'Europe/Berlin')).toBe(Date.UTC(2025, 0, 1, 11))
	// 02:30 does not exist on 2025-03-30 in Berlin; it reads as 03:30 CEST.
	expect(zonedWallTimeToUtc({ year: 2025, month: 3, day: 30, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin')).toBe(Date.UTC(2025, 2, 30, 1, 30))
	// 02:30 happens twice on 2025-10-26 in Berlin; the first one is in CEST.
	expect(zonedWallTimeToUtc({ year: 2025, month: 10, day: 26, hour: 2, minute: 30, second: 0 }, 'Europe/Berlin')).toBe(Date.UTC(2025, 9, 26, 0, 30))
	// São Paulo had daylight saving time until 2019: midnight of 2018-11-04 was skipped.
	expect(zonedWallTimeToUtc({ year: 2018, month: 11, day: 4, hour: 0, minute: 30, second: 0 }, 'America/Sao_Paulo')).toBe(Date.UTC(2018, 10, 4, 3, 30))
})
