import { describe, expect, test } from 'bun:test'
import { anchoredTransform, beginGesture, gestureTransform } from './gesture'
import type { ViewTransform } from './types'

const WIDTH = 800
const HEIGHT = 600

// Screen position of a base screen position under a transform, as applyViewTransform computes it.
function screenOf(transform: ViewTransform, baseX: number, baseY: number) {
	return [WIDTH / 2 + transform.x + (baseX - WIDTH / 2) * transform.k, HEIGHT / 2 + transform.y + (baseY - HEIGHT / 2) * transform.k]
}

describe('gesture', () => {
	test('one pointer pans by its displacement', () => {
		const anchor = beginGesture([{ x: 100, y: 100 }], { x: 10, y: -5, k: 2 })!
		expect(gestureTransform(anchor, [{ x: 130, y: 80 }], WIDTH, HEIGHT, 0.5, 10)).toEqual({ x: 40, y: -25, k: 2 })
	})

	test('two pointers zoom by the spread ratio around the centroid', () => {
		const anchor = beginGesture(
			[
				{ x: 300, y: 300 },
				{ x: 500, y: 300 },
			],
			{ x: 0, y: 0, k: 1 },
		)!
		const transform = gestureTransform(
			anchor,
			[
				{ x: 200, y: 300 },
				{ x: 600, y: 300 },
			],
			WIDTH,
			HEIGHT,
			0.5,
			10,
		)

		expect(transform.k).toBe(2)
		// The base point under the centroid (400, 300) stays under it.
		expect(screenOf(transform, 400, 300)).toEqual([400, 300])
	})

	test('pinch zoom is clamped and ignores extra pointers', () => {
		const anchor = beginGesture(
			[
				{ x: 390, y: 300 },
				{ x: 410, y: 300 },
				{ x: 0, y: 0 },
			],
			{ x: 0, y: 0, k: 1 },
		)!
		const transform = gestureTransform(
			anchor,
			[
				{ x: 0, y: 300 },
				{ x: 800, y: 300 },
			],
			WIDTH,
			HEIGHT,
			0.5,
			10,
		)

		expect(transform.k).toBe(10)
	})

	test('no pointer has no gesture', () => {
		expect(beginGesture([], { x: 0, y: 0, k: 1 })).toBeUndefined()
	})

	test('wheel zoom keeps the point under the cursor', () => {
		const start = { x: 25, y: -40, k: 1.5 }
		const transform = anchoredTransform(start, 120, 450, 120, 450, 3, WIDTH, HEIGHT)
		const baseX = WIDTH / 2 + (120 - WIDTH / 2 - start.x) / start.k
		const baseY = HEIGHT / 2 + (450 - HEIGHT / 2 - start.y) / start.k
		const [x, y] = screenOf(transform, baseX, baseY)

		expect(transform.k).toBe(3)
		expect(x).toBeCloseTo(120, 9)
		expect(y).toBeCloseTo(450, 9)
	})
})
