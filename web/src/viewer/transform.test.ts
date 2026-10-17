import { describe, expect, test } from 'bun:test'
import { centered, fit, MAX_SCALE, MIN_SCALE, panBy, pixelAt, toImage, zoomAt } from './transform'

describe('fit', () => {
	test('fits the limiting dimension and centers the other', () => {
		expect(fit({ width: 400, height: 200 }, { width: 200, height: 200 })).toEqual({ scale: 0.5, x: 0, y: 50 })
		expect(fit({ width: 100, height: 100 }, { width: 400, height: 200 })).toEqual({ scale: 2, x: 100, y: 0 })
	})

	test('an empty viewport or image falls back to actual size', () => {
		expect(fit({ width: 100, height: 100 }, { width: 0, height: 0 }).scale).toBe(1)
		expect(fit({ width: 0, height: 0 }, { width: 100, height: 100 })).toEqual({ scale: 1, x: 50, y: 50 })
	})

	test('centers at actual size', () => {
		expect(centered({ width: 100, height: 50 }, { width: 300, height: 150 }, 1)).toEqual({ scale: 1, x: 100, y: 50 })
	})
})

describe('zoom and pan', () => {
	test('zooming keeps the image point under the cursor', () => {
		const view = { scale: 1, x: 10, y: 20 }
		const at = { x: 110, y: 70 }
		const before = toImage(view, at)
		const zoomed = zoomAt(view, 2, at)

		expect(zoomed.scale).toBe(2)
		expect(toImage(zoomed, at)).toEqual(before)
	})

	test('the scale stays within its limits', () => {
		expect(zoomAt({ scale: MAX_SCALE, x: 0, y: 0 }, 2, { x: 0, y: 0 }).scale).toBe(MAX_SCALE)
		expect(zoomAt({ scale: MIN_SCALE, x: 0, y: 0 }, 0.5, { x: 0, y: 0 }).scale).toBe(MIN_SCALE)
	})

	test('panning moves the origin', () => {
		expect(panBy({ scale: 2, x: 1, y: 2 }, 10, -5)).toEqual({ scale: 2, x: 11, y: -3 })
	})
})

describe('coordinates', () => {
	test('maps viewport to image pixels', () => {
		const view = { scale: 4, x: 100, y: 50 }
		expect(toImage(view, { x: 110, y: 58 })).toEqual({ x: 2.5, y: 2 })
		expect(pixelAt({ width: 10, height: 10 }, { x: 2.5, y: 2 })).toEqual({ x: 2, y: 2 })
	})

	test('points outside the image have no pixel', () => {
		expect(pixelAt({ width: 10, height: 10 }, { x: -0.1, y: 2 })).toBeUndefined()
		expect(pixelAt({ width: 10, height: 10 }, { x: 10, y: 2 })).toBeUndefined()
	})
})
