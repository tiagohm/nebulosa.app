import type { AnnotationObject, AnnotationResult } from 'api'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { pointAt } from '../platesolving/wcs'
import type { OverlayView, Point } from '../viewer/transform'

// Pure geometry of the annotation overlay of the Images workspace, in viewer coordinates (image pixels whose origin is
// the top-left corner of the first pixel, +X right, +Y down). Sky positions are projected with the WCS their result was
// computed with through pointAt of platesolving/wcs.ts, so rotation, parity, and SIP distortion are followed and the
// FITS half-pixel offset is applied there only. The extent of a deep-sky object is an ellipse sampled on the sphere
// around its center and then projected, never an ellipse rotated on screen. Constellation figures are sampled along
// great circles and broken where the projection fails or jumps. Labels are placed in screen pixels by a deterministic
// greedy pass over a spatial grid, by priority, and never hide a marker.

// Vertices of the outline of an extended object.
const OUTLINE_VERTICES = 48

// Largest angle between two samples of a constellation segment, radians (0.5°).
const SEGMENT_STEP = Math.PI / 360

// Most samples of one constellation segment.
const MAX_SEGMENT_SAMPLES = 64

// Size of a cell of the label grid, in screen pixels.
const GRID_CELL = 64

// Gap between a marker and its label, in screen pixels.
const LABEL_GAP = 3

// Width of a character of a label relative to the font size, a conservative estimate for the UI font.
const CHARACTER_WIDTH = 0.6

// Height of a label relative to the font size.
const LINE_HEIGHT = 1.2

// An object of a result projected on its image.
export interface ProjectedAnnotation {
	// Index of the object in the result.
	readonly index: number
	// The object.
	readonly object: AnnotationObject
	// Its position, in viewer coordinates.
	readonly anchor: Point
	// Outline of its extent as SVG path data, in viewer coordinates, when the catalog gives its size.
	readonly outline?: string
	// Whether the outline is a circle of the major axis because the catalog gives no orientation or minor axis.
	readonly approximate?: boolean
	// Size along the major axis, in image pixels at the image center; 0 when unknown.
	readonly extent: number
	// Positions at the start and end of the exposure, in viewer coordinates, for a moving object.
	readonly motion?: readonly [Point, Point]
	// Radius of the position uncertainty of a minor body, in image pixels at the image center; 0 when unknown.
	readonly uncertainty: number
}

// A constellation label projected on its image.
export interface ProjectedConstellationLabel {
	// Name of the constellation.
	readonly name: string
	// Its position, in viewer coordinates.
	readonly point: Point
}

// A result projected on its image.
export interface AnnotationProjection {
	// Objects whose position projects, in the order of the result.
	readonly objects: readonly ProjectedAnnotation[]
	// Constellation figures, as SVG path data in viewer coordinates.
	readonly constellations: readonly string[]
	// Constellation labels on the image.
	readonly labels: readonly ProjectedConstellationLabel[]
}

// Returns the position at an angular distance and bearing from a sky position, all angles in radians, the bearing from
// north through east.
export function offsetPosition(rightAscension: number, declination: number, distance: number, bearing: number): readonly [number, number] {
	const sinDec = Math.sin(declination)
	const cosDec = Math.cos(declination)
	const sinDistance = Math.sin(distance)
	const cosDistance = Math.cos(distance)
	const dec = Math.asin(Math.min(1, Math.max(-1, sinDec * cosDistance + cosDec * sinDistance * Math.cos(bearing))))
	const ra = rightAscension + Math.atan2(Math.sin(bearing) * sinDistance * cosDec, cosDistance - sinDec * Math.sin(dec))
	return [ra, dec]
}

