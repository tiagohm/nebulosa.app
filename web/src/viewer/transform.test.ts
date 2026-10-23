import { describe, expect, test } from 'bun:test'
import { adaptView, centered, FIT_VIEW, fit, MAX_SCALE, MIN_SCALE, manualView, panBy, pixelAt, toImage, viewTransform, zoomAt } from './transform'

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

describe('viewer view', () => {
	const image = { width: 400, height: 200 }

	test('a fit view fits the image', () => {
		expect(viewTransform(FIT_VIEW, image, { width: 200, height: 200 })).toEqual(fit(image, { width: 200, height: 200 }))
	})

	test('a manual view round-trips its transform', () => {
		const viewport = { width: 300, height: 100 }
		const transform = { scale: 2, x: -50, y: 20 }
		expect(viewTransform(manualView(transform, viewport), image, viewport)).toEqual(transform)
	})

	test('a resized viewport keeps the same image point centered', () => {
		const view = manualView({ scale: 2, x: -50, y: 20 }, { width: 300, height: 100 })
		const resized = viewTransform(view, image, { width: 500, height: 300 })
		expect(toImage(resized, { x: 250, y: 150 })).toEqual(view.kind === 'manual' ? view.center : { x: 0, y: 0 })
		expect(resized.scale).toBe(2)
	})
})

describe('adaptView', () => {
	const view = { kind: 'manual', scale: 2, center: { x: 100, y: 50 } } as const

	test('keeps a fitted view and a view of an image of the same size', () => {
		expect(adaptView(FIT_VIEW, { width: 400, height: 200 }, { width: 200, height: 100 })).toBe(FIT_VIEW)
		expect(adaptView(view, { width: 400, height: 200 }, { width: 400, height: 200 })).toBe(view)
	})

	test('keeps the relative center and the fraction of the image shown when the size changes', () => {
		expect(adaptView(view, { width: 400, height: 200 }, { width: 200, height: 100 })).toEqual({ kind: 'manual', scale: 4, center: { x: 50, y: 25 } })
	})

	test('keeps the scale within its limits', () => {
		expect(adaptView({ kind: 'manual', scale: MAX_SCALE, center: { x: 0, y: 0 } }, { width: 400, height: 200 }, { width: 100, height: 50 })).toMatchObject({ scale: MAX_SCALE })
	})
})
