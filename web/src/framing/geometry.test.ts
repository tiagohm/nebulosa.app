import { expect, test } from 'bun:test'
import { deg, toArcsec, toDeg } from 'nebulosa/src/math/units/angle'
import { DEFAULT_OPTICS, type Framing, frameHalfExtent, frameOutline, framePolygon, isFraming, type OpticalConfiguration, resolveFraming, toTangentPlane } from './geometry'

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

test('the tangent plane puts east on +ξ and north on +η, and inverts the outline', () => {
	const center = { rightAscension: deg(83.8), declination: deg(-5.4) }
	const east = toTangentPlane(center, { rightAscension: center.rightAscension + deg(1), declination: center.declination })!
	expect(east.xi).toBeGreaterThan(0)
	expect(east.eta).toBeCloseTo(0, 3)

	const north = toTangentPlane(center, { rightAscension: center.rightAscension, declination: center.declination + deg(1) })!
	expect(north.xi).toBeCloseTo(0, 12)
	expect(north.eta).toBeCloseTo(Math.tan(deg(1)), 12)

	const width = deg(3)
	const height = deg(2)
	const tangent = frameOutline(width, height, deg(25), 4)
	const sky = framePolygon(center, width, height, deg(25), 4)
	for (let i = 0; i < sky.length; i++) {
		const point = toTangentPlane(center, sky[i])!
		expect(point.xi).toBeCloseTo(tangent[i].xi, 12)
		expect(point.eta).toBeCloseTo(tangent[i].eta, 12)
	}

	expect(toTangentPlane(center, { rightAscension: center.rightAscension + Math.PI, declination: -center.declination })).toBeUndefined()
})

test('the box of a turned frame holds its outline', () => {
	const width = deg(3)
	const height = deg(2)
	expect(frameHalfExtent(width, height, 0)).toEqual({ xi: Math.tan(width / 2), eta: Math.tan(height / 2) })

	const turned = frameHalfExtent(width, height, deg(90))
	expect(turned.xi).toBeCloseTo(Math.tan(height / 2), 12)
	expect(turned.eta).toBeCloseTo(Math.tan(width / 2), 12)

	const box = frameHalfExtent(width, height, deg(30))
	const outline = frameOutline(width, height, deg(30), 1)
	expect(Math.max(...outline.map((e) => Math.abs(e.xi)))).toBeCloseTo(box.xi, 12)
	expect(Math.max(...outline.map((e) => Math.abs(e.eta)))).toBeCloseTo(box.eta, 12)
})