// Returns the sky positions of an ellipse around a center: semi-axes a along the position angle (from north through
// east) and b across it, all angles in radians, sampled at `vertices` points.
export function skyEllipse(rightAscension: number, declination: number, a: number, b: number, positionAngle: number, vertices: number = OUTLINE_VERTICES): (readonly [number, number])[] {
	const cosAngle = Math.cos(positionAngle)
	const sinAngle = Math.sin(positionAngle)
	const points: (readonly [number, number])[] = []

	for (let i = 0; i < vertices; i++) {
		const t = (2 * Math.PI * i) / vertices
		const major = a * Math.cos(t)
		const minor = b * Math.sin(t)
		// Offsets towards north and east of a point of the ellipse whose major axis points to the position angle.
		const north = major * cosAngle - minor * sinAngle
		const east = major * sinAngle + minor * cosAngle
		points.push(offsetPosition(rightAscension, declination, Math.hypot(north, east), Math.atan2(east, north)))
	}

	return points
}

// Returns the outline of an object with a known major axis as closed SVG path data in viewer coordinates, and whether it
// is approximate; undefined when its size is unknown or a vertex cannot be projected.
function outlineOf(solution: FitsHeader, object: AnnotationObject) {
	if (object.majorAxis === undefined) return undefined

	const approximate = object.orientation === undefined || object.minorAxis === undefined
	const a = object.majorAxis / 2
	const b = approximate ? a : object.minorAxis / 2
	let path = ''

	for (const [ra, dec] of skyEllipse(object.rightAscension, object.declination, a, b, object.orientation ?? 0)) {
		const point = pointAt(solution, ra, dec)
		if (!point) return undefined
		path += `${path ? 'L' : 'M'}${round(point.x)} ${round(point.y)}`
	}

	return { outline: `${path}Z`, approximate }
}

// Rounds a coordinate to 0.01 px, which keeps path data short.
function round(value: number) {
	return Math.round(value * 100) / 100
}

// Returns the unit vector of a sky position in radians.
function vector(rightAscension: number, declination: number): readonly [number, number, number] {
	const cosDec = Math.cos(declination)
	return [cosDec * Math.cos(rightAscension), cosDec * Math.sin(rightAscension), Math.sin(declination)]
}

// Returns the sky positions along the great circle between two positions in radians, both ends included, at most
// SEGMENT_STEP apart.
export function greatCircle(from: readonly [number, number], to: readonly [number, number]): (readonly [number, number])[] {
	const a = vector(from[0], from[1])
	const b = vector(to[0], to[1])
	const angle = Math.acos(Math.min(1, Math.max(-1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])))
	const samples = Math.min(MAX_SEGMENT_SAMPLES, Math.max(1, Math.ceil(angle / SEGMENT_STEP)))
	const sin = Math.sin(angle)
	if (sin < 1e-12) return [from, to]

	const points: (readonly [number, number])[] = []

	for (let i = 0; i <= samples; i++) {
		const t = i / samples
		const wa = Math.sin((1 - t) * angle) / sin
		const wb = Math.sin(t * angle) / sin
		const x = wa * a[0] + wb * b[0]
		const y = wa * a[1] + wb * b[1]
		const z = wa * a[2] + wb * b[2]
		points.push([Math.atan2(y, x), Math.atan2(z, Math.hypot(x, y))])
	}

	return points
}

// Returns a polyline of sky positions as SVG path data in viewer coordinates on an image of width × height pixels,
// breaking it where a position cannot be projected, falls far outside the image, or jumps by more than the image
// diagonal (a crossing of the tangent plane's horizon).
export function skyPolyline(solution: FitsHeader, positions: readonly (readonly [number, number])[], width: number, height: number): string {
	const diagonal = Math.hypot(width, height)
	let path = ''
	let previous: Point | undefined

	for (const [ra, dec] of positions) {
		const point = pointAt(solution, ra, dec)
		const usable = point && point.x > -diagonal && point.x < width + diagonal && point.y > -diagonal && point.y < height + diagonal

		if (!usable) {
			previous = undefined
			continue
		}

		const jump = previous && Math.hypot(point.x - previous.x, point.y - previous.y) > diagonal
		path += `${!previous || jump ? 'M' : 'L'}${round(point.x)} ${round(point.y)}`
		previous = point
	}

	return path
}

