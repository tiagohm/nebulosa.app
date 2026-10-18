import { expect, test } from 'bun:test'
import { deg } from 'nebulosa/src/math/units/angle'
import { formatAngularSize, formatDeclination, formatDegrees, formatLocalTime, formatMagnitude, formatRightAscension, formatSolarSystemDistance, formatStellarDistance } from './format'

test('angles', () => {
	expect(formatRightAscension(1.7677953696021995)).toBe('06h 45m 08.9s')
	expect(formatDeclination(-0.291751258517685)).toBe('-16° 42′ 58″')
	expect(formatDeclination(deg(41.27))).toBe('+41° 16′ 12″')
	expect(formatDegrees(deg(265.357))).toBe('265.4°')
	expect(formatAngularSize(deg(189.1 / 60))).toBe('189.1′')
	expect(formatAngularSize(deg(45 / 3600))).toBe('45″')
})

test('distances and magnitudes', () => {
	expect(formatSolarSystemDistance(0.002714)).toBe('406,009 km')
	expect(formatSolarSystemDistance(1.538688)).toBe('1.5387 AU')
	expect(formatSolarSystemDistance(30.1)).toBe('30.10 AU')
	expect(formatStellarDistance(543940.92)).toBe('8.6 ly')
	expect(formatStellarDistance(84981100)).toBe('1,344 ly')
	expect(formatStellarDistance(160474019260)).toBe('2.5 Mly')
	expect(formatMagnitude(-1.4)).toBe('-1.40')
})

test('local times name their time zone', () => {
	const time = Date.UTC(2026, 9, 18, 14, 23)
	expect(formatLocalTime(time, time, 'en-US', 'America/Sao_Paulo')).toBe('11:23 GMT-3')
	expect(formatLocalTime(time, time, 'en-US', 'UTC')).toBe('14:23 UTC')
	expect(formatLocalTime(time + 86_400_000, time, 'en-US', 'UTC')).toBe('Oct 19, 14:23 UTC')
})
