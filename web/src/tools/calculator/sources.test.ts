import { describe, expect, test } from 'bun:test'
import type { OpticalPreset } from '../../sky/framing'
import { importOptics, isOriginCurrent, opticsSources, type SourceContext, sourceLabel } from './sources'

const PRESET: OpticalPreset = { id: 'p1', name: 'Refractor', optics: { focalLength: 420, focalMultiplier: 1, aperture: 70, sensor: { kind: 'physical', width: 22.3, height: 14.9 }, rotation: 90 } }

const CONTEXT: SourceContext = {
	profileId: 'profile',
	settings: { telescope: { focalLength: 1000, focalMultiplier: 0.8, aperture: 200 }, guideTelescope: { focalLength: 240, focalMultiplier: 1, aperture: 60 }, presets: [PRESET] },
	live: { MAIN_CAMERA: { width: 6248, height: 4176, pixelSize: 3.76 }, GUIDE_CAMERA: { width: 1936, height: 1096, pixelSize: 2.9 } },
	cameras: { MAIN_CAMERA: { connectionId: 'a', id: 'main' }, GUIDE_CAMERA: { connectionId: 'a', id: 'guide' } },
}

describe('sources', () => {
	test('lists the camera roles, the manual sensor, then the presets', () => {
		expect(opticsSources(CONTEXT.settings)).toEqual(['MAIN_CAMERA', 'GUIDE_CAMERA', 'manual', 'preset:p1'])
		expect(sourceLabel(CONTEXT.settings, 'preset:p1')).toBe('Refractor')
		expect(sourceLabel(CONTEXT.settings, 'GUIDE_CAMERA')).toBe('Guide Camera')
	})

	test('the Main Camera takes the telescope and its own sensor', () => {
		const result = importOptics(CONTEXT, 'MAIN_CAMERA')
		expect(result).toEqual({
			optics: { focalLength: 1000, focalMultiplier: 0.8, aperture: 200, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 }, rotation: 0 },
			origin: { source: 'MAIN_CAMERA', label: 'Main Camera', profileId: 'profile', camera: { connectionId: 'a', id: 'main' } },
		})
	})

	test('the Guide Camera takes the guide telescope and its own sensor', () => {
		const result = importOptics(CONTEXT, 'GUIDE_CAMERA')
		expect('optics' in result && result.optics).toEqual({ focalLength: 240, focalMultiplier: 1, aperture: 60, sensor: { kind: 'pixels', width: 1936, height: 1096, pixelSize: 2.9 }, rotation: 0 })
	})

	test('a camera that reports no sensor is refused, never replaced by another sensor', () => {
		const context = { ...CONTEXT, live: { MAIN_CAMERA: CONTEXT.live.MAIN_CAMERA }, settings: { ...CONTEXT.settings, manualSensor: { kind: 'physical' as const, width: 10, height: 10 } } }
		expect(importOptics(context, 'GUIDE_CAMERA')).toEqual({ reason: 'The Guide Camera has not reported its sensor: assign and connect it in the Equipment Setup.' })
	})

	test('optics never entered are imported as zero', () => {
		const result = importOptics({ ...CONTEXT, settings: { presets: [] } }, 'MAIN_CAMERA')
		expect('optics' in result && result.optics).toMatchObject({ focalLength: 0, focalMultiplier: 1, aperture: 0 })
	})

	test('a manual sensor never entered is refused instead of an example sensor', () => {
		expect(importOptics(CONTEXT, 'manual')).toEqual({ reason: 'No manual sensor is entered in Sky → Framing.' })
		const context = { ...CONTEXT, settings: { ...CONTEXT.settings, manualSensor: { kind: 'physical' as const, width: 36, height: 24 } } }
		expect(importOptics(context, 'manual')).toEqual({ optics: { focalLength: 1000, focalMultiplier: 0.8, aperture: 200, sensor: { kind: 'physical', width: 36, height: 24 }, rotation: 0 }, origin: { source: 'manual', label: 'Manual sensor', profileId: 'profile' } })
	})

	test('a preset is copied, so the copy can change without the preset', () => {
		const result = importOptics(CONTEXT, 'preset:p1')
		if (!('optics' in result)) throw new Error('preset not imported')
		expect(result.optics).toEqual(PRESET.optics)
		expect(result.optics).not.toBe(PRESET.optics)
		expect(result.optics.sensor).not.toBe(PRESET.optics.sensor)
		;(result.optics as { focalLength: number }).focalLength = 1
		expect(PRESET.optics.focalLength).toBe(420)
		expect(importOptics(CONTEXT, 'preset:gone')).toEqual({ reason: 'The preset no longer exists.' })
	})

	test('an origin is current only for the same profile and the same camera', () => {
		const result = importOptics(CONTEXT, 'MAIN_CAMERA')
		if (!('origin' in result)) throw new Error('camera not imported')
		expect(isOriginCurrent(result.origin, CONTEXT)).toBe(true)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, profileId: 'other' })).toBe(false)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, cameras: { MAIN_CAMERA: { connectionId: 'b', id: 'main' } } })).toBe(false)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, cameras: {} })).toBe(false)
		const preset = importOptics(CONTEXT, 'preset:p1')
		expect('origin' in preset && isOriginCurrent(preset.origin, { ...CONTEXT, cameras: {} })).toBe(true)
	})
})