// Projects a result on its image with the WCS it was computed with: the objects, their outlines and motions, and the
// constellation figures and labels. Computed once per result, never on zoom or pan.
export function projectAnnotations(result: Pick<AnnotationResult, 'solution' | 'width' | 'height' | 'objects' | 'constellations' | 'field'>): AnnotationProjection {
	const { solution, width, height } = result
	const objects: ProjectedAnnotation[] = []

	for (let index = 0; index < result.objects.length; index++) {
		const object = result.objects[index]
		const anchor = pointAt(solution, object.rightAscension, object.declination)
		if (!anchor) continue

		const outline = outlineOf(solution, object)
		const start = object.motion && pointAt(solution, object.motion.start[0], object.motion.start[1])
		const end = object.motion && pointAt(solution, object.motion.end[0], object.motion.end[1])
		const extent = object.majorAxis === undefined || !(result.field.scale > 0) ? 0 : object.majorAxis / result.field.scale
		const uncertainty = object.positionError === undefined || !(result.field.scale > 0) ? 0 : object.positionError / result.field.scale
		objects.push({ index, object, anchor, extent, uncertainty, ...(outline && { outline: outline.outline, approximate: outline.approximate }), ...(start && end && { motion: [start, end] as const }) })
	}

	const constellations: string[] = []

	for (const line of result.constellations.lines) {
		const positions: (readonly [number, number])[] = []
		for (let i = 1; i < line.length; i++) positions.push(...greatCircle(line[i - 1], line[i]).slice(i === 1 ? 0 : 1))
		const path = skyPolyline(solution, positions, width, height)
		if (path) constellations.push(path)
	}

	const labels: ProjectedConstellationLabel[] = []

	for (const label of result.constellations.labels) {
		const point = pointAt(solution, label.rightAscension, label.declination)
		if (point && point.x >= 0 && point.x <= width && point.y >= 0 && point.y <= height) labels.push({ name: label.name, point })
	}

	return { objects, constellations, labels }
}

// A label to place next to a marker.
export interface LabelCandidate {
	// Stable key of the labeled object.
	readonly key: string
	// Position of its marker, in viewer coordinates.
	readonly anchor: Point
	// Text of the label.
	readonly text: string
	// Order of placement: lower first.
	readonly priority: number
	// Radius of its marker, in screen pixels; the label is placed outside it.
	readonly clearance: number
}

// A label placed by layoutLabels.
export interface PlacedLabel {
	// Key of the labeled object.
	readonly key: string
	// Text of the label.
	readonly text: string
	// Position of the text, in viewer coordinates.
	readonly x: number
	// Position of the text, in viewer coordinates.
	readonly y: number
	// Horizontal alignment of the text at its position.
	readonly textAnchor: 'start' | 'middle' | 'end'
	// Vertical alignment of the text at its position.
	readonly baseline: 'central' | 'auto' | 'hanging'
}

// Axis-aligned box in screen pixels.
interface Box {
	readonly left: number
	readonly top: number
	readonly right: number
	readonly bottom: number
}

// Directions a label is tried at around its marker, in order: right, left, above, below, then the diagonals.
const PLACEMENTS = [
	[1, 0],
	[-1, 0],
	[0, -1],
	[0, 1],
	[1, -1],
	[-1, -1],
	[1, 1],
	[-1, 1],
] as const

// Returns whether two boxes overlap.
function overlaps(a: Box, b: Box) {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
}

// Spatial grid of boxes in screen pixels, so a collision test only looks at the boxes near it.
class BoxGrid {
	readonly #cells = new Map<string, Box[]>()

	// Calls visit for every cell a box covers.
	#cover(box: Box, visit: (key: string) => boolean | void) {
		for (let x = Math.floor(box.left / GRID_CELL); x <= Math.floor(box.right / GRID_CELL); x++) {
			for (let y = Math.floor(box.top / GRID_CELL); y <= Math.floor(box.bottom / GRID_CELL); y++) {
				if (visit(`${x},${y}`) === true) return true
			}
		}

		return false
	}

	// Adds a box.
	add(box: Box) {
		this.#cover(box, (key) => {
			const cell = this.#cells.get(key)
			if (cell) cell.push(box)
			else this.#cells.set(key, [box])
		})
	}

	// Returns whether a box overlaps one already added.
	collides(box: Box) {
		return this.#cover(box, (key) => this.#cells.get(key)?.some((other) => overlaps(box, other)) === true)
	}
}

