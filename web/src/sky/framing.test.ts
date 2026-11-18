import { expect, test } from 'bun:test'
import { isFraming, type OpticalConfiguration, resolveFraming } from '../framing/geometry'
import { equipmentOptics } from './framing'

const resolve = (optics: OpticalConfiguration) => {
	const framing = resolveFraming(optics)
	if (!isFraming(framing)) throw new Error(`missing ${framing.missing.join(', ')}`)
	return framing
}

test('the Equipment Setup takes the sensor of the chosen camera role, never another', () => {
	const telescope = { focalLength: 400, focalMultiplier: 0.8, aperture: 80 }
	const live = { MAIN_CAMERA: { width: 6000, height: 4000, pixelSize: 3.76 }, GUIDE_CAMERA: { width: 1280, height: 960, pixelSize: 3.75 } }
	const manual = { kind: 'physical' as const, width: 23.5, height: 15.6 }

	const main = equipmentOptics({ telescope }, 'MAIN_CAMERA', live, manual, 10)
	expect(main.optics).toEqual({ focalLength: 400, focalMultiplier: 0.8, aperture: 80, rotation: 10, sensor: { kind: 'pixels', width: 6000, height: 4000, pixelSize: 3.76 } })
	expect(main.missingCamera).toBeUndefined()
	// The reducer is applied once.
	expect(resolve(main.optics).effectiveFocalLength).toBeCloseTo(320, 12)

	expect(equipmentOptics({ telescope }, 'GUIDE_CAMERA', live, manual, 0).optics.sensor).toEqual({ kind: 'pixels', width: 1280, height: 960, pixelSize: 3.75 })
	expect(equipmentOptics({ telescope }, 'manual', live, manual, 0).optics.sensor).toEqual(manual)

	const missing = equipmentOptics({ telescope }, 'GUIDE_CAMERA', { MAIN_CAMERA: live.MAIN_CAMERA }, manual, 0)
	expect(missing.missingCamera).toBe('GUIDE_CAMERA')
	expect(isFraming(resolveFraming(missing.optics))).toBeFalse()
})

test('the Guide Camera looks through the guide telescope, the Main Camera and a manual sensor through the telescope', () => {
	const telescopes = { telescope: { focalLength: 800, focalMultiplier: 1, aperture: 200 }, guideTelescope: { focalLength: 240, focalMultiplier: 0.8, aperture: 60 } }
	const live = { MAIN_CAMERA: { width: 6000, height: 4000, pixelSize: 3.76 }, GUIDE_CAMERA: { width: 1280, height: 960, pixelSize: 3.75 } }
	expect(equipmentOptics(telescopes, 'GUIDE_CAMERA', live, undefined, 0).optics).toMatchObject(telescopes.guideTelescope)
	expect(equipmentOptics(telescopes, 'MAIN_CAMERA', live, undefined, 0).optics).toMatchObject(telescopes.telescope)
	expect(equipmentOptics(telescopes, 'manual', live, undefined, 0).optics).toMatchObject(telescopes.telescope)
	// Without a guide telescope the Guide Camera field lacks its focal length, never borrowing the telescope's.
	const framing = resolveFraming(equipmentOptics({ telescope: telescopes.telescope }, 'GUIDE_CAMERA', live, undefined, 0).optics)
	expect(isFraming(framing) ? [] : framing.missing).toEqual(['Focal length'])
})

test('the Equipment Setup without telescope optics lists the focal length as missing', () => {
	const framing = resolveFraming(equipmentOptics({}, 'manual', {}, undefined, 0).optics)
	expect(isFraming(framing) ? [] : framing.missing).toEqual(['Focal length'])
})
