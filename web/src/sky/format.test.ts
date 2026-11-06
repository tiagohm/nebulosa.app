import { expect, test } from 'bun:test'
import { arcmin, deg, hour } from 'nebulosa/src/math/units/angle'
import { MISSING } from '../format'
import { formatApparentSize, formatDeclination, formatMagnitude, formatRightAscension, formatSolarSystemDistance, formatStellarDistance } from './format'

// AU per light-year, as the module converts them.
const LY = 63_241.077

test('angles', () => {
	expect(formatRightAscension(1.7677953696021995)).toBe('06 45 08.93')
	expect(formatRightAscension(hour(-1))).toBe('23 00 00.00')
	expect(formatDeclination(-0.291751258517685)).toBe('-16 42 58.02')
	expect(formatDeclination(deg(41.27))).toBe('+41 16 12.00')
	expect(formatRightAscension(Number.NaN)).toBe(MISSING)
	expect(formatDeclination(Number.NaN)).toBe(MISSING)
})

test('apparent sizes are arcminutes, or whole arcseconds below one, chosen after rounding', () => {
	expect(formatApparentSize(deg(189.1 / 60))).toBe('189.10′')
	expect(formatApparentSize(deg(45 / 3600))).toBe('45″')
	expect(formatApparentSize(arcmin(0.9999))).toBe('1.00′')
	expect(formatApparentSize(Number.NaN)).toBe(MISSING)
})

test('distances choose their decimals after rounding', () => {
	expect(formatSolarSystemDistance(0.002714)).toBe('406,009 km')
	expect(formatSolarSystemDistance(1.538688)).toBe('1.5387 AU')
	expect(formatSolarSystemDistance(9.99999)).toBe('10.00 AU')
	expect(formatSolarSystemDistance(30.1)).toBe('30.10 AU')
	expect(formatSolarSystemDistance(Number.NaN)).toBe(MISSING)
	expect(formatStellarDistance(543940.92)).toBe('8.6 ly')
	expect(formatStellarDistance(99.96 * LY)).toBe('100 ly')
	expect(formatStellarDistance(84981100)).toBe('1,344 ly')
	expect(formatStellarDistance(999_999.9 * LY)).toBe('1.0 Mly')
	expect(formatStellarDistance(160474019260)).toBe('2.5 Mly')
	expect(formatStellarDistance(99.96e6 * LY)).toBe('100 Mly')
	expect(formatStellarDistance(Number.NaN)).toBe(MISSING)
})

test('magnitudes', () => {
	expect(formatMagnitude(-1.4)).toBe('-1.40')
	expect(formatMagnitude(-0.001)).toBe('0.00')
	expect(formatMagnitude(Number.NaN)).toBe(MISSING)
})