// Places at most `budget` labels of the candidates whose marker is in the visible region of a view, in order of
// priority (the pinned key first, then priority, then key), each at the first of eight positions around its marker
// where it overlaps neither a label already placed nor any marker; a label without such a position is left out, its
// marker staying drawn. fontSize is in screen pixels. Deterministic for the same candidates and view.
export function layoutLabels(candidates: readonly LabelCandidate[], view: OverlayView, fontSize: number, budget: number, pinned?: string): PlacedLabel[] {
	const { scale, visible } = view
	// Screen position of a viewer point, relative to the visible region.
	const screen = (point: Point) => ({ x: (point.x - visible.x) * scale, y: (point.y - visible.y) * scale })
	const inView = candidates.filter(({ anchor }) => anchor.x >= visible.x && anchor.x <= visible.x + visible.width && anchor.y >= visible.y && anchor.y <= visible.y + visible.height)
	const grid = new BoxGrid()

	for (const candidate of inView) {
		const { x, y } = screen(candidate.anchor)
		grid.add({ left: x - candidate.clearance, top: y - candidate.clearance, right: x + candidate.clearance, bottom: y + candidate.clearance })
	}

	const ordered = inView.toSorted((a, b) => +(b.key === pinned) - +(a.key === pinned) || a.priority - b.priority || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
	const height = fontSize * LINE_HEIGHT
	const placed: PlacedLabel[] = []

	for (const candidate of ordered) {
		if (placed.length >= budget) break

		const { x, y } = screen(candidate.anchor)
		const width = candidate.text.length * fontSize * CHARACTER_WIDTH
		const distance = candidate.clearance + LABEL_GAP

		for (const [dx, dy] of PLACEMENTS) {
			const left = dx > 0 ? x + distance : dx < 0 ? x - distance - width : x - width / 2
			const top = dy > 0 ? y + distance : dy < 0 ? y - distance - height : y - height / 2
			const box = { left, top, right: left + width, bottom: top + height }
			if (grid.collides(box)) continue

			grid.add(box)
			placed.push({
				key: candidate.key,
				text: candidate.text,
				x: visible.x + (dx > 0 ? box.left : dx < 0 ? box.right : x) / scale,
				y: visible.y + (dy > 0 ? box.top : dy < 0 ? box.bottom : y) / scale,
				textAnchor: dx > 0 ? 'start' : dx < 0 ? 'end' : 'middle',
				baseline: dy > 0 ? 'hanging' : dy < 0 ? 'auto' : 'central',
			})
			break
		}
	}

	return placed
}

// Returns the id of the object a click at a viewer point picks: the closest marker within radius (image pixels), or,
// failing that, the smallest extended object whose extent holds the point; undefined when none.
export function pickAnnotation(objects: readonly ProjectedAnnotation[], point: Point, radius: number): string | undefined {
	let best: ProjectedAnnotation | undefined
	let bestDistance = radius
	let inside: ProjectedAnnotation | undefined

	for (const projected of objects) {
		const distance = Math.hypot(point.x - projected.anchor.x, point.y - projected.anchor.y)

		if (distance <= bestDistance) {
			best = projected
			bestDistance = distance
		}

		if (distance <= projected.extent / 2 && (!inside || projected.extent < inside.extent)) inside = projected
	}

	return (best ?? inside)?.object.id
}

// Returns the projections of the results drawn together over one image, such as its local annotation and its minor-body
// search: their objects in order, and the constellations of the first one that has any.
export function mergeProjections(...projections: readonly (AnnotationProjection | undefined)[]): AnnotationProjection | undefined {
	const shown = projections.filter((e) => e !== undefined)
	if (shown.length <= 1) return shown[0]
	const withConstellations = shown.find((e) => e.constellations.length > 0 || e.labels.length > 0) ?? shown[0]
	return { objects: shown.flatMap((e) => e.objects), constellations: withConstellations.constellations, labels: withConstellations.labels }
}
