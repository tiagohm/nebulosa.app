import { tanProject, tanUnproject } from 'nebulosa/src/astrometry/wcs/fits.wcs'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { deg, normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { Point } from '../viewer/transform'

// Geometry of a plate solution on the shared image viewer, computed once per solution with the toolkit's TAN/TAN-SIP
// transforms (tanProject, tanUnproject). The WCS addresses FITS pixels, 1-based with integer centres ((1, 1) is the
// centre of the first pixel), while the viewer draws in image pixels whose origin is the top-left corner of the first
// pixel, +X right and +Y down along the rows as stored, so a FITS pixel (x, y) is the viewer point (x - 0.5, y - 0.5).
// That offset is applied here and nowhere else. Directions are found by projecting sky offsets, so they follow the
// rotation, parity, and distortion of the solution; right ascension is unwrapped around the image centre, so a field
// across 0h is continuous, and a celestial pole inside the field widens the grid to every right ascension.

// Directions of the sky at a point of the image, as unit vectors in viewer coordinates.
export interface SkyDirections {
	// Towards increasing declination; absent at a pole or when it cannot be projected.
	readonly north?: Point
	// Towards increasing right ascension; absent at a pole or when it cannot be projected.
	readonly east?: Point
}

// Geometry of a solution drawn on the viewer.
export interface WcsGeometry extends SkyDirections {
	// Centre of the image, in viewer coordinates.
	readonly center: Point
	// Lines of constant declination, as SVG path data in viewer coordinates, inside the image.
	readonly parallels: readonly string[]
	// Lines of constant right ascension, as SVG path data in viewer coordinates, inside the image.
	readonly meridians: readonly string[]
	// Spacing of the parallels, radians.
	readonly declinationStep: number
	// Spacing of the meridians, radians.
	readonly rightAscensionStep: number
}

// Grid spacings a field may get, radians: from 1′ to 30°.
const GRID_STEPS = [1 / 60, 2 / 60, 5 / 60, 10 / 60, 15 / 60, 0.5, 1, 2, 5, 10, 15, 30].map(deg)

// Lines a grid spans across the field, about.
const GRID_LINES = 5

// Samples along each grid line and each side of the image border.
const SAMPLES = 96

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

// Returns the north and east directions at a viewer point: the projections of small offsets in declination and right
// ascension of its sky position, about ten pixels long, normalized.
export function skyDirections(solution: FitsHeader, point: Point): SkyDirections {
	const sky = skyAt(solution, point)
	const step = pixelAngle(solution, point)
	if (!sky || !step) return {}

	const [ra, dec] = sky
	const delta = 10 * step
	const cosDec = Math.cos(dec)
	// Towards a pole closer than the offset, the offset is taken backwards and the direction reversed.
	const sign = dec + delta < Math.PI / 2 ? 1 : -1
	const north = direction(point, pointAt(solution, ra, dec + sign * delta), sign)
	const east = cosDec > 1e-6 ? direction(point, pointAt(solution, normalizeAngle(ra + delta / cosDec), dec), 1) : undefined
	return { ...(north && { north }), ...(east && { east }) }
}

// Returns the geometry of a solution on an image of width × height pixels.
export function wcsGeometry(solution: FitsHeader, width: number, height: number): WcsGeometry {
	const center = { x: width / 2, y: height / 2 }
	const directions = skyDirections(solution, center)
	const sky = skyAt(solution, center)
	if (!sky) return { center, ...directions, parallels: [], meridians: [], declinationStep: 0, rightAscensionStep: 0 }

	const [centerRa, centerDec] = sky
	let raMin = Infinity
	let raMax = -Infinity
	let decMin = centerDec
	let decMax = centerDec

	for (const point of border(width, height)) {
		const position = skyAt(solution, point)
		if (!position) continue
		const ra = unwrap(position[0], centerRa)
		raMin = Math.min(raMin, ra)
		raMax = Math.max(raMax, ra)
		decMin = Math.min(decMin, position[1])
		decMax = Math.max(decMax, position[1])
	}

	const inside = (point: Point | undefined) => !!point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height
	const northPole = inside(pointAt(solution, 0, Math.PI / 2))
	const southPole = inside(pointAt(solution, 0, -Math.PI / 2))

	if (northPole) decMax = Math.PI / 2
	if (southPole) decMin = -Math.PI / 2
	if (northPole || southPole || !(raMax > raMin)) {
		raMin = centerRa - Math.PI
		raMax = centerRa + Math.PI
	}

	const declinationStep = gridStep(decMax - decMin)
	// Meridians converge with |declination|, so their spacing in right ascension widens to keep them apart on the image.
	const rightAscensionStep = gridStep(Math.min(2 * Math.PI, (raMax - raMin) * Math.max(Math.cos(centerDec), 0.1)) / Math.max(Math.cos(centerDec), 0.1))

	const visible = (ra: number, dec: number) => {
		const point = pointAt(solution, normalizeAngle(ra), dec)
		return inside(point) ? point : undefined
	}

	const parallels: string[] = []
	for (let dec = Math.ceil(decMin / declinationStep) * declinationStep; dec <= decMax; dec += declinationStep) {
		if (Math.abs(dec) >= Math.PI / 2) continue
		parallels.push(...polyline((i) => visible(raMin + ((raMax - raMin) * i) / SAMPLES, dec)))
	}

	const meridians: string[] = []
	for (let ra = Math.ceil(raMin / rightAscensionStep) * rightAscensionStep; ra < raMax; ra += rightAscensionStep) {
		meridians.push(...polyline((i) => visible(ra, decMin + ((decMax - decMin) * i) / SAMPLES)))
	}

	return { center, ...directions, parallels, meridians, declinationStep, rightAscensionStep }
}

// Returns the angle one pixel spans at a viewer point, radians, from the separation of its neighbours; undefined when
// they cannot be unprojected.
function pixelAngle(solution: FitsHeader, point: Point): number | undefined {
	const a = skyAt(solution, point)
	const b = skyAt(solution, { x: point.x + 1, y: point.y })
	const c = skyAt(solution, { x: point.x, y: point.y + 1 })
	if (!a || !b || !c) return undefined
	const step = (separation(a, b) + separation(a, c)) / 2
	return step > 0 ? step : undefined
}

// Returns the great-circle separation of two sky positions, radians, by the haversine formula.
function separation([ra1, dec1]: readonly [number, number], [ra2, dec2]: readonly [number, number]): number {
	const h = Math.sin((dec2 - dec1) / 2) ** 2 + Math.cos(dec1) * Math.cos(dec2) * Math.sin((ra2 - ra1) / 2) ** 2
	return 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

// Returns the unit vector from a point towards another one, times sign; undefined when there is none.
function direction(from: Point, to: Point | undefined, sign: number): Point | undefined {
	if (!to) return undefined
	const dx = (to.x - from.x) * sign
	const dy = (to.y - from.y) * sign
	const length = Math.hypot(dx, dy)
	return length > 0 ? { x: dx / length, y: dy / length } : undefined
}

// Returns a right ascension unwrapped into (reference - π, reference + π].
function unwrap(ra: number, reference: number): number {
	let delta = ra - reference
	while (delta > Math.PI) delta -= 2 * Math.PI
	while (delta <= -Math.PI) delta += 2 * Math.PI
	return reference + delta
}

// Returns SAMPLES points along each side of an image of width × height pixels, in viewer coordinates.
function border(width: number, height: number): Point[] {
	const points: Point[] = []

	for (let i = 0; i <= SAMPLES; i++) {
		const t = i / SAMPLES
		points.push({ x: t * width, y: 0 }, { x: t * width, y: height }, { x: 0, y: t * height }, { x: width, y: t * height })
	}

	return points
}

// Returns the smallest grid spacing that draws at most about GRID_LINES lines across a span, radians.
function gridStep(span: number): number {
	for (const step of GRID_STEPS) if (span / step <= GRID_LINES) return step
	return GRID_STEPS.at(-1)!
}

// Returns the SVG paths of a line sampled at SAMPLES + 1 points, split where a sample is outside the image.
function polyline(sample: (i: number) => Point | undefined): string[] {
	const paths: string[] = []
	let path = ''

	for (let i = 0; i <= SAMPLES; i++) {
		const point = sample(i)

		if (point) {
			path += `${path ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`
		} else if (path) {
			if (path.includes('L')) paths.push(path)
			path = ''
		}
	}

	if (path.includes('L')) paths.push(path)
	return paths
}
