import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { arcsec, deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { fitsToViewer, pixelScaleAt, pointAt, skyAt, skyDirections, skyOffset, viewerToFits, wcsFrame } from './wcs'

// A TAN solution of a 200×100 image centred at its CRPIX, scale s degrees per pixel, rotated by angle (degrees) and
// mirrored when flipped. Standard orientation (angle 0, not flipped) has east towards -X and north towards +Y.
function solution(ra: number, dec: number, { angle = 0, flipped = false, s = 0.001 } = {}): FitsHeader {
	const c = Math.cos(deg(angle))
	const n = Math.sin(deg(angle))
	const p = flipped ? 1 : -1
	return { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 100.5, CRPIX2: 50.5, CRVAL1: ra, CRVAL2: dec, CD1_1: p * s * c, CD1_2: -s * n, CD2_1: p * s * n, CD2_2: s * c, NAXIS1: 200, NAXIS2: 100 }
}

// Returns the pixel direction of a unit sky direction (east = [1, 0], north = [0, 1]) from the inverse CD matrix.
function expected(header: FitsHeader, sky: readonly [number, number]) {
	const [a, b, c, d] = [header.CD1_1, header.CD1_2, header.CD2_1, header.CD2_2] as number[]
	const det = a * d - b * c
	const x = (d * sky[0] - b * sky[1]) / det
	const y = (-c * sky[0] + a * sky[1]) / det
	const length = Math.hypot(x, y)
	return { x: x / length, y: y / length }
}

describe('pixel convention', () => {
	test('FITS pixel centres are half a pixel inside the viewer', () => {
		expect(fitsToViewer(1, 1)).toEqual({ x: 0.5, y: 0.5 })
		expect(viewerToFits({ x: 0.5, y: 0.5 })).toEqual([1, 1])
	})

	test('the reference pixel maps to the reference coordinates', () => {
		const header = solution(42, -17)
		const [ra, dec] = skyAt(header, { x: 100, y: 50 })!

		expect(toDeg(ra)).toBeCloseTo(42, 9)
		expect(toDeg(dec)).toBeCloseTo(-17, 9)
		expect(pointAt(header, deg(42), deg(-17))).toEqual({ x: 100, y: 50 })
	})
})

describe('directions', () => {
	test.each([
		['standard', {}],
		['rotated', { angle: 37 }],
		['flipped', { flipped: true }],
		['rotated and flipped', { angle: 123, flipped: true }],
	] as const)('follow the CD matrix of a %s image', (_, options) => {
		const header = solution(42, -17, options)
		const { north, east } = skyDirections(header, { x: 100, y: 50 })

		const n = expected(header, [0, 1])
		const e = expected(header, [1, 0])
		expect(north!.x).toBeCloseTo(n.x, 3)
		expect(north!.y).toBeCloseTo(n.y, 3)
		expect(east!.x).toBeCloseTo(e.x, 3)
		expect(east!.y).toBeCloseTo(e.y, 3)
	})

	test('north points down and east left on a standard image', () => {
		const { north, east } = skyDirections(solution(42, -17), { x: 100, y: 50 })

		expect(north!.y).toBeCloseTo(1, 6)
		expect(east!.x).toBeCloseTo(-1, 6)
	})

	// A point `pixels` from a pole along the rows, so a step along its parallel would wrap around the pole.
	test.each([
		[1000, 90],
		[6.7, 90],
		[3.2, 90],
		[1.6, 90],
		[0.1, 90],
		[0.01, 90],
		[0, 90],
		[6.7, -90],
		[0, -90],
	])('stay perpendicular and both exist %p pixels from the pole of declination %p', (pixels, dec) => {
		const { north, east } = skyDirections(solution(40, dec, { angle: 31 }), { x: 100 + pixels, y: 50 })

		expect(north!.x * east!.x + north!.y * east!.y).toBeCloseTo(0, 5)
		expect(Math.hypot(north!.x, north!.y)).toBeCloseTo(1, 9)
		expect(Math.hypot(east!.x, east!.y)).toBeCloseTo(1, 9)
	})

	test('north points to the pole beside it', () => {
		const header = solution(40, 90, { angle: 31 })
		const pole = pointAt(header, 0, deg(90))!
		const point = { x: pole.x + 3, y: pole.y }
		const { north } = skyDirections(header, point)

		expect(north!.x).toBeCloseTo(-1, 3)
		expect(north!.y).toBeCloseTo(0, 3)
	})

	test('keep the handedness of the image at a pole', () => {
		const handedness = (flipped: boolean) => {
			const { north, east } = skyDirections(solution(40, 90, { flipped }), { x: 100, y: 50 })
			return Math.sign(north!.x * east!.y - north!.y * east!.x)
		}

		expect(handedness(true)).toBe(-handedness(false))
	})
})

// The solution of solution(...) with a second-order SIP distortion that stretches the right of the image.
function sip(ra: number, dec: number): FitsHeader {
	return { ...solution(ra, dec), CTYPE1: 'RA---TAN-SIP', CTYPE2: 'DEC--TAN-SIP', A_ORDER: 2, B_ORDER: 2, A_2_0: 2e-3, A_1_1: 0, A_0_2: 0, B_2_0: 0, B_1_1: 0, B_0_2: 0 }
}

describe('subpixel convention', () => {
	test.each([
		[0, 0],
		[0.25, 99.75],
		[199.999, 0.001],
		[123.456, 78.9],
	])('round trips the viewer point (%p, %p)', (x, y) => {
		const header = solution(42, -17, { angle: 23 })
		const [ra, dec] = skyAt(header, { x, y })!
		const point = pointAt(header, ra, dec)!

		expect(point.x).toBeCloseTo(x, 6)
		expect(point.y).toBeCloseTo(y, 6)
	})
})

describe('frame', () => {
	test.each([
		[{}, 'ICRS'],
		[{ RADESYS: 'ICRS' }, 'ICRS'],
		[{ RADESYS: 'FK5 ', EQUINOX: 2000 }, 'FK5 J2000'],
		[{ RADESYS: 'FK5' }, 'FK5 J2000'],
		[{ EQUINOX: 2000 }, 'FK5 J2000'],
	] as const)('of %p is %s', (keywords, frame) => {
		expect(wcsFrame({ ...solution(42, -17), ...keywords })).toBe(frame)
	})
})

describe('pixel scale', () => {
	test('is the CD scale of a TAN solution', () => {
		expect(toArcsec(pixelScaleAt(solution(42, -17, { angle: 61, flipped: true }), { x: 100, y: 50 })!)).toBeCloseTo(3.6, 4)
	})

	test('follows the SIP distortion', () => {
		const header = sip(42, -17)
		const left = pixelScaleAt(header, { x: 20, y: 50 })!
		const right = pixelScaleAt(header, { x: 180, y: 50 })!

		expect(right).toBeGreaterThan(left * 1.1)
	})
})

describe('sky offset', () => {
	const a = [deg(10), deg(20)] as const

	test('is zero without a position angle for coincident positions', () => {
		const offset = skyOffset(a, a)

		expect(offset.separation).toBe(0)
		expect(offset.positionAngle).toBeUndefined()
		expect(offset.east).toBe(0)
		expect(offset.north).toBe(0)
	})

	test('keeps a tiny separation and its position angle', () => {
		const offset = skyOffset(a, [a[0], a[1] + 1e-10])

		expect(offset.separation).toBeCloseTo(1e-10, 16)
		expect(offset.positionAngle!).toBeCloseTo(0, 6)
	})

	test('has no position angle nor tangent offset for antipodal positions', () => {
		const offset = skyOffset(a, [a[0] + Math.PI, -a[1]])

		expect(offset.separation).toBeCloseTo(Math.PI, 12)
		expect(offset.positionAngle).toBeUndefined()
		expect(offset.east).toBeUndefined()
		expect(offset.north).toBeUndefined()
	})

	test('measures the position angle from north through east', () => {
		expect(toDeg(skyOffset(a, [a[0], a[1] + arcsec(10)]).positionAngle!)).toBeCloseTo(0, 6)
		expect(toDeg(skyOffset(a, [a[0] + arcsec(10), a[1]]).positionAngle!)).toBeCloseTo(90, 3)
		expect(toDeg(skyOffset(a, [a[0], a[1] - arcsec(10)]).positionAngle!)).toBeCloseTo(180, 6)
		expect(toDeg(skyOffset(a, [a[0] - arcsec(10), a[1]]).positionAngle!)).toBeCloseTo(270, 3)
	})

	test('gives the right ascension difference across 0h', () => {
		const offset = skyOffset([deg(359.9), 0], [deg(0.1), 0])

		expect(toDeg(offset.rightAscension)).toBeCloseTo(0.2, 9)
		expect(toDeg(offset.separation)).toBeCloseTo(0.2, 9)
		expect(offset.east!).toBeCloseTo(Math.tan(deg(0.2)), 12)
		expect(offset.north!).toBeCloseTo(0, 12)
	})

	test('separates the right ascension difference from the angle on the sky', () => {
		const offset = skyOffset([0, deg(60)], [deg(1), deg(60)])

		expect(toDeg(offset.rightAscension)).toBeCloseTo(1, 9)
		expect(toDeg(offset.separation)).toBeCloseTo(0.5, 3)
		expect(toDeg(offset.east!)).toBeCloseTo(0.5, 3)
	})

	test('agrees with the separation of points the SIP solution unprojects', () => {
		const header = sip(42, -17)
		const from = skyAt(header, { x: 10, y: 10 })!
		const to = skyAt(header, { x: 190, y: 90 })!
		const offset = skyOffset(from, to)
		const cos = Math.sin(from[1]) * Math.sin(to[1]) + Math.cos(from[1]) * Math.cos(to[1]) * Math.cos(to[0] - from[0])

		expect(offset.separation).toBeCloseTo(Math.acos(cos), 12)
		expect(Math.hypot(offset.east!, offset.north!)).toBeCloseTo(Math.tan(offset.separation), 12)
	})
})
