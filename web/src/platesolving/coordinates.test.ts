import { describe, expect, test } from 'bun:test'
import { arcsec, deg, hour } from 'nebulosa/src/math/units/angle'
import { MISSING } from '../format'
import { formatDeclinationAs, formatPixel, formatPixelScale, formatPositionAngle, formatRightAscensionAs, formatSkyPosition } from './coordinates'

const SEXAGESIMAL = { format: 'sexagesimal', precision: 1 } as const
const DECIMAL = { format: 'decimal', precision: 1 } as const

describe('sky positions', () => {
	test('are sexagesimal with the chosen decimals', () => {
		expect(formatRightAscensionAs(hour(10.734506), SEXAGESIMAL)).toBe('10 44 04.2')
		expect(formatDeclinationAs(deg(-59.601983), SEXAGESIMAL)).toBe('-59 36 07.1')
		expect(formatRightAscensionAs(hour(10.734506), { format: 'sexagesimal', precision: 0 })).toBe('10 44 04')
	})

	test('carry a rounded 60 into the next field and wrap a full turn of right ascension', () => {
		expect(formatRightAscensionAs(hour(23 + 59 / 60 + 59.99 / 3600), SEXAGESIMAL)).toBe('00 00 00.0')
		expect(formatDeclinationAs(deg(89 + 59 / 60 + 59.99 / 3600), SEXAGESIMAL)).toBe('+90 00 00.0')
		expect(formatRightAscensionAs(deg(359.9999999), DECIMAL)).toBe('0.00000°')
	})

	test('are decimal degrees with four more decimals, right ascension normalized', () => {
		expect(formatRightAscensionAs(-deg(1), DECIMAL)).toBe('359.00000°')
		expect(formatDeclinationAs(deg(12.5), DECIMAL)).toBe('+12.50000°')
		expect(formatDeclinationAs(deg(-0.25), DECIMAL)).toBe('-0.25000°')
	})

	test('keep the sign of a declination just south of the equator', () => {
		expect(formatDeclinationAs(-1e-9, SEXAGESIMAL)).toBe('-00 00 00.0')
		expect(formatDeclinationAs(-1e-9, DECIMAL)).toBe('-0.00000°')
	})

	test('write a non-finite coordinate as missing', () => {
		expect(formatRightAscensionAs(Number.NaN, SEXAGESIMAL)).toBe(MISSING)
		expect(formatRightAscensionAs(Number.NaN, DECIMAL)).toBe(MISSING)
		expect(formatDeclinationAs(Number.POSITIVE_INFINITY, SEXAGESIMAL)).toBe(MISSING)
		expect(formatSkyPosition([Number.NaN, 0], 'ICRS', SEXAGESIMAL)).toBe(MISSING)
	})

	test('name their frame on the clipboard', () => {
		expect(formatSkyPosition([hour(10.734506), deg(-59.601983)], 'FK5 J2000', SEXAGESIMAL)).toBe('10 44 04.2 -59 36 07.1 (FK5 J2000)')
	})
})

describe('angles', () => {
	test('write position angles in [0°, 360°) and an undefined one as missing', () => {
		expect(formatPositionAngle(undefined)).toBe(MISSING)
		expect(formatPositionAngle(deg(123.456))).toBe('123.46°')
		expect(formatPositionAngle(deg(359.999))).toBe('0.00°')
		expect(formatPositionAngle(deg(359.96), 1)).toBe('0.0°')
		expect(formatPositionAngle(deg(-0.04), 1)).toBe('0.0°')
		expect(formatPositionAngle(deg(-90), 1)).toBe('270.0°')
	})

	test('write pixel scales in arcseconds per pixel', () => {
		expect(formatPixelScale(arcsec(2.7364))).toBe('2.736″/px')
		expect(formatPixelScale(Number.NaN)).toBe(MISSING)
	})
})

test('pixels are zero-based x, y', () => {
	expect(formatPixel({ x: 0, y: 12 })).toBe('0, 12')
})
