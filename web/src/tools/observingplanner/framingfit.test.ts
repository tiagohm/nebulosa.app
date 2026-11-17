import { describe, expect, test } from 'bun:test'
import { assessFraming, framingDetail } from './framingfit'

const ARCMIN = Math.PI / (180 * 60)

// 80 mm f/6 (480 mm) with an IMX571 (23.5 × 15.7 mm, 3.76 µm): 2.80° × 1.87° at 1.62″/px.
const FRAME = { width: 2 * Math.atan(23.5 / 960), height: 2 * Math.atan(15.7 / 960), scale: (206.265 * 3.76) / 480 }

describe('framing fit', () => {
	test('a target that spans a fair share of the field fits well', () => {
		const orion = assessFraming(65 * ARCMIN, 60 * ARCMIN, FRAME)
		expect(orion).toMatchObject({ fit: 'good', factor: 1 })
		expect(orion?.fill).toBeCloseTo(0.534, 2)
	})

	test('the minor axis is compared with the short side, as with the camera turned to suit the target', () => {
		// 150′ × 40′ fits the 168′ long side; turned the other way it would not.
		expect(assessFraming(150 * ARCMIN, 40 * ARCMIN, FRAME)?.fit).toBe('tight')
		// Without a minor axis the target is taken as round, so 150′ overflows the 112′ short side.
		expect(assessFraming(150 * ARCMIN, undefined, FRAME)).toMatchObject({ fit: 'mosaic', panels: 2 })
	})

	test('a target larger than the field is a mosaic, ranked lower the larger it is', () => {
		const andromeda = assessFraming(190 * ARCMIN, 60 * ARCMIN, FRAME)
		expect(andromeda).toMatchObject({ fit: 'mosaic', panels: 2 })
		expect(andromeda!.factor).toBeLessThan(0.8)
		expect(assessFraming(400 * ARCMIN, 300 * ARCMIN, FRAME)!.factor).toBeLessThan(andromeda!.factor)
	})

	test('a target spanning a small share of the field, or too few pixels, is small', () => {
		const ring = assessFraming(1.4 * ARCMIN, 1 * ARCMIN, FRAME)
		expect(ring?.fit).toBe('small')
		expect(ring?.pixels).toBeCloseTo(51.8, 0)
		expect(ring!.factor).toBeLessThan(0.1)
		// A round 20′ spans 18 % of the short side, small for this field however many pixels it covers; 25′ spans 22 %.
		expect(assessFraming(20 * ARCMIN, 20 * ARCMIN, FRAME)?.fit).toBe('small')
		expect(assessFraming(25 * ARCMIN, 25 * ARCMIN, FRAME)?.fit).toBe('good')
		// A long focal length makes even a fair share of the field too few pixels.
		expect(assessFraming(0.5 * ARCMIN, undefined, { width: 3 * ARCMIN, height: 2 * ARCMIN, scale: 2 })).toMatchObject({ fit: 'small', pixels: 15, factor: 0.5 })
	})

	test('an unknown size is not judged, and the detail states the share, pixels, and panels', () => {
		expect(assessFraming(undefined, undefined, FRAME)).toBeUndefined()
		expect(assessFraming(0, 0, FRAME)).toBeUndefined()
		expect(framingDetail({ fit: 'mosaic', fill: 1.7, factor: 0.47, pixels: 7037, panels: 2 })).toBe('170 % of the field · 7037 px across · about 2 panels')
		expect(framingDetail({ fit: 'good', fill: 0.5, factor: 1 })).toBe('50 % of the field')
	})
})
