import { describe, expect, test } from 'bun:test'
// oxfmt-ignore
import { DEFAULT_CROSSHAIR_CONFIG, crosshairAngleFromDisplayValue, crosshairAngleToDisplayValue, crosshairGeometry, crosshairPointFromPixels, crosshairPointInPixels, crosshairRadii, crosshairSpacingInPixels, normalizeCrosshairConfig, normalizeCrosshairPoint, screenDeltaInImage, viewportPixelsInImage } from '@shared/types/crosshair'
import { PIOVERTWO, TAU } from 'nebulosa/src/core/constants'
import { arcmin, arcsec } from 'nebulosa/src/math/units/angle'

const IMAGE_CENTER = { x: 0.5, y: 0.5 }

describe('crosshair configuration', () => {
	test('normalizes invalid persisted values', () => {
		expect(normalizeCrosshairConfig({ preset: 'unknown', center: { x: -1, y: 2 }, spacing: { unit: 'pixel', value: 2 }, aperture: 80, color: 'red', opacity: 2, lineWidth: 0, dashed: 'yes', halo: null }, 100)).toEqual({
			...DEFAULT_CROSSHAIR_CONFIG,
			center: { space: 'image', point: { x: 0, y: 1 } },
			spacing: { unit: 'pixel', value: 8 },
			opacity: 1,
			lineWidth: 0.5,
		})
	})

	test('keeps valid values and clamps pixel spacing to the image', () => {
		const config = normalizeCrosshairConfig(
			{
				...DEFAULT_CROSSHAIR_CONFIG,
				preset: 'crosshair',
				center: { x: 0.25, y: 0.75 },
				spacing: { unit: 'pixel', value: 200 },
				color: '#AABBCC',
			},
			120,
		)

		expect(config.preset).toBe('crosshair')
		expect(config.center).toEqual({ space: 'image', point: { x: 0.25, y: 0.75 } })
		expect(config.spacing).toEqual({ unit: 'pixel', value: 120 })
		expect(config.color).toBe('#aabbcc')
	})

	test('migrates removed grid presets to the default preset', () => {
		expect(normalizeCrosshairConfig({ ...DEFAULT_CROSSHAIR_CONFIG, preset: 'fine-grid' }).preset).toBe('bullseye')
		expect(normalizeCrosshairConfig({ ...DEFAULT_CROSSHAIR_CONFIG, preset: 'coarse-grid' }).preset).toBe('bullseye')
	})

	test('normalizes celestial centers and angular spacing', () => {
		const config = normalizeCrosshairConfig({
			...DEFAULT_CROSSHAIR_CONFIG,
			center: { space: 'sky', coordinate: { rightAscension: -0.5, declination: 2 } },
			spacing: { unit: 'angular', automatic: false, value: 0, displayUnit: 'invalid' },
		})

		expect(config.center).toEqual({ space: 'sky', coordinate: { rightAscension: TAU - 0.5, declination: PIOVERTWO } })
		expect(config.spacing).toEqual({ unit: 'angular', automatic: false, value: arcsec(0.1), displayUnit: 'arcminute' })
	})

	test('converts angular display units without changing the stored angle', () => {
		const angle = crosshairAngleFromDisplayValue(5, 'arcminute')
		expect(angle).toBeCloseTo(arcmin(5), 15)
		expect(crosshairAngleToDisplayValue(angle, 'arcsecond')).toBeCloseTo(300, 12)
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

	test('adds rings only to the bullseye preset', () => {
		const crosshair = crosshairGeometry({ ...DEFAULT_CROSSHAIR_CONFIG, preset: 'crosshair' }, 800, 600, 1, IMAGE_CENTER)
		const bullseye = crosshairGeometry(DEFAULT_CROSSHAIR_CONFIG, 800, 600, 1, IMAGE_CENTER)

		expect(crosshair.radii).toHaveLength(0)
		expect(bullseye.radii).toEqual([30, 60, 120])
	})

	test('keeps viewport-sized geometry stable across zoom levels', () => {
		const normal = crosshairGeometry(DEFAULT_CROSSHAIR_CONFIG, 800, 600, 1, IMAGE_CENTER)
		const zoomed = crosshairGeometry(DEFAULT_CROSSHAIR_CONFIG, 800, 600, 4, IMAGE_CENTER)

		expect(viewportPixelsInImage(16, 1)).toBe(16)
		expect(viewportPixelsInImage(16, 4)).toBe(4)
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
