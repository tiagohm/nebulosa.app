import { expect, test } from 'bun:test'
import { pauseSkyTime, playSkyTime, setSkyTime, setSkyTimeNow, type SkyClock, skyTime, stepSkyTime } from './clock'

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
