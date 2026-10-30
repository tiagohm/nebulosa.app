import { describe, expect, test } from 'bun:test'
import { StarCatalog } from './catalog'

describe('StarCatalog', () => {
	const BOUNDS = [0, 100, 0, 100]

	function catalogOf(...stars: readonly (readonly [number, number, number])[]) {
		const catalog = new StarCatalog({ ra: stars.map(() => 0), dec: stars.map(() => 0), mag: stars.map(([mag]) => mag), names: stars.map(() => ''), ids: stars.map((_, i) => i) })
		catalog.beginProjection()
		for (const [i, [, x, y]] of stars.entries()) catalog.recordVisible(i, x, y)
		return catalog
	}

	test('count only the stars of the magnitude limit inside the view', () => {
		const catalog = catalogOf([5, 50, 50], [5, 100, 0], [8, 50, 50], [5, 150, 50], [5, 50, -1])
		expect(catalog.visibleCount).toBe(5)
		expect(catalog.countDrawn(7, BOUNDS, 10)).toBe(2)
		expect(catalog.countDrawn(9, BOUNDS, 10)).toBe(3)
	})

	test('stop counting past the limit', () => {
		const catalog = catalogOf([5, 10, 10], [5, 20, 20], [5, 30, 30], [5, 40, 40])
		expect(catalog.countDrawn(7, BOUNDS, 2)).toBe(3)
	})
})
