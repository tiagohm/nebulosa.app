import { expect, test } from 'bun:test'
import type { MoonAppearance } from 'api'
import type { Mat3 } from 'nebulosa/src/math/linear-algebra/mat3'
import { discToBody, discToScreen, discViewport, effectiveUp, projectPoint, sunlight, surfaceVector, textureCoordinates, viewMatrix } from './moon.geometry'
import { renderMoonPixels } from './moon.renderer'

// North-up view of a Moon whose sub-observer point is (0°, 0°) and whose north pole points to celestial north: the
// body +X (prime meridian) toward the viewer, +Y (90° E) to the right (celestial west), +Z (north) up.
const FACE_ON: Mat3 = [0, 1, 0, 0, 0, 1, 1, 0, 0]

function appearance(parallacticAngle?: number): Pick<MoonAppearance, 'bodyToCamera' | 'parallacticAngle'> {
	return { bodyToCamera: FACE_ON, parallacticAngle }
}

test('landmarks project where an observer sees them, north up', () => {
	const view = viewMatrix(appearance(), 'north')
	const crisium = projectPoint(view, surfaceVector(16.1774, 59.1037))
	const copernicus = projectPoint(view, surfaceVector(9.6209, -20.0786))
	const aristarchus = projectPoint(view, surfaceVector(23.7299, -47.4901))
	const tycho = projectPoint(view, surfaceVector(-43.2958, -11.2153))
	const farSide = projectPoint(view, surfaceVector(0, 180))

	expect(crisium.x).toBeGreaterThan(0.8)
	expect(crisium.y).toBeCloseTo(Math.sin((16.1774 * Math.PI) / 180), 10)
	expect(copernicus.x).toBeLessThan(0)
	expect(copernicus.y).toBeGreaterThan(0)
	expect(aristarchus.x).toBeLessThan(copernicus.x)
	expect(tycho.x).toBeLessThan(0)
	expect(tycho.y).toBeLessThan(-0.6)
	for (const point of [crisium, copernicus, aristarchus, tycho]) expect(point.z).toBeGreaterThan(0)
	expect(farSide.z).toBeLessThan(0)
})

test('the disk inverts the projection, and the texture puts 0° at its middle and north at its top', () => {
	const view = viewMatrix(appearance(0.7), 'zenith')
	const vector = surfaceVector(-43.2958, -11.2153)
	const point = projectPoint(view, vector)
	const back = discToBody(view, point.x, point.y)!
	for (let i = 0; i < 3; i++) expect(back[i]).toBeCloseTo(vector[i], 12)
	expect(discToBody(view, 0.8, 0.8)).toBeUndefined()

	expect(textureCoordinates(surfaceVector(0, 0))).toEqual([0.5, 0.5])
	const [u, v] = textureCoordinates(surfaceVector(16.1774, 59.1037))
	expect(u).toBeCloseTo((59.1037 + 180) / 360, 12)
	expect(v).toBeCloseTo((90 - 16.1774) / 180, 12)
	expect(textureCoordinates(surfaceVector(90, 0))[1]).toBeCloseTo(0, 12)
	expect(textureCoordinates(surfaceVector(0, 180))[0]).toBe(0)
})

test('zenith up turns the north-up view by the parallactic angle, and needs one', () => {
	const q = (30 * Math.PI) / 180
	const north = viewMatrix(appearance(q), 'north')
	const zenith = viewMatrix(appearance(q), 'zenith')
	const vector = surfaceVector(10, 20)
	const a = projectPoint(north, vector)
	const b = projectPoint(zenith, vector)

	// The zenith is at position angle q from north toward east (left): (−sin q, cos q) in the north-up view.
	const [zx, zy] = [-Math.sin(q), Math.cos(q)]
	expect(Math.cos(q) * zx + Math.sin(q) * zy).toBeCloseTo(0, 12)
	expect(b.x).toBeCloseTo(Math.cos(q) * a.x + Math.sin(q) * a.y, 12)
	expect(b.y).toBeCloseTo(-Math.sin(q) * a.x + Math.cos(q) * a.y, 12)
	expect(b.z).toBeCloseTo(a.z, 12)

	expect(effectiveUp('zenith', { parallacticAngle: undefined })).toBe('north')
	expect(viewMatrix(appearance(), 'zenith')).toBe(FACE_ON)
})

test('the viewport places the disk in CSS pixels, y down, with zoom and pan', () => {
	const viewport = discViewport(400, 200, { x: 10, y: -20, k: 2 })
	expect(viewport).toEqual({ width: 400, height: 200, centerX: 210, centerY: 80, radius: 188 })
	expect(discToScreen(viewport, { x: 1, y: 1 })).toEqual([398, -108])
})

test('the sunlit side is lit, the night side keeps a faint earthshine', () => {
	const sun = surfaceVector(0, 90)
	expect(sunlight(surfaceVector(0, 90), sun)).toBe(1)
	expect(sunlight(surfaceVector(0, -90), sun)).toBeCloseTo(0.07, 12)
	expect(sunlight(surfaceVector(0, 0), sun)).toBeGreaterThan(0.07)
	expect(sunlight(surfaceVector(0, 0), sun)).toBeLessThan(1)
})

test('the CPU fallback draws the lit texture inside the disk only', () => {
	const texture = { data: new Uint8ClampedArray(4 * 4 * 2), width: 4, height: 2 }
	texture.data.fill(200)
	const width = 20
	const height = 20
	const target = new Uint8ClampedArray(width * height * 4)
	renderMoonPixels(target, width, height, texture, { view: FACE_ON, sun: surfaceVector(0, 90), viewport: discViewport(10, 10) }, 2)

	const pixel = (x: number, y: number) => Array.from(target.subarray((y * width + x) * 4, (y * width + x) * 4 + 4))
	expect(pixel(0, 0)).toEqual([0, 0, 0, 0])
	// Right of the center is lunar east (90° E), where the Sun is: lit. Left is night: earthshine.
	expect(pixel(16, 10)).toEqual([200, 200, 200, 255])
	expect(pixel(3, 10)[0]).toBeLessThan(20)
	expect(pixel(3, 10)[3]).toBe(255)
})
