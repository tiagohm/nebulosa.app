import { describe, expect, test } from 'bun:test'
import { greenwichMeanSiderealTime, localSiderealTime, meanObliquity, unixTimeOf } from './time'

// Reference values computed with the nebulosa toolkit (IAU 2006 with exact time scales). The local
// approximation (UT1 = UTC, fixed TT offset) must stay within 1e-4 rad (about 20 arcseconds).
const J2000_NOON = Date.UTC(2000, 0, 1, 12)
const OCTOBER_2026 = Date.UTC(2026, 9, 18, 3, 30)

describe('sidereal time', () => {
	test('greenwich mean sidereal time', () => {
		expect(greenwichMeanSiderealTime(J2000_NOON)).toBeCloseTo(4.89496128360561, 4)
		expect(greenwichMeanSiderealTime(OCTOBER_2026)).toBeCloseTo(1.3812940626784795, 4)
	})

	test('local sidereal time adds the east longitude and wraps to [0, 2π)', () => {
		expect(localSiderealTime(J2000_NOON, (-45 * Math.PI) / 180)).toBeCloseTo(4.109563120208161, 4)
		expect(localSiderealTime(OCTOBER_2026, (-45 * Math.PI) / 180)).toBeCloseTo(0.5958958992810313, 4)
	})
})

test('mean obliquity', () => {
	expect(meanObliquity(J2000_NOON)).toBeCloseTo(0.40909260059596453, 8)
	expect(meanObliquity(OCTOBER_2026)).toBeCloseTo(0.40903175844405587, 8)
})

test('observation instant from a date or unix milliseconds', () => {
	expect(unixTimeOf(new Date(OCTOBER_2026))).toBe(OCTOBER_2026)
	expect(unixTimeOf(OCTOBER_2026)).toBe(OCTOBER_2026)
})
