import { tanProject, tanUnproject } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { sphericalPositionAngle, sphericalSeparation } from 'nebulosa/src/math/numerical/geometry'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import type { Point } from '../viewer/transform'

// Geometry of a plate solution on the shared image viewer with the toolkit's TAN/TAN-SIP transforms (tanProject,
// tanUnproject): sky positions of viewer points and back, local scale and directions, and offsets between sky
// positions; the grid is traced by grid.ts. The WCS addresses FITS pixels, 1-based with integer centres ((1, 1) is the
// centre of the first pixel), while the viewer draws in image pixels whose origin is the top-left corner of the first
// pixel, +X right and +Y down along the rows as stored, so a FITS pixel (x, y) is the viewer point (x - 0.5, y - 0.5).
// That offset is applied here and nowhere else. Directions are found by projecting sky offsets, so they follow the
// rotation, parity, and distortion of the solution. Sky positions are in the frame of the solution (ICRS, or FK5 J2000
// for a header that says so), never of date.

// Largest relative difference between the scales along the two image axes for a single scale to stand for both.
export const MAX_ANISOTROPY = 0.1

// Equatorial unit vector.
type UnitVector = readonly [number, number, number]

// Directions of the sky at a point of the image, as unit vectors in viewer coordinates.
export interface SkyDirections {
	// Towards increasing declination; absent when it cannot be projected.
	readonly north?: Point
	// Towards increasing right ascension; absent when it cannot be projected.
	readonly east?: Point
}

// Reference frame of the sky positions of a solution: the ICRS, or the FK5 at the J2000 equinox, which the toolkit
// accepts as an approximation of the ICRS (within 0.03″) but which is labelled apart.
export type WcsFrame = 'ICRS' | 'FK5 J2000'

// Offset from one sky position to another, every angle in radians.
export interface SkyOffset {
	// Great-circle separation, [0, π].
	readonly separation: number
	// Position angle of the second position seen from the first, from north through east, [0, 2π); absent when it is
	// undefined (coincident or antipodal positions).
	readonly positionAngle?: number
	// Difference of right ascension, second minus first, (-π, π]; not an angle on the sky.
	readonly rightAscension: number
	// Difference of declination, second minus first.
	readonly declination: number
	// Standard coordinate ξ of the second position on the plane tangent at the first, towards east; absent when the
	// second position is on the far hemisphere.
	readonly east?: number
	// Standard coordinate η of the second position on the plane tangent at the first, towards north; absent when the
	// second position is on the far hemisphere.
	readonly north?: number
}

// Separation below which a position angle is undefined, radians.
const COINCIDENT = 1e-12

// Distance from π within which two positions are antipodal and their position angle undefined, radians.
const ANTIPODAL = 1e-9

// Converts a FITS pixel (1-based, integer centres) to viewer coordinates.
export function fitsToViewer(x: number, y: number): Point {
	return { x: x - 0.5, y: y - 0.5 }
}

// Converts a viewer point to a FITS pixel (1-based, integer centres).
export function viewerToFits({ x, y }: Point): readonly [number, number] {
	return [x + 0.5, y + 0.5]
}

// Returns the sky position of a viewer point, [right ascension, declination] in radians, or undefined when the solution
// cannot unproject it.
export function skyAt(solution: FitsHeader, point: Point): readonly [number, number] | undefined {
	const [x, y] = viewerToFits(point)
	return tanUnproject(solution, x, y)
}

// Returns the viewer point of a sky position (radians), or undefined behind the tangent plane.
export function pointAt(solution: FitsHeader, rightAscension: number, declination: number): Point | undefined {
	const pixel = tanProject(solution, rightAscension, declination)
	return pixel && fitsToViewer(pixel[0], pixel[1])
}

// Returns the reference frame of the sky positions of a solution, from RADESYS, else EQUINOX (FITS WCS Paper II):
// FK5 J2000 when it names the FK5 or, without RADESYS, gives an equinox; the ICRS otherwise.
export function wcsFrame(solution: FitsHeader): WcsFrame {
	const system = typeof solution.RADESYS === 'string' ? solution.RADESYS.trim().toUpperCase() : ''
	if (system === 'FK5') return 'FK5 J2000'
	if (system === 'ICRS') return 'ICRS'
	return solution.EQUINOX === undefined ? 'ICRS' : 'FK5 J2000'
}

