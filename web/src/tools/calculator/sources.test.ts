import { describe, expect, test } from 'bun:test'
import { importOptics, isOriginCurrent, opticsSources, type SourceContext, type SourceFraming, sourceGroup, sourceLabel } from './sources'

const FRAMING: SourceFraming = { id: 'p1', name: 'Refractor', optics: { focalLength: 420, focalMultiplier: 1, aperture: 70, sensor: { kind: 'physical', width: 22.3, height: 14.9 }, rotation: 90 } }

const CONTEXT: SourceContext = {
	profileId: 'profile',
	settings: {
		telescope: { focalLength: 1000, focalMultiplier: 0.8, aperture: 200 },
		guideTelescope: { focalLength: 240, focalMultiplier: 1, aperture: 60 },
		framings: [FRAMING],
		catalogCameras: [
			{ id: 'c1', name: 'ASI294MM', sensor: { width: 8240, height: 5628, pixelSize: 2.32 }, archived: false },
			{ id: 'c2', name: 'Old camera', sensor: { width: 100, height: 100, pixelSize: 1 }, archived: true },
			{ id: 'c3', name: 'Undeclared', archived: false },
			{ id: 'c4', name: 'No pixel size', sensor: { width: 1920, height: 1080 }, archived: false },
		],
		catalogTelescopes: [
			{ id: 't1', name: 'Esprit 100', aperture: 100, focalLength: 550, archived: false },
			{ id: 't2', name: 'Old telescope', focalLength: 400, archived: true },
			{ id: 't3', name: 'Aperture only', aperture: 80, archived: false },
		],
	},
	live: { MAIN_CAMERA: { width: 6248, height: 4176, pixelSize: 3.76 }, GUIDE_CAMERA: { width: 1936, height: 1096, pixelSize: 2.9 } },
	cameras: { MAIN_CAMERA: { connectionId: 'a', id: 'main' }, GUIDE_CAMERA: { connectionId: 'a', id: 'guide' } },
}

describe('sources', () => {
	test('lists the camera roles, the cameras and telescopes of the catalog not archived, then the framings', () => {
		expect(opticsSources(CONTEXT.settings)).toEqual(['MAIN_CAMERA', 'GUIDE_CAMERA', 'catalog:c1', 'catalog:c3', 'catalog:c4', 'telescope:t1', 'telescope:t3', 'framing:p1'])
		expect(sourceLabel(CONTEXT.settings, 'telescope:t1')).toBe('Esprit 100')
		expect(sourceLabel(CONTEXT.settings, 'telescope:gone')).toBe('Deleted telescope')
		expect(sourceGroup('telescope:t1')).toBe('Equipment Catalog')
		expect(sourceLabel(CONTEXT.settings, 'catalog:c1')).toBe('ASI294MM')
		expect(sourceGroup('catalog:c1')).toBe('Equipment Catalog')
		expect(sourceLabel(CONTEXT.settings, 'framing:p1')).toBe('Refractor')
		expect(sourceLabel(CONTEXT.settings, 'framing:gone')).toBe('Deleted framing')
		expect(sourceGroup('framing:p1')).toBe('Framings')
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
		const context = { ...CONTEXT, live: { MAIN_CAMERA: CONTEXT.live.MAIN_CAMERA } }
		expect(importOptics(context, 'GUIDE_CAMERA')).toEqual({ reason: 'The Guide Camera has not reported its sensor: assign and connect it in the Equipment Setup.' })
	})

	test('optics never entered are imported as zero', () => {
		const result = importOptics({ ...CONTEXT, settings: { framings: [], catalogCameras: [], catalogTelescopes: [] } }, 'MAIN_CAMERA')
		expect('optics' in result && result.optics).toMatchObject({ focalLength: 0, focalMultiplier: 1, aperture: 0 })
	})

	test('a camera of the catalog takes the telescope and the sensor it declares, and one declaring none is refused', () => {
		expect(importOptics(CONTEXT, 'catalog:c1')).toEqual({
			optics: { focalLength: 1000, focalMultiplier: 0.8, aperture: 200, sensor: { kind: 'pixels', width: 8240, height: 5628, pixelSize: 2.32 }, rotation: 0 },
			origin: { source: 'catalog:c1', label: 'ASI294MM', profileId: 'profile' },
		})
		// A pixel size the camera does not declare stays missing in the draft.
		expect(importOptics(CONTEXT, 'catalog:c4')).toMatchObject({ optics: { sensor: { kind: 'pixels', width: 1920, height: 1080, pixelSize: 0 } } })
		expect(importOptics(CONTEXT, 'catalog:c3')).toEqual({ reason: 'No sensor is declared for Undeclared: declare it in Settings → Equipment Catalog.' })
		expect(importOptics(CONTEXT, 'catalog:gone')).toEqual({ reason: 'The camera is no longer in the Equipment Catalog.' })
	})

	test('a telescope of the catalog takes its native optics and the sensor of the Main Camera, and one declaring no focal length is refused', () => {
		expect(importOptics(CONTEXT, 'telescope:t1')).toEqual({
			optics: { focalLength: 550, focalMultiplier: 1, aperture: 100, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 }, rotation: 0 },
			origin: { source: 'telescope:t1', label: 'Esprit 100', profileId: 'profile' },
		})
		expect(importOptics({ ...CONTEXT, live: {} }, 'telescope:t1')).toMatchObject({ optics: { sensor: { kind: 'pixels', width: 0, height: 0, pixelSize: 0 } } })
		expect(importOptics(CONTEXT, 'telescope:t3')).toEqual({ reason: 'No focal length is declared for Aperture only: declare it in Settings → Equipment Catalog.' })
		expect(importOptics(CONTEXT, 'telescope:gone')).toEqual({ reason: 'The telescope is no longer in the Equipment Catalog.' })
	})

	test('a framing is copied, so the copy can change without the framing', () => {
		const result = importOptics(CONTEXT, 'framing:p1')
		if (!('optics' in result)) throw new Error('framing not imported')
		expect(result.optics).toEqual(FRAMING.optics)
		expect(result.optics).not.toBe(FRAMING.optics)
		expect(result.optics.sensor).not.toBe(FRAMING.optics.sensor)
		;(result.optics as { focalLength: number }).focalLength = 1
		expect(FRAMING.optics.focalLength).toBe(420)
		expect(importOptics(CONTEXT, 'framing:gone')).toEqual({ reason: 'The framing no longer exists.' })
	})

	test('an origin is current only for the same profile and the same camera', () => {
		const result = importOptics(CONTEXT, 'MAIN_CAMERA')
		if (!('origin' in result)) throw new Error('camera not imported')
		expect(isOriginCurrent(result.origin, CONTEXT)).toBe(true)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, profileId: 'other' })).toBe(false)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, cameras: { MAIN_CAMERA: { connectionId: 'b', id: 'main' } } })).toBe(false)
		expect(isOriginCurrent(result.origin, { ...CONTEXT, cameras: {} })).toBe(false)
		const framing = importOptics(CONTEXT, 'framing:p1')
		expect('origin' in framing && isOriginCurrent(framing.origin, { ...CONTEXT, cameras: {} })).toBe(true)
	})
})
