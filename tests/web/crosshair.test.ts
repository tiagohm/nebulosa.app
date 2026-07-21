import { describe, expect, test } from 'bun:test'
import { DEFAULT_CROSSHAIR_CONFIG, crosshairGeometry, crosshairPointFromPixels, crosshairPointInPixels, crosshairRadii, crosshairSpacingInPixels, normalizeCrosshairConfig, normalizeCrosshairPoint, screenDeltaInImage, viewportPixelsInImage } from '@shared/types/crosshair'

describe('crosshair configuration', () => {
	test('normalizes invalid persisted values', () => {
		expect(normalizeCrosshairConfig({ preset: 'unknown', center: { x: -1, y: 2 }, spacing: { unit: 'pixel', value: 2 }, aperture: 80, color: 'red', opacity: 2, lineWidth: 0, dashed: 'yes', halo: null }, 100)).toEqual({
			...DEFAULT_CROSSHAIR_CONFIG,
			center: { x: 0, y: 1 },
			spacing: { unit: 'pixel', value: 8 },
			aperture: 64,
			opacity: 1,
			lineWidth: 0.5,
		})
	})

	test('keeps valid values and clamps pixel spacing to the image', () => {
		const config = normalizeCrosshairConfig(
			{
				...DEFAULT_CROSSHAIR_CONFIG,
				preset: 'fine-grid',
				center: { x: 0.25, y: 0.75 },
				spacing: { unit: 'pixel', value: 200 },
				color: '#AABBCC',
			},
			120,
		)

		expect(config.preset).toBe('fine-grid')
		expect(config.center).toEqual({ x: 0.25, y: 0.75 })
		expect(config.spacing).toEqual({ unit: 'pixel', value: 120 })
		expect(config.color).toBe('#aabbcc')
	})
})

describe('crosshair geometry', () => {
	test('converts between normalized and image coordinates with clamping', () => {
		expect(crosshairPointInPixels({ x: 0.25, y: 0.75 }, 800, 600)).toEqual({ x: 200, y: 450 })
		expect(crosshairPointFromPixels({ x: -10, y: 900 }, 800, 600)).toEqual({ x: 0, y: 1 })
		expect(normalizeCrosshairPoint({ x: Number.NaN, y: Number.POSITIVE_INFINITY })).toEqual({ x: 0.5, y: 0.5 })
	})

	test('uses pixels or the smallest image dimension for spacing', () => {
		expect(crosshairSpacingInPixels({ unit: 'pixel', value: 32 }, 800, 600)).toBe(32)
		expect(crosshairSpacingInPixels({ unit: 'normalized', value: 0.05 }, 800, 600)).toBe(30)
		expect(crosshairRadii(30)).toEqual([30, 60, 120])
	})

	test('uses twice the fine-grid step for a coarse grid', () => {
		const fine = crosshairGeometry({ ...DEFAULT_CROSSHAIR_CONFIG, preset: 'fine-grid' }, 800, 600, 1)
		const coarse = crosshairGeometry({ ...DEFAULT_CROSSHAIR_CONFIG, preset: 'coarse-grid' }, 800, 600, 1)

		expect(fine.gridStep).toBe(30)
		expect(coarse.gridStep).toBe(60)
		expect(fine.grid.length).toBeGreaterThan(coarse.grid.length)
	})

	test('keeps viewport-sized geometry stable across zoom levels', () => {
		const normal = crosshairGeometry(DEFAULT_CROSSHAIR_CONFIG, 800, 600, 1)
		const zoomed = crosshairGeometry(DEFAULT_CROSSHAIR_CONFIG, 800, 600, 4)

		expect(viewportPixelsInImage(16, 1)).toBe(16)
		expect(viewportPixelsInImage(16, 4)).toBe(4)
		expect(normal.apertureRadius).toBe(8)
		expect(zoomed.apertureRadius).toBe(2)
		expect(normal.dotRadius).toBe(2)
		expect(zoomed.dotRadius).toBe(0.5)
		expect(normal.radii).toEqual(zoomed.radii)
	})

	test('converts screen drag deltas through zoom and rotation', () => {
		expect(screenDeltaInImage(20, 0, 2, 0)).toEqual({ x: 10, y: 0 })
		expect(screenDeltaInImage(20, 0, 2, 90).x).toBeCloseTo(0, 12)
		expect(screenDeltaInImage(20, 0, 2, 90).y).toBeCloseTo(-10, 12)
	})
})
