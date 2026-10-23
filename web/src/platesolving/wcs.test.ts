import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg, toDeg } from 'nebulosa/src/math/units/angle'
import { fitsToViewer, pointAt, skyAt, skyDirections, viewerToFits, wcsGeometry } from './wcs'

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

	test('have no east at a pole', () => {
		const { north, east } = skyDirections(solution(0, 90), { x: 100, y: 50 })

		expect(east).toBeUndefined()
		expect(north).toBeDefined()
	})
})

describe('grid', () => {
	test('is continuous across 0h', () => {
		const geometry = wcsGeometry(solution(0.05, 10, { s: 0.002 }), 200, 100)

		expect(geometry.meridians.length).toBeGreaterThan(0)
		expect(geometry.parallels.length).toBeGreaterThan(0)
		// The 0h meridian crosses the image near its centre.
		expect(geometry.meridians.some((path) => Math.abs(Number(path.slice(1).split(' ')[0]) - 125) < 10)).toBeTrue()
	})

	test('covers every right ascension around a pole inside the field', () => {
		const geometry = wcsGeometry(solution(0, 89.95, { s: 0.002 }), 200, 100)

		expect(geometry.meridians.length).toBeGreaterThanOrEqual(6)
		expect(geometry.center).toEqual({ x: 100, y: 50 })
	})

	test('spaces its lines by the field size', () => {
		const geometry = wcsGeometry(solution(42, -17, { s: 0.01 }), 200, 100)

		// The field is 1°: parallels every 15′.
		expect(toDeg(geometry.declinationStep)).toBeCloseTo(0.25, 9)
		for (const path of [...geometry.parallels, ...geometry.meridians]) {
			for (const [, x, y] of path.matchAll(/[ML]([-\d.]+) ([-\d.]+)/g)) {
				expect(+x).toBeGreaterThanOrEqual(0)
				expect(+x).toBeLessThanOrEqual(200)
				expect(+y).toBeGreaterThanOrEqual(0)
				expect(+y).toBeLessThanOrEqual(100)
			}
		}
	})
})
