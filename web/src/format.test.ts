import { describe, expect, test } from 'bun:test'
import { arcmin, arcsec, deg } from 'nebulosa/src/math/units/angle'
import { formatArcmin, formatArcsec, formatClockDuration, formatDegrees, formatDuration, formatFixed, formatGeographic, formatPercent, formatPixelLength, formatSigned, formatSignedArcmin, formatSignificant, formatTemperature, MISSING } from './format'

describe('numbers', () => {
	test('fixed decimals never show a negative zero nor a non-finite number', () => {
		expect(formatFixed(1.005, 1)).toBe('1.0')
		expect(formatFixed(-0.04, 1)).toBe('0.0')
		expect(formatFixed(-0.06, 1)).toBe('-0.1')
		expect(formatFixed(Number.NaN, 2)).toBe(MISSING)
		expect(formatFixed(Number.POSITIVE_INFINITY, 2)).toBe(MISSING)
	})

	test('signed differences carry their sign, except a rounded zero', () => {
		expect(formatSigned(1.24, 1)).toBe('+1.2')
		expect(formatSigned(-1.24, 1)).toBe('−1.2')
		expect(formatSigned(-0.04, 1)).toBe('0.0')
		expect(formatSigned(0, 1)).toBe('0.0')
		expect(formatSigned(Number.NaN, 1)).toBe(MISSING)
	})

	test('percentages of a fraction', () => {
		expect(formatPercent(0.57)).toBe('57%')
		expect(formatPercent(0.9994, 1)).toBe('99.9%')
		expect(formatPercent(-0.0001)).toBe('0%')
		expect(formatPercent(Number.NaN)).toBe(MISSING)
	})

	test('wide-range measurements keep four significant digits', () => {
		expect(formatSignificant(1234.56)).toBe('1235')
		expect(formatSignificant(0.123456)).toBe('0.1235')
		expect(formatSignificant(123456)).toBe('1.235e+5')
		expect(formatSignificant(0.001234)).toBe('1.234e-3')
		expect(formatSignificant(0)).toBe('0.000')
		expect(formatSignificant(Number.NaN)).toBe(MISSING)
	})
})

describe('angles', () => {
	test('degrees, arcminutes, and arcseconds', () => {
		expect(formatDegrees(deg(265.357))).toBe('265.36°')
		expect(formatDegrees(deg(12.34), 1)).toBe('12.3°')
		expect(formatDegrees(deg(-0.001))).toBe('0.00°')
		expect(formatDegrees(Number.NaN)).toBe(MISSING)
		expect(formatArcmin(arcmin(12.34))).toBe('12.3′')
		expect(formatArcsec(arcsec(4.56))).toBe('4.6″')
		expect(formatArcsec(arcsec(4.567), 2)).toBe('4.57″')
		expect(formatArcsec(undefined)).toBe(MISSING)
		expect(formatArcsec(null)).toBe(MISSING)
	})

	test('geographic positions with their hemispheres', () => {
		expect(formatGeographic(-23.5505, -46.6333)).toBe('23.5505° S, 46.6333° W')
		expect(formatGeographic(48.86, 2.35)).toBe('48.8600° N, 2.3500° E')
		expect(formatGeographic(-0.00001, -0.00001)).toBe('0.0000° N, 0.0000° E')
		expect(formatGeographic(9.623, -20.081, 2)).toBe('9.62° N, 20.08° W')
		expect(formatGeographic(Number.NaN, 0)).toBe(MISSING)
	})

	test('signed arcminutes', () => {
		expect(formatSignedArcmin(arcmin(2.04))).toBe('+2.0′')
		expect(formatSignedArcmin(arcmin(-2.04))).toBe('−2.0′')
		expect(formatSignedArcmin(arcmin(-0.04))).toBe('0.0′')
	})
})

describe('measurements', () => {
	test('temperatures in °C with one decimal', () => {
		expect(formatTemperature(-10.24)).toBe('-10.2 °C')
		expect(formatTemperature(-0.02)).toBe('0.0 °C')
		expect(formatTemperature(Number.NaN)).toBe(MISSING)
	})

	test('pixel lengths with their sky size when the scale is known', () => {
		expect(formatPixelLength(2.314)).toBe('2.31 px')
		expect(formatPixelLength(2.314, 1.5)).toBe('2.31 px (3.47″)')
		expect(formatPixelLength(undefined, 1.5)).toBe(MISSING)
	})
})

describe('time', () => {
	test('durations', () => {
		expect(formatDuration(2.5)).toBe('2.50 s')
		expect(formatDuration(42)).toBe('42.0 s')
		expect(formatDuration(245)).toBe('4 min 05 s')
		expect(formatDuration(36000)).toBe('10 h 00 min')
		expect(formatDuration(3 * 3600 + 7 * 60 + 20)).toBe('3 h 07 min')
		expect(formatDuration(Number.POSITIVE_INFINITY)).toBe(MISSING)
	})

	test('running clocks', () => {
		expect(formatClockDuration(65)).toBe('1:05')
		expect(formatClockDuration(65.9)).toBe('1:05')
		expect(formatClockDuration(3725)).toBe('1:02:05')
		expect(formatClockDuration(-10)).toBe('0:00')
	})
})