// Returns the offset from one sky position to another, [right ascension, declination] in radians each: the
// separation and position angle from the toolkit's atan2 formulas, which keep tiny and near-antipodal separations, the
// differences of the coordinates, and the gnomonic standard coordinates of the second position around the first.
export function skyOffset(from: readonly [number, number], to: readonly [number, number]): SkyOffset {
	const [ra0, dec0] = from
	const [ra, dec] = to
	const separation = sphericalSeparation(ra0, dec0, ra, dec)
	const positionAngle = separation >= COINCIDENT && Math.PI - separation >= ANTIPODAL ? sphericalPositionAngle(ra0, dec0, ra, dec) : undefined
	const dRa = normalizePI(ra - ra0)
	const cosDec = Math.cos(dec)
	const cosC = Math.sin(dec0) * Math.sin(dec) + Math.cos(dec0) * cosDec * Math.cos(dRa)
	const tangent = cosC > 0 ? { east: (cosDec * Math.sin(dRa)) / cosC, north: (Math.cos(dec0) * Math.sin(dec) - Math.sin(dec0) * cosDec * Math.cos(dRa)) / cosC } : undefined
	return { separation, ...(positionAngle !== undefined && { positionAngle }), rightAscension: dRa, declination: dec - dec0, ...tangent }
}

// Returns the north and east directions at a viewer point: the projections of offsets about ten pixels long along the
// great circles that leave its sky position towards north and towards east, normalized. A step along a parallel would
// follow its curvature, which near a pole bends east towards north and wraps around the pole within a few pixels of it,
// while the great circles keep the true tangent directions at any declination, a pole included, where they are those
// of the meridian of the right ascension the solution gives there.
export function skyDirections(solution: FitsHeader, point: Point): SkyDirections {
	const sky = skyAt(solution, point)
	const step = pixelScaleAt(solution, point)
	if (!sky || !step) return {}

	const [ra, dec] = sky
	const delta = 10 * step
	const cosRa = Math.cos(ra)
	const sinRa = Math.sin(ra)
	const cosDec = Math.cos(dec)
	const sinDec = Math.sin(dec)
	const position = [cosDec * cosRa, cosDec * sinRa, sinDec] as const
	const north = direction(point, pointAlong(solution, position, [-sinDec * cosRa, -sinDec * sinRa, cosDec], delta))
	const east = direction(point, pointAlong(solution, position, [-sinRa, cosRa, 0], delta))
	return { ...(north && { north }), ...(east && { east }) }
}

// Returns the viewer point `angle` radians along the great circle that leaves a sky position (an equatorial unit vector)
// along a unit vector tangent to the sphere there, or undefined behind the tangent plane.
function pointAlong(solution: FitsHeader, position: UnitVector, tangent: UnitVector, angle: number): Point | undefined {
	const cos = Math.cos(angle)
	const sin = Math.sin(angle)
	const x = position[0] * cos + tangent[0] * sin
	const y = position[1] * cos + tangent[1] * sin
	const z = position[2] * cos + tangent[2] * sin
	return pointAt(solution, Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y)))
}

// Returns the separation from a viewer point to its neighbours one pixel to the right and one below, radians per pixel;
// undefined when they cannot be unprojected.
function axisScalesAt(solution: FitsHeader, point: Point): readonly [number, number] | undefined {
	const a = skyAt(solution, point)
	const b = skyAt(solution, { x: point.x + 1, y: point.y })
	const c = skyAt(solution, { x: point.x, y: point.y + 1 })
	if (!a || !b || !c) return undefined
	return [sphericalSeparation(a[0], a[1], b[0], b[1]), sphericalSeparation(a[0], a[1], c[0], c[1])]
}

// Returns the angle one image pixel spans at a viewer point, radians per pixel: the mean separation of its neighbours
// one pixel to the right and one below, so it follows the local distortion of the solution; undefined when they cannot
// be unprojected.
export function pixelScaleAt(solution: FitsHeader, point: Point): number | undefined {
	const scales = axisScalesAt(solution, point)
	if (!scales) return undefined
	const step = (scales[0] + scales[1]) / 2
	return step > 0 ? step : undefined
}

// Returns the pixel scale of pixelScaleAt when a single scale stands for both image axes there, undefined when they
// differ by more than MAX_ANISOTROPY, so a width in pixels is only converted to an angle when its direction does not
// matter.
export function isotropicPixelScaleAt(solution: FitsHeader, point: Point): number | undefined {
	const scales = axisScalesAt(solution, point)
	if (!scales) return undefined
	const step = (scales[0] + scales[1]) / 2
	return step > 0 && Math.abs(scales[0] - scales[1]) <= MAX_ANISOTROPY * step ? step : undefined
}

// Returns the unit vector from a point towards another one; undefined when there is none.
function direction(from: Point, to: Point | undefined): Point | undefined {
	if (!to) return undefined
	const dx = to.x - from.x
	const dy = to.y - from.y
	const length = Math.hypot(dx, dy)
	return length > 0 ? { x: dx / length, y: dy / length } : undefined
}
