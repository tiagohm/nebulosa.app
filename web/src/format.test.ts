import { describe, expect, test } from 'bun:test'
import { arcmin, arcsec, deg, hour } from 'nebulosa/src/math/units/angle'
import {
	formatAngularSize,
	formatArcmin,
	formatArcsec,
	formatByteSize,
	formatClockDuration,
	formatDegrees,
	formatDuration,
	formatExposureTime,
	formatFixed,
	formatGeographic,
	formatHourAngle,
	formatPercent,
	formatKilometers,
	formatPixelLength,
	formatPixelPosition,
	formatSigned,
	formatSignedAngle,
	formatSignedArcmin,
	formatSignificant,
	formatTemperature,
	formatUtcDateTime,
	MISSING,
} from './format'

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

	test('angular sizes use the unit that suits them, chosen after rounding', () => {
		expect(formatAngularSize(arcsec(12.345))).toBe('12.35″')
		expect(formatAngularSize(arcsec(754))).toBe('12.57′')
		expect(formatAngularSize(deg(1.2346))).toBe('1.235°')
		expect(formatAngularSize(arcsec(59.999))).toBe('1.00′')
		expect(formatAngularSize(arcmin(59.9999))).toBe('1.000°')
		expect(formatAngularSize(Number.NaN)).toBe(MISSING)
	})

	test('signed angular offsets carry their sign, except a rounded zero', () => {
		expect(formatSignedAngle(-arcsec(3))).toBe('−3.00″')
		expect(formatSignedAngle(arcmin(2))).toBe('+2.00′')
		expect(formatSignedAngle(0)).toBe('0.00″')
		expect(formatSignedAngle(-arcsec(0.001))).toBe('0.00″')
		expect(formatSignedAngle(Number.NaN)).toBe(MISSING)
	})

	test('hour angles keep their sign, positive west, and never wrap to 24 h', () => {
		expect(formatHourAngle(hour(-1))).toBe('−01:00:00')
		expect(formatHourAngle(hour(1.5))).toBe('+01:30:00')
		expect(formatHourAngle(hour(-11.999))).toBe('−11:59:56')
		expect(formatHourAngle(-hour(0.00001))).toBe('+00:00:00')
		expect(formatHourAngle(hour(-0.5), 3)).toBe('−00:30:00.000')
		expect(formatHourAngle(Number.NaN)).toBe(MISSING)
	})
})

describe('measurements', () => {
	test('temperatures in °C with one decimal', () => {
		expect(formatTemperature(-10.24)).toBe('-10.2 °C')
		expect(formatTemperature(-0.02)).toBe('0.0 °C')
		expect(formatTemperature(Number.NaN)).toBe(MISSING)
	})

	test('byte sizes in binary units', () => {
		expect(formatByteSize(512)).toBe('512 B')
		expect(formatByteSize(3.4 * 1024 ** 2)).toBe('3.4 MiB')
		expect(formatByteSize(120 * 1024 ** 3)).toBe('120 GiB')
		expect(formatByteSize(Number.NaN)).toBe(MISSING)
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

	test('exposure times as set, without float noise', () => {
		expect(formatExposureTime(0.0001)).toBe('0.0001 s')
		expect(formatExposureTime(300)).toBe('300 s')
		expect(formatExposureTime(0.1 + 0.2)).toBe('0.3 s')
		expect(formatExposureTime(1_234_567 / 1_000_000)).toBe('1.23457 s')
		expect(formatExposureTime(Number.NaN)).toBe(MISSING)
	})

	test('running clocks', () => {
		expect(formatClockDuration(65)).toBe('1:05')
		expect(formatClockDuration(65.9)).toBe('1:05')
		expect(formatClockDuration(3725)).toBe('1:02:05')
		expect(formatClockDuration(-10)).toBe('0:00')
	})
})

describe('positions, distances, and instants', () => {
	test('a position in an image keeps its decimals and never shows a non-finite coordinate', () => {
		expect(formatPixelPosition(1203.44, 88)).toBe('1203.4, 88.0 px')
		expect(formatPixelPosition(12.345, -0.001, 2)).toBe('12.35, 0.00 px')
		expect(formatPixelPosition(Number.NaN, 4)).toBe(MISSING)
	})

	test('kilometers take thousands separators and never a negative zero', () => {
		expect(formatKilometers(384_399.6)).toBe('384,400 km')
		expect(formatKilometers(12.46, 1)).toBe('12.5 km')
		expect(formatKilometers(-0.2)).toBe('0 km')
		expect(formatKilometers(Number.POSITIVE_INFINITY)).toBe(MISSING)
	})

	test('an instant in UTC is written to the second or the minute with its zone', () => {
		const time = Date.UTC(2026, 10, 5, 14, 23, 5, 900)
		expect(formatUtcDateTime(time)).toBe('2026-11-05 14:23:05 UTC')
		expect(formatUtcDateTime(time, false)).toBe('2026-11-05 14:23 UTC')
		expect(formatUtcDateTime(Number.NaN)).toBe(MISSING)
	})
})
