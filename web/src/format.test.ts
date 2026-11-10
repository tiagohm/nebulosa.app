import { describe, expect, test } from 'bun:test'
import { arcmin, arcsec, deg, hour } from 'nebulosa/src/math/units/angle'
import {
	dateTimeFormat,
	formatAngularSize,
	formatCount,
	formatSampleValue,
	formatArcmin,
	formatArcsec,
	formatByteSize,
	formatClockDuration,
	formatClockTime,
	formatHours,
	formatDate,
	formatDateTime,
	formatDegrees,
	formatDuration,
	formatElevation,
	formatExposureTime,
	formatFixed,
	formatGeographic,
	formatHourAngle,
	formatPercent,
	formatKilometers,
	formatLocalTime,
	formatLongDateTime,
	formatPixelLength,
	formatPixelPosition,
	formatSigned,
	formatSignedClockDuration,
	formatSignedAngle,
	formatSignedArcmin,
	formatSignificant,
	formatSpan,
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

	test('elevations in whole meters', () => {
		expect(formatElevation(759.6)).toBe('760 m')
		expect(formatElevation(-28.2)).toBe('-28 m')
		expect(formatElevation(-0.3)).toBe('0 m')
		expect(formatElevation(Number.NaN)).toBe(MISSING)
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

	test('signed running clocks keep the sign of the time and none at zero', () => {
		expect(formatSignedClockDuration(65.9)).toBe('+1:05')
		expect(formatSignedClockDuration(-565)).toBe('−9:25')
		expect(formatSignedClockDuration(-3725)).toBe('−1:02:05')
		expect(formatSignedClockDuration(-0.4)).toBe('0:00')
		expect(formatSignedClockDuration(0)).toBe('0:00')
		expect(formatSignedClockDuration(Number.NaN)).toBe(MISSING)
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

	test('an instant in a zone is written as an ISO date and a 24-hour time, across a daylight change', () => {
		const time = Date.UTC(2029, 3, 13, 21, 45, 3)
		expect(formatDateTime(time, 'UTC')).toBe('2029-04-13 21:45:03')
		expect(formatDateTime(time, 'America/Sao_Paulo')).toBe('2029-04-13 18:45:03')
		expect(formatDateTime(time, 'Asia/Kathmandu', false)).toBe('2029-04-14 03:30')
		expect(formatDateTime(Date.UTC(2026, 2, 8, 6, 30), 'America/New_York')).toBe('2026-03-08 01:30:00')
		expect(formatDateTime(Date.UTC(2026, 2, 8, 7, 30), 'America/New_York')).toBe('2026-03-08 03:30:00')
		expect(formatDate(time, 'Asia/Kathmandu')).toBe('2029-04-14')
		expect(formatDateTime(Number.NaN, 'UTC')).toBe(MISSING)
		expect(formatDate(Number.NaN, 'UTC')).toBe(MISSING)
	})

	test('a span reads its two times of day in the zone, and a length its hours and minutes', () => {
		expect(formatSpan(Date.UTC(2026, 9, 31, 23, 10), Date.UTC(2026, 10, 1, 6, 45), 'America/Sao_Paulo')).toBe('20:10–03:45')
		expect(formatSpan(Date.UTC(2026, 9, 31, 23, 10), Number.NaN, 'UTC')).toBe(`23:10–${MISSING}`)
		expect(formatHours(19_200_000)).toBe('5h 20m')
		expect(formatHours(2_700_000)).toBe('0h 45m')
		expect(formatHours(29_000)).toBe('0h 00m')
		expect(formatHours(Number.NaN)).toBe(MISSING)
	})

	test('a time of day follows the zone, and the zone name tells apart a repeated hour', () => {
		expect(formatClockTime(Date.UTC(2026, 9, 31, 23, 5, 7), 'America/Sao_Paulo')).toBe('20:05')
		expect(formatClockTime(Date.UTC(2026, 9, 31, 23, 5, 7), 'America/Sao_Paulo', { seconds: true })).toBe('20:05:07')
		expect(formatClockTime(Date.UTC(2026, 9, 31, 18, 20), 'Asia/Kathmandu')).toBe('00:05')
		expect(formatClockTime(Date.UTC(2026, 9, 31, 23, 5), 'America/Sao_Paulo', { named: true })).toBe('20:05 GMT-3')
		const zone = 'America/New_York'
		expect(formatClockTime(Date.UTC(2026, 10, 1, 5, 30), zone)).toBe(formatClockTime(Date.UTC(2026, 10, 1, 6, 30), zone))
		expect(formatClockTime(Date.UTC(2026, 10, 1, 5, 30), zone, { named: true })).not.toBe(formatClockTime(Date.UTC(2026, 10, 1, 6, 30), zone, { named: true }))
		expect(formatClockTime(Number.NaN, 'UTC')).toBe(MISSING)
	})

	test('a local time names its zone and shows its date on another day than the reference', () => {
		const time = Date.UTC(2026, 9, 18, 14, 23)
		expect(formatLocalTime(time, 'America/Sao_Paulo')).toBe('11:23 GMT-3')
		expect(formatLocalTime(time, 'UTC')).toBe('14:23 UTC')
		expect(formatLocalTime(time + 86_400_000, 'UTC', time)).toBe('Oct 19, 14:23 UTC')
		// 23:00 UTC is already the next day in Tokyo.
		expect(formatLocalTime(Date.UTC(2026, 9, 18, 23), 'Asia/Tokyo', time)).toBe('Oct 19, 08:00 GMT+9')
		expect(formatLocalTime(Number.NaN, 'UTC')).toBe(MISSING)
	})

	test('a long date and time names its zone, which follows daylight saving time', () => {
		const time = Date.UTC(1997, 8, 16, 18, 47, 11)
		expect(formatLongDateTime(time, 'UTC')).toBe('Sep 16, 1997, 18:47:11 UTC')
		// The same instant is the next day in Tokyo.
		expect(formatLongDateTime(time, 'Asia/Tokyo')).toBe('Sep 17, 1997, 03:47:11 GMT+9')
		expect(formatLongDateTime(Date.UTC(2025, 2, 14, 6, 58, 43), 'America/New_York')).toBe('Mar 14, 2025, 02:58:43 EDT')
		expect(formatLongDateTime(Date.UTC(2025, 0, 14, 6, 58, 43), 'America/New_York')).toBe('Jan 14, 2025, 01:58:43 EST')
		expect(formatLongDateTime(Number.NaN, 'UTC')).toBe(MISSING)
	})

	test('formatters are shared by locale and options', () => {
		expect(dateTimeFormat({ timeZone: 'UTC', hour: '2-digit' })).toBe(dateTimeFormat({ timeZone: 'UTC', hour: '2-digit', minute: undefined }))
		expect(dateTimeFormat({ timeZone: 'UTC' }, 'sv-SE')).not.toBe(dateTimeFormat({ timeZone: 'UTC' }))
	})
})

test('formats sample values and counts', () => {
	expect(formatSampleValue(1019.98634)).toBe('1019.99')
	expect(formatSampleValue(65535)).toBe('65535')
	expect(formatSampleValue(0.0123456)).toBe('0.0123456')
	expect(formatSampleValue(-2.5)).toBe('−2.5')
	expect(formatSampleValue(1.2345e-5)).toBe('1.234e-5')
	expect(formatSampleValue(Number.NaN)).toBe('NaN')
	expect(formatSampleValue(Number.POSITIVE_INFINITY)).toBe('+∞')
	expect(formatSampleValue(Number.NEGATIVE_INFINITY)).toBe('−∞')
	expect(formatCount(1048576)).toBe('1,048,576')
	expect(formatCount(Number.NaN)).toBe('—')
})
