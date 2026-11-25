import { expect, test } from 'bun:test'
import type { FramingDocument } from 'api'
import { isFraming } from './geometry'
import { EQUIPMENT_FRAMING_ID, type FramingContext, GUIDE_FRAMING_ID, resolveAllFramings, resolveFramingOptics } from './resolve'

const CONTEXT: FramingContext = {
	telescopes: { telescope: { focalLength: 800, focalMultiplier: 0.8, aperture: 200 }, guideTelescope: { focalLength: 240, focalMultiplier: 1, aperture: 60 } },
	sensors: { MAIN_CAMERA: { width: 6248, height: 4176, pixelSize: 3.76, origin: 'reported' } },
	catalogCameras: [{ id: 'cam', name: 'ASI2600', sensor: { width: 6248, height: 4176 } }],
	catalogTelescopes: [{ id: 'tel', name: 'Esprit 100', focalLength: 550 }],
}

const MANUAL: FramingDocument = {
	name: 'Manual',
	optics: { telescope: { source: 'manual', focalLength: 400, aperture: 80, focalMultiplier: 1 }, camera: { source: 'manual', sensor: { kind: 'physical', width: 23.5, height: 15.6 } } },
	rotation: 30,
	color: 1,
}

test('the Equipment Setup follows the Main Camera and the telescope with its reducer, without rotation', () => {
	const [equipment] = resolveAllFramings([], CONTEXT)
	expect(equipment.id).toBe(EQUIPMENT_FRAMING_ID)
	expect(equipment.color).toBe('main')
	expect(equipment.optics).toEqual({ focalLength: 800, focalMultiplier: 0.8, aperture: 200, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 }, rotation: 0 })
	expect(equipment.telescope.label).toBe('Main Telescope')
	expect(isFraming(equipment.field) && equipment.field.effectiveFocalLength).toBeCloseTo(640, 9)
})

test('the Guide Camera is listed second, behind the guide telescope, and named when it has no sensor', () => {
	const [, guide, saved] = resolveAllFramings([{ ...MANUAL, id: 'm' }], CONTEXT)
	expect(guide.id).toBe(GUIDE_FRAMING_ID)
	expect(guide.color).toBe('guide')
	expect(guide.optics.focalLength).toBe(240)
	expect(guide.telescope.label).toBe('Guide Telescope')
	expect(guide.camera.missingCamera).toBe('GUIDE_CAMERA')
	expect(isFraming(guide.field)).toBeFalse()
	expect(saved.id).toBe('m')

	const sensed = resolveAllFramings([], { ...CONTEXT, sensors: { ...CONTEXT.sensors, GUIDE_CAMERA: { width: 1936, height: 1096, pixelSize: 2.9, origin: 'reported' } } })[1]
	expect(isFraming(sensed.field)).toBeTrue()
})

test('typed and model values are kept, with the rotation of the framing', () => {
	const resolved = resolveFramingOptics('m', MANUAL, CONTEXT)
	expect(resolved.optics).toEqual({ focalLength: 400, aperture: 80, focalMultiplier: 1, sensor: { kind: 'physical', width: 23.5, height: 15.6 }, rotation: 30 })
	expect(resolved.telescope.label).toBe('Entered by hand')
	expect(resolved.color).toBe(1)

	const model = resolveFramingOptics('m', { ...MANUAL, optics: { ...MANUAL.optics, telescope: { ...MANUAL.optics.telescope, source: 'model', model: 'RedCat 51' } } }, CONTEXT)
	expect(model.telescope.label).toBe('RedCat 51')
})

test('a catalog item gives what it declares, keeps the copy for the rest, and the copy once deleted', () => {
	const document: FramingDocument = {
		...MANUAL,
		optics: { telescope: { source: 'catalog', telescopeId: 'tel', focalLength: 500, aperture: 100, focalMultiplier: 0.9 }, camera: { source: 'catalog', cameraId: 'cam', sensor: { kind: 'pixels', width: 1, height: 1, pixelSize: 3.76 } } },
	}
	const resolved = resolveFramingOptics('c', document, CONTEXT)
	expect(resolved.optics).toMatchObject({ focalLength: 550, aperture: 100, focalMultiplier: 0.9, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 } })
	expect(resolved.telescope).toEqual({ label: 'Esprit 100' })
	expect(resolved.camera).toEqual({ label: 'ASI2600' })

	const deleted = resolveFramingOptics('c', document, { ...CONTEXT, catalogCameras: [], catalogTelescopes: [] })
	expect(deleted.optics).toMatchObject({ focalLength: 500, aperture: 100, sensor: { kind: 'pixels', width: 1, height: 1, pixelSize: 3.76 } })
	expect(deleted.telescope).toEqual({ label: 'Deleted telescope', deleted: true })
	expect(deleted.camera).toEqual({ label: 'Deleted camera', deleted: true })
})
