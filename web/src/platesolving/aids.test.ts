import { describe, expect, test } from 'bun:test'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { deg, toArcsec } from 'nebulosa/src/math/units/angle'
import type { OverlayView } from '../viewer/transform'
import { cornerAnchor, scaleBar, visibleImage } from './aids'
import { skyAt } from './wcs'

// A TAN solution of a 2000×1000 image, s degrees per pixel, rotated by angle degrees, mirrored when flipped.
function solution({ angle = 0, flipped = false, s = 0.0005 } = {}): FitsHeader {
	const c = Math.cos(deg(angle))
	const n = Math.sin(deg(angle))
	const p = flipped ? 1 : -1
	return { CTYPE1: 'RA---TAN', CTYPE2: 'DEC--TAN', CRPIX1: 1000.5, CRPIX2: 500.5, CRVAL1: 42, CRVAL2: -17, CD1_1: p * s * c, CD1_2: -s * n, CD2_1: p * s * n, CD2_2: s * c, NAXIS1: 2000, NAXIS2: 1000 }
}

const IMAGE = { width: 2000, height: 1000 }
const WHOLE: OverlayView = { scale: 0.5, visible: { x: 0, y: 0, width: 2000, height: 1000 } }

describe('scale bar', () => {
	test.each([
		['standard', {}],
		['rotated', { angle: 47 }],
		['flipped', { flipped: true }],
	] as const)('stands for the separation of its ends on a %s image', (_, options) => {
		const header = solution(options)
		const bar = scaleBar(header, IMAGE, WHOLE)!
		const a = skyAt(header, bar.from)!
		const b = skyAt(header, bar.to)!

		expect(sphericalSeparation(a[0], a[1], b[0], b[1])).toBeCloseTo(bar.angle, 9)
		expect((bar.to.x - bar.from.x) * WHOLE.scale).toBeGreaterThanOrEqual(60)
		expect((bar.to.x - bar.from.x) * WHOLE.scale).toBeLessThanOrEqual(180)
	})

	test('stands for a smaller angle when zoomed in', () => {
		const header = solution()
		const whole = scaleBar(header, IMAGE, WHOLE)!
		const close = scaleBar(header, IMAGE, { scale: 8, visible: { x: 900, y: 450, width: 125, height: 62.5 } })!

		expect(toArcsec(whole.angle)).toBeCloseTo(600, 9)
		expect(close.angle).toBeLessThan(whole.angle)
		expect(close.from.x).toBeGreaterThanOrEqual(900)
		expect(close.to.x).toBeLessThanOrEqual(1025)
	})

	test('is left out when the scales of the two axes differ', () => {
		expect(scaleBar({ ...solution(), CD2_2: 0.0008 }, IMAGE, WHOLE)).toBeUndefined()
	})

	test('is left out when the image is off screen or too narrow on screen', () => {
		expect(scaleBar(solution(), IMAGE, { scale: 1, visible: { x: 3000, y: 0, width: 100, height: 100 } })).toBeUndefined()
		expect(scaleBar(solution(), IMAGE, { scale: 1, visible: { x: 1960, y: 0, width: 200, height: 100 } })).toBeUndefined()
	})
})

describe('corner anchor', () => {
	test('is inside the top-right corner of the visible image', () => {
		expect(cornerAnchor(IMAGE, { scale: 2, visible: { x: -100, y: 200, width: 600, height: 300 } }, 40)).toEqual({ x: 480, y: 220 })
	})

	test('is left out when the visible image is too small on screen', () => {
		expect(cornerAnchor(IMAGE, { scale: 1, visible: { x: 1950, y: 0, width: 200, height: 200 } }, 40)).toBeUndefined()
	})
})

describe('visible image', () => {
	test('is the part of the image in view', () => {
		expect(visibleImage(IMAGE, { scale: 1, visible: { x: -10, y: 900, width: 100, height: 300 } })).toEqual({ x: 0, y: 900, width: 90, height: 100 })
		expect(visibleImage(IMAGE, { scale: 1, visible: { x: 2000, y: 0, width: 10, height: 10 } })).toBeUndefined()
	})
})
