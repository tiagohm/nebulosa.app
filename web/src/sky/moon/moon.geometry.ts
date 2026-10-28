import type { MoonAppearance } from 'api'
import { type Mat3, type MutMat3, matMulVec, matRotZ, matTransposeMulVec } from 'nebulosa/src/math/linear-algebra/mat3'
import type { Vec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import type { ViewTransform } from '../celestial/types'

// Geometry of the Moon drawings of the Moon Inspector, independent of React and WebGL so the texture, the fallback,
// and the feature markers share one projection. The body-fixed frame is the IAU one (+Z north pole, +X prime
// meridian, +Y 90° east); the view frame is the API's north-up one (+X right, which is celestial west, +Y celestial
// north, +Z toward the viewer), rotated by the parallactic angle for a zenith-up view. The disk is orthographic with
// a radius of 1; a viewport places it on the screen in CSS pixels, y down. Texture coordinates follow the NASA maps:
// equirectangular, u = 0 at 180° W, v = 0 at the north pole.

// Which direction is up in a Moon drawing: the observer's zenith, or celestial north.
export type MoonViewUp = 'zenith' | 'north'

// Fraction of the shorter side of the drawing the disk's diameter fills at zoom 1, leaving room for the limb.
export const DISK_FILL = 0.94

// Cosine of the Sun's zenith angle where the terminator's shading starts (just past the geometric terminator).
export const TERMINATOR_START = -0.02

// Cosine of the Sun's zenith angle where the surface is fully lit (about 3.4° of Sun elevation).
export const TERMINATOR_END = 0.06

// Brightness of the night side relative to the day side, an illustrative earthshine.
export const EARTHSHINE = 0.07

// View transform of the disk centered at zoom 1.
export const CENTERED: Readonly<ViewTransform> = { x: 0, y: 0, k: 1 }

// Where the disk is drawn: its center and radius in CSS pixels, y down.
export interface DiscViewport {
	// Width of the drawing in CSS pixels.
	readonly width: number
	// Height of the drawing in CSS pixels.
	readonly height: number
	// Horizontal position of the disk's center in CSS pixels.
	readonly centerX: number
	// Vertical position of the disk's center in CSS pixels, from the top.
	readonly centerY: number
	// Radius of the disk in CSS pixels.
	readonly radius: number
}

// A surface point projected on the disk.
export interface DiscPoint {
	// Horizontal position in Moon radii, right positive.
	readonly x: number
	// Vertical position in Moon radii, up positive.
	readonly y: number
	// Component toward the viewer; positive on the visible hemisphere.
	readonly z: number
}

// Returns the up direction actually drawn: the zenith needs an observer's parallactic angle.
export function effectiveUp(up: MoonViewUp, appearance: Pick<MoonAppearance, 'parallacticAngle'>): MoonViewUp {
	return up === 'zenith' && appearance.parallacticAngle !== undefined ? 'zenith' : 'north'
}

// Returns the rotation from the body-fixed frame to the drawn view: the API's north-up view, or for a zenith-up one
// that view turned by the parallactic angle q, so the zenith (at position angle q) points up.
export function viewMatrix(appearance: Pick<MoonAppearance, 'bodyToCamera' | 'parallacticAngle'>, up: MoonViewUp): Mat3 {
	if (effectiveUp(up, appearance) === 'north') return appearance.bodyToCamera
	return matRotZ(appearance.parallacticAngle!, [...appearance.bodyToCamera] as MutMat3)
}

// Returns the body-fixed unit vector of a planetocentric latitude and east longitude in degrees.
export function surfaceVector(latitude: number, longitude: number): Vec3 {
	const lat = (latitude * Math.PI) / 180
	const lon = (longitude * Math.PI) / 180
	return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat)]
}

// Projects a body-fixed unit vector on the disk with a view matrix.
export function projectPoint(view: Mat3, vector: Vec3): DiscPoint {
	const [x, y, z] = matMulVec(view, vector)
	return { x, y, z }
}

// Returns the body-fixed unit vector under a point of the disk in Moon radii (up positive), or undefined off the disk.
export function discToBody(view: Mat3, x: number, y: number): Vec3 | undefined {
	const r2 = x * x + y * y
	if (r2 > 1) return undefined
	return matTransposeMulVec(view, [x, y, Math.sqrt(1 - r2)])
}

// Returns the texture coordinates of a body-fixed unit vector: u in [0, 1) from 180° W eastward, v in [0, 1] from
// the north pole.
export function textureCoordinates([x, y, z]: Vec3): readonly [number, number] {
	const u = Math.atan2(y, x) / (2 * Math.PI) + 0.5
	return [u >= 1 ? 0 : u, 0.5 - Math.asin(Math.max(-1, Math.min(1, z))) / Math.PI]
}

// Returns where the disk is drawn in a drawing of a size in CSS pixels, zoomed and panned by a view transform
// (translation in CSS pixels from the centered disk, zoom factor).
export function discViewport(width: number, height: number, transform: Readonly<ViewTransform> = CENTERED): DiscViewport {
	return { width, height, centerX: width / 2 + transform.x, centerY: height / 2 + transform.y, radius: (Math.min(width, height) / 2) * DISK_FILL * transform.k }
}

// Returns the screen position in CSS pixels of a disk point.
export function discToScreen(viewport: DiscViewport, point: Pick<DiscPoint, 'x' | 'y'>): readonly [number, number] {
	return [viewport.centerX + point.x * viewport.radius, viewport.centerY - point.y * viewport.radius]
}

// Returns the light of a surface point lit from a body-fixed Sun direction, 0 (night) to 1 (day): a soft terminator
// a few degrees wide rather than Lambert shading, since the full Moon shows almost no limb darkening. The night
// side keeps EARTHSHINE of the day brightness so its features stay faintly visible.
export function sunlight(normal: Vec3, sun: Vec3) {
	const cosine = normal[0] * sun[0] + normal[1] * sun[1] + normal[2] * sun[2]
	const t = Math.max(0, Math.min(1, (cosine - TERMINATOR_START) / (TERMINATOR_END - TERMINATOR_START)))
	return EARTHSHINE + (1 - EARTHSHINE) * t * t * (3 - 2 * t)
}
