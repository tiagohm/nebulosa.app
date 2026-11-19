import { describe, expect, test } from 'bun:test'
import { eraGmst06 } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { greenwichMeanSiderealTime, localSiderealTime, meanObliquity, unixTimeOf, ut1MinusUtc } from './time'

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

test('UT1 falls behind UTC after the IERS predictions as Delta T grows', () => {
	const now = Date.UTC(2026, 10, 19)
	expect(ut1MinusUtc(now, now)).toBe(0)
	expect(ut1MinusUtc(Date.UTC(2027, 10, 1), now)).toBe(0)
	// Espenak and Meeus 2006 grow Delta T by about 125 s from 2027 to 2100.
	expect(ut1MinusUtc(Date.UTC(2100, 0, 1), now)).toBeWithin(-140, -110)
	expect(ut1MinusUtc(Date.UTC(2050, 0, 1), now)).toBeWithin(-20, -10)
	// The sidereal time of 2100 is ERFA's for that UT1 (TT = UTC + 69.184 s).
	const year2100 = Date.UTC(2100, 0, 1)
	const julianDay = year2100 / 86_400_000 + 2440587.5
	const dut1 = ut1MinusUtc(year2100)
	expect(greenwichMeanSiderealTime(year2100)).toBeCloseTo(eraGmst06(julianDay, dut1 / 86400, julianDay, 69.184 / 86400), 8)
})
