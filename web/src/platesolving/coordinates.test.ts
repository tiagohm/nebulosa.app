import { describe, expect, test } from 'bun:test'
import { arcsec, deg, hour } from 'nebulosa/src/math/units/angle'
import { formatAngularSize, formatDeclinationAs, formatPixel, formatPositionAngle, formatRightAscensionAs, formatSignedAngle, formatSkyPosition, MISSING } from './coordinates'

const SEXAGESIMAL = { format: 'sexagesimal', precision: 1 } as const
const DECIMAL = { format: 'decimal', precision: 1 } as const

describe('sky positions', () => {
	test('are sexagesimal with the chosen decimals', () => {
		expect(formatRightAscensionAs(hour(10.734506), SEXAGESIMAL)).toBe('10 44 04.2')
		expect(formatDeclinationAs(deg(-59.601983), SEXAGESIMAL)).toBe('-59 36 07.1')
		expect(formatRightAscensionAs(hour(10.734506), { format: 'sexagesimal', precision: 0 })).toBe('10 44 04')
	})

	test('are decimal degrees with four more decimals, right ascension normalized', () => {
		expect(formatRightAscensionAs(-deg(1), DECIMAL)).toBe('359.00000°')
		expect(formatDeclinationAs(deg(12.5), DECIMAL)).toBe('+12.50000°')
		expect(formatDeclinationAs(deg(-0.25), DECIMAL)).toBe('-0.25000°')
	})

	test('name their frame on the clipboard', () => {
		expect(formatSkyPosition([hour(10.734506), deg(-59.601983)], 'FK5 J2000', SEXAGESIMAL)).toBe('10 44 04.2 -59 36 07.1 (FK5 J2000)')
	})
})

describe('angles', () => {
	test('use the unit that suits them', () => {
		expect(formatAngularSize(arcsec(12.345))).toBe('12.35″')
		expect(formatAngularSize(arcsec(754))).toBe('12.57′')
		expect(formatAngularSize(deg(1.2346))).toBe('1.235°')
		expect(formatSignedAngle(-arcsec(3))).toBe('−3.00″')
	})

	test('write an undefined position angle as missing', () => {
		expect(formatPositionAngle(undefined)).toBe(MISSING)
		expect(formatPositionAngle(deg(123.456))).toBe('123.46°')
	})
})

test('pixels are zero-based x, y', () => {
	expect(formatPixel({ x: 0, y: 12 })).toBe('0, 12')
})
