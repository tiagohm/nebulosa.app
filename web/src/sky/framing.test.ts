import { expect, test } from 'bun:test'
import { deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { DEFAULT_OPTICS, equipmentOptics, type Framing, framePolygon, isFraming, type OpticalConfiguration, resolveFraming } from './framing'

const resolve = (optics: OpticalConfiguration) => {
	const framing = resolveFraming(optics)
	if (!isFraming(framing)) throw new Error(`missing ${framing.missing.join(', ')}`)
	return framing
}

// Angular distance between two equatorial points in radians.
function distance(a: { rightAscension: number; declination: number }, b: { rightAscension: number; declination: number }) {
	const cos = Math.sin(a.declination) * Math.sin(b.declination) + Math.cos(a.declination) * Math.cos(b.declination) * Math.cos(a.rightAscension - b.rightAscension)
	return Math.acos(Math.min(1, cos))
}

test('field of view of a physical sensor', () => {
	const framing: Framing = resolve({ ...DEFAULT_OPTICS, sensor: { kind: 'physical', width: 23.5, height: 15.6 } })
	expect(framing.effectiveFocalLength).toBe(600)
	expect(toDeg(framing.width)).toBeCloseTo(2 * toDeg(Math.atan(23.5 / 1200)), 12)
	expect(toDeg(framing.width)).toBeCloseTo(2.2438, 4)
	expect(toDeg(framing.height)).toBeCloseTo(1.4896, 4)
	expect(framing.scale).toBeUndefined()
	expect(framing.focalRatio).toBeUndefined()
})

test('pixels give the same field as their physical size, and an image scale', () => {
	const pixels = resolve({ ...DEFAULT_OPTICS, sensor: { kind: 'pixels', width: 6248, height: 4176, pixelSize: 3.76 } })
	const physical = resolve({ ...DEFAULT_OPTICS, sensor: { kind: 'physical', width: 6248 * 0.00376, height: 4176 * 0.00376 } })

	expect(pixels.width).toBeCloseTo(physical.width, 12)
	expect(pixels.height).toBeCloseTo(physical.height, 12)
	expect(pixels.scale).toBeCloseTo(1.2926, 4)
	expect(toArcsec(pixels.width) / 6248).toBeCloseTo(pixels.scale!, 3)
})

test('a reducer or Barlow is applied once', () => {
	const reduced = resolve({ ...DEFAULT_OPTICS, focalMultiplier: 0.8, aperture: 120 })
	const barlow = resolve({ ...DEFAULT_OPTICS, focalMultiplier: 2 })
	const native = resolve(DEFAULT_OPTICS)

	expect(reduced.effectiveFocalLength).toBe(480)
	expect(reduced.focalRatio).toBe(4)
	expect(barlow.effectiveFocalLength).toBe(1200)
	expect(barlow.scale).toBeCloseTo(native.scale! / 2, 12)
})

test('missing parameters are listed instead of a field', () => {
	expect(resolveFraming({ ...DEFAULT_OPTICS, focalLength: 0, sensor: { kind: 'pixels', width: 100, height: 0, pixelSize: Number.NaN } })).toEqual({ missing: ['Focal length', 'Height in pixels', 'Pixel size'] })
})

test('frame corners lie at the half diagonal from the center', () => {
	const center = { rightAscension: deg(83.8), declination: deg(-5.4) }
	const width = deg(10)
	const height = deg(6)
	const outline = framePolygon(center, width, height, deg(37), 8)

	expect(outline).toHaveLength(33)
	expect(outline[32]).toEqual(outline[0])

	const halfDiagonal = Math.atan(Math.hypot(Math.tan(width / 2), Math.tan(height / 2)))
	for (const corner of [0, 8, 16, 24]) expect(distance(outline[corner], center)).toBeCloseTo(halfDiagonal, 12)
})

test('the top edge points north at rotation 0 and east at 90°', () => {
	const center = { rightAscension: deg(30), declination: 0 }
	const height = deg(2)

	// Midpoint of the top edge, between the first two corners.
	const north = framePolygon(center, deg(4), height, 0, 2)[1]
	expect(north.rightAscension).toBeCloseTo(center.rightAscension, 12)
	expect(north.declination).toBeCloseTo(height / 2, 12)

	const east = framePolygon(center, deg(4), height, deg(90), 2)[1]
	expect(east.declination).toBeCloseTo(0, 12)
	expect(east.rightAscension).toBeCloseTo(center.rightAscension + height / 2, 12)
})

test('frames across the poles and right ascension zero stay continuous', () => {
	const outline = framePolygon({ rightAscension: deg(0.5), declination: deg(89.5) }, deg(3), deg(2), 0, 4)
	for (const point of outline) {
		expect(point.rightAscension).toBeGreaterThanOrEqual(0)
		expect(point.rightAscension).toBeLessThan(2 * Math.PI)
		expect(point.declination).toBeLessThanOrEqual(Math.PI / 2)
	}
})

test('the Equipment Setup takes the sensor of the chosen camera role, never another', () => {
	const telescope = { focalLength: 400, focalMultiplier: 0.8, aperture: 80 }
	const live = { MAIN_CAMERA: { width: 6000, height: 4000, pixelSize: 3.76 }, GUIDE_CAMERA: { width: 1280, height: 960, pixelSize: 3.75 } }
	const manual = { kind: 'physical' as const, width: 23.5, height: 15.6 }

	const main = equipmentOptics(telescope, 'MAIN_CAMERA', live, manual, 10)
	expect(main.optics).toEqual({ focalLength: 400, focalMultiplier: 0.8, aperture: 80, rotation: 10, sensor: { kind: 'pixels', width: 6000, height: 4000, pixelSize: 3.76 } })
	expect(main.missingCamera).toBeUndefined()
	// The reducer is applied once.
	expect(resolve(main.optics).effectiveFocalLength).toBeCloseTo(320, 12)

	expect(equipmentOptics(telescope, 'GUIDE_CAMERA', live, manual, 0).optics.sensor).toEqual({ kind: 'pixels', width: 1280, height: 960, pixelSize: 3.75 })
	expect(equipmentOptics(telescope, 'manual', live, manual, 0).optics.sensor).toEqual(manual)

	const missing = equipmentOptics(telescope, 'GUIDE_CAMERA', { MAIN_CAMERA: live.MAIN_CAMERA }, manual, 0)
	expect(missing.missingCamera).toBe('GUIDE_CAMERA')
	expect(isFraming(resolveFraming(missing.optics))).toBeFalse()
})

test('the Equipment Setup without telescope optics lists the focal length as missing', () => {
	const framing = resolveFraming(equipmentOptics(undefined, 'manual', {}, undefined, 0).optics)
	expect(isFraming(framing) ? [] : framing.missing).toEqual(['Focal length'])
})
