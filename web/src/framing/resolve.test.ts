import { expect, test } from 'bun:test'
import type { FramingDocument } from 'api'
import { isFraming } from './geometry'
import { EQUIPMENT_FRAMING, EQUIPMENT_FRAMING_ID, type FramingContext, resolveAllFramings, resolveFramingOptics } from './resolve'

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
}

test('the Equipment Setup follows the Main Camera and the telescope with its reducer, without rotation', () => {
	const [equipment] = resolveAllFramings([], CONTEXT)
	expect(equipment.id).toBe(EQUIPMENT_FRAMING_ID)
	expect(equipment.optics).toEqual({ focalLength: 800, focalMultiplier: 0.8, aperture: 200, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 }, rotation: 0 })
	expect(equipment.telescope.label).toBe('Telescope of the Equipment Setup')
	expect(isFraming(equipment.field) && equipment.field.effectiveFocalLength).toBeCloseTo(640, 9)
})

test('a role without a sensor is named as missing, and the guide telescope is followed', () => {
	const document: FramingDocument = { ...EQUIPMENT_FRAMING, optics: { telescope: { ...EQUIPMENT_FRAMING.optics.telescope, setupOptics: 'guideTelescope' }, camera: { source: 'setup', role: 'GUIDE_CAMERA', sensor: { kind: 'pixels', width: 1, height: 1, pixelSize: 1 } } } }
	const resolved = resolveFramingOptics('g', document, CONTEXT)
	expect(resolved.optics.focalLength).toBe(240)
	expect(resolved.camera.missingCamera).toBe('GUIDE_CAMERA')
	expect(isFraming(resolved.field)).toBeFalse()
})

test('typed and model values are kept, with the rotation of the framing', () => {
	const resolved = resolveFramingOptics('m', MANUAL, CONTEXT)
	expect(resolved.optics).toEqual({ focalLength: 400, aperture: 80, focalMultiplier: 1, sensor: { kind: 'physical', width: 23.5, height: 15.6 }, rotation: 30 })
	expect(resolved.telescope.label).toBe('Entered by hand')

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
