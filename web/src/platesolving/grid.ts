import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { OverlayView, Point, Rect, Size } from '../viewer/transform'
import { pixelScaleAt, pointAt, skyAt } from './wcs'

// Right ascension and declination grid of a plate solution over the part of the image on screen, in viewer coordinates
// (image pixels, origin at the top-left corner of the first pixel). The spacing is chosen from the distance between
// neighbouring lines as projected on screen at several points of the region, so it follows zoom, rotation, the
// convergence of meridians towards a pole, and SIP distortion; a step is kept while its spacing stays readable
// (hysteresis), so small zoom changes never make the grid jump. Lines are traced through the WCS with an adaptive
// subdivision bounded by a screen-space chord error, broken where the projection fails or jumps, and clipped to the
// region. A region covers the visible part of the image with a margin, so panning and zooming within it reuse the
// same geometry; the geometry is cached per solution. Right ascension is unwrapped around the region's centre, so a
// field across 0h is continuous, and a celestial pole in the region widens it to every right ascension.

// One second of arc, radians.
const ARCSEC = Math.PI / 648000

// One second of time of right ascension (15″), radians.
const TIME_SECOND = Math.PI / 43200

// A grid spacing in its unit (seconds of arc for declination, seconds of time for right ascension), and the number
// of minor intervals a major interval is divided into.
type LadderStep = readonly [value: number, divisions: number]

// Spacings of the parallels, seconds of arc: from 1″ to 30°.
const DECLINATION_LADDER: readonly LadderStep[] = [
	[1, 5],
	[2, 4],
	[5, 5],
	[10, 5],
	[15, 3],
	[30, 3],
	[60, 4],
	[120, 4],
	[300, 5],
	[600, 5],
	[900, 3],
	[1800, 3],
	[3600, 4],
	[7200, 4],
	[18000, 5],
	[36000, 5],
	[54000, 3],
	[108000, 3],
]

// Spacings of the meridians, seconds of time: from 1s to 6h.
const RIGHT_ASCENSION_LADDER: readonly LadderStep[] = [
	[1, 5],
	[2, 4],
	[5, 5],
	[10, 5],
	[15, 3],
	[30, 3],
	[60, 4],
	[120, 4],
	[300, 5],
	[600, 5],
	[900, 3],
	[1200, 4],
	[1800, 3],
	[3600, 4],
	[7200, 4],
	[10800, 3],
	[21600, 3],
]

// Smallest distance between major lines a new step is chosen for, in screen pixels.
const TARGET_SPACING = 90

// Range of distances between major lines within which the previous step is kept, in screen pixels.
const KEEP_SPACING = [60, 260] as const

// Smallest distance between minor lines, in screen pixels; closer minor lines are left out.
const MIN_MINOR_SPACING = 18

// Most major lines of each axis.
const MAX_MAJOR_LINES = 24

// Initial segments of a traced line, before subdivision.
const INITIAL_SEGMENTS = 16

// Deepest subdivision of an initial segment.
const MAX_DEPTH = 8

// Most segments of a traced line.
const MAX_SEGMENTS = 256

// Largest distance of a traced line from its true course, in screen pixels.
const CHORD_TOLERANCE = 0.5

// Margin added around the visible part of the image, as a fraction of its size on each side.
const REGION_MARGIN = 0.5

// Largest change of zoom, as a factor either way, the geometry of a region is reused for.
const SCALE_TOLERANCE = Math.SQRT2

// Samples along each side of the region when its coverage of the sky is measured.
const BORDER_SAMPLES = 32

// Axis of a grid line: a meridian (constant right ascension) or a parallel (constant declination).
export type GridAxis = 'rightAscension' | 'declination'

// A line of the grid inside its region.
export interface GridLine {
	// Stable identity: the axis and the value in whole seconds of time or arc.
	readonly key: string
	// Axis of the line.
	readonly axis: GridAxis
	// Right ascension in [0, 2π) or declination of the line, radians.
	readonly value: number
	// Whether it is a major line, which gets labels and ticks.
	readonly major: boolean
	// Pieces of the line inside the region, as polylines in viewer coordinates.
	readonly paths: readonly (readonly Point[])[]
}

// Grid of a solution over a region of its image.
export interface GridGeometry {
	// Region of the image the lines cover, in viewer coordinates.
	readonly region: Rect
	// Zoom the spacing was chosen for, viewport pixels per image pixel.
	readonly scale: number
	// Spacing of the major meridians, radians of right ascension.
	readonly rightAscensionStep: number
	// Spacing of the major parallels, radians.
	readonly declinationStep: number
	// Lines, major and minor.
	readonly lines: readonly GridLine[]
}

// Label of a major line where it crosses the boundary of the visible part of the image.
export interface GridLabel {
	// Key of the line.
	readonly key: string
	// Formatted value of the line.
	readonly text: string
	// Crossing of the boundary, in viewer coordinates.
	readonly point: Point
	// Side of the visible part of the image it crosses.
	readonly edge: 'left' | 'right' | 'top' | 'bottom'
}

// Short piece of a line from where it crosses the boundary of the visible part of the image, inwards.
export interface GridTick {
	// Key of the line.
	readonly key: string
	// Whether the line is major.
	readonly major: boolean
	// Polyline of the tick, in viewer coordinates.
	readonly points: readonly Point[]
}

// Geometry cached per solution, reused while the view stays inside its region and near its zoom.
const cache = new WeakMap<FitsHeader, { readonly image: Size; readonly geometry: GridGeometry }>()

// Returns the grid of a solution for the view of an image of a size, reusing the geometry computed last for the same
// solution while the visible part of the image stays inside its region and the zoom within SCALE_TOLERANCE of its own;
// undefined when no part of the image is visible or the solution cannot unproject the region.
export function cachedGrid(solution: FitsHeader, image: Size, view: OverlayView): GridGeometry | undefined {
	const cached = cache.get(solution)
	const visible = intersect(view.visible, { x: 0, y: 0, ...image })
	if (!visible) return undefined
	if (cached && cached.image.width === image.width && cached.image.height === image.height && covers(cached.geometry, visible, view.scale)) return cached.geometry
	const geometry = gridGeometry(solution, image, view, cached?.geometry)
	if (geometry) cache.set(solution, { image, geometry })
	return geometry
}

// Returns the grid of a solution over the visible part of an image of a size, with a margin, its spacing chosen for the
// zoom of the view and kept from a previous geometry while still readable; undefined when no part of the image is
// visible or the solution cannot unproject the region.
export function gridGeometry(solution: FitsHeader, image: Size, view: OverlayView, previous?: GridGeometry): GridGeometry | undefined {
	const visible = intersect(view.visible, { x: 0, y: 0, ...image })
	if (!visible) return undefined
	const region = intersect({ x: visible.x - visible.width * REGION_MARGIN, y: visible.y - visible.height * REGION_MARGIN, width: visible.width * (1 + 2 * REGION_MARGIN), height: visible.height * (1 + 2 * REGION_MARGIN) }, { x: 0, y: 0, ...image })!
	const coverage = skyCoverage(solution, region)
	const spacing = projectedSpacing(solution, region, view.scale)
	if (!coverage || !spacing) return undefined

	const declination = chooseStep(DECLINATION_LADDER, ARCSEC, spacing.declination, coverage.decMax - coverage.decMin, previous?.declinationStep)
	const rightAscension = chooseStep(RIGHT_ASCENSION_LADDER, TIME_SECOND, spacing.rightAscension, coverage.raMax - coverage.raMin, previous?.rightAscensionStep)
	const tolerance = CHORD_TOLERANCE / view.scale
	const diagonal = Math.hypot(image.width, image.height)
	const lines: GridLine[] = []

	const decDivisions = (declination.step * declination.unit * spacing.declination) / declination.divisions >= MIN_MINOR_SPACING ? declination.divisions : 1
	const decMinor = (declination.step * declination.unit) / decDivisions
	for (let k = Math.ceil(coverage.decMin / decMinor); k * decMinor <= coverage.decMax; k++) {
		const dec = k * decMinor
		if (Math.abs(dec) >= Math.PI / 2 - ARCSEC) continue
		const paths = clipAll(
			trace((ra) => pointAt(solution, normalizeAngle(ra), dec), coverage.raMin, coverage.raMax, tolerance, diagonal),
			region,
		)
		if (paths.length > 0) lines.push({ key: `declination:${Math.round(dec / ARCSEC)}`, axis: 'declination', value: dec, major: k % decDivisions === 0, paths })
	}

	const raDivisions = (rightAscension.step * rightAscension.unit * spacing.rightAscension) / rightAscension.divisions >= MIN_MINOR_SPACING ? rightAscension.divisions : 1
	const raMinor = (rightAscension.step * rightAscension.unit) / raDivisions
	const decFrom = Math.max(coverage.decMin, -Math.PI / 2)
	const decTo = Math.min(coverage.decMax, Math.PI / 2)
	for (let k = Math.ceil(coverage.raMin / raMinor); k * raMinor < coverage.raMax && k * raMinor < coverage.raMin + 2 * Math.PI; k++) {
		const ra = k * raMinor
		const paths = clipAll(
			trace((dec) => pointAt(solution, normalizeAngle(ra), dec), decFrom, decTo, tolerance, diagonal),
			region,
		)
		if (paths.length > 0) lines.push({ key: `rightAscension:${(((Math.round(ra / TIME_SECOND) % 86400) + 86400) % 86400).toFixed(0)}`, axis: 'rightAscension', value: normalizeAngle(ra), major: k % raDivisions === 0, paths })
	}

	return { region, scale: view.scale, rightAscensionStep: rightAscension.step * rightAscension.unit, declinationStep: declination.step * declination.unit, lines }
}

// Returns the labels and ticks of the major lines of a grid where they cross the boundary of the visible part of an
// image: declinations on the left side (else the right), right ascensions on the bottom (else the top), each at most
// once, keeping on each side only labels that do not overlap one already kept, in order along the side, at most
// budget labels. fontSize is the label size in screen pixels; ticks are tickLength screen pixels long.
export function gridEdges(geometry: GridGeometry, image: Size, view: OverlayView, fontSize: number, tickLength: number, budget: number): { readonly labels: readonly GridLabel[]; readonly ticks: readonly GridTick[] } {
	const visible = intersect(view.visible, { x: 0, y: 0, ...image })
	if (!visible) return { labels: [], ticks: [] }

	const epsilon = 1e-6 * Math.max(image.width, image.height)
	const edgeOf = (point: Point): GridLabel['edge'] | undefined => {
		if (Math.abs(point.x - visible.x) <= epsilon) return 'left'
		if (Math.abs(point.x - visible.x - visible.width) <= epsilon) return 'right'
		if (Math.abs(point.y - visible.y) <= epsilon) return 'top'
		if (Math.abs(point.y - visible.y - visible.height) <= epsilon) return 'bottom'
		return undefined
	}

	const candidates: GridLabel[] = []
	const ticks: GridTick[] = []

	for (const line of geometry.lines) {
		const preferred: readonly GridLabel['edge'][] = line.axis === 'declination' ? ['left', 'right', 'bottom', 'top'] : ['bottom', 'top', 'left', 'right']
		const crossings: { readonly point: Point; readonly edge: GridLabel['edge'] }[] = []

		for (const path of line.paths) {
			for (const piece of clipPolyline(path, visible)) {
				for (const [from, inwards] of [
					[piece[0], piece],
					[piece.at(-1)!, piece.toReversed()],
				] as const) {
					const edge = edgeOf(from)
					if (!edge) continue
					crossings.push({ point: from, edge })
					ticks.push({ key: `${line.key}:${edge}:${crossings.length}`, major: line.major, points: head(inwards, tickLength / view.scale) })
				}
			}
		}

		if (!line.major) continue
		const step = line.axis === 'declination' ? geometry.declinationStep : geometry.rightAscensionStep
		const best = preferred.map((edge) => crossings.find((crossing) => crossing.edge === edge)).find((crossing) => crossing !== undefined)
		if (best) candidates.push({ key: line.key, text: formatGridValue(line.axis, line.value, step), ...best })
	}

	const labels: GridLabel[] = []
	const gap = 4 / view.scale

	for (const edge of ['left', 'right', 'bottom', 'top'] as const) {
		const vertical = edge === 'left' || edge === 'right'
		const along = (label: GridLabel) => (vertical ? label.point.y : label.point.x)
		// Extent of a label along its side, image pixels: its height on a vertical side, its width on a horizontal one.
		const extent = (label: GridLabel) => (vertical ? fontSize * 1.2 : label.text.length * fontSize * 0.6) / view.scale / 2
		let end = -Infinity

		for (const label of candidates.filter((candidate) => candidate.edge === edge).toSorted((a, b) => along(a) - along(b))) {
			if (labels.length >= budget) break
			if (along(label) - extent(label) < end + gap) continue
			labels.push(label)
			end = along(label) + extent(label)
		}
	}

	return { labels, ticks }
}

// Returns the text of a grid line's value for a spacing, both radians: hours, minutes, and seconds of time for a right
// ascension in [0h, 24h), signed degrees, minutes, and seconds of arc for a declination, down to the unit of the step.
export function formatGridValue(axis: GridAxis, value: number, step: number): string {
	const pad = (n: number) => n.toFixed(0).padStart(2, '0')

	if (axis === 'rightAscension') {
		const seconds = ((Math.round(normalizeAngle(value) / TIME_SECOND) % 86400) + 86400) % 86400
		const unit = Math.round(step / TIME_SECOND)
		const h = Math.floor(seconds / 3600)
		const m = Math.floor((seconds % 3600) / 60)
		const s = seconds % 60
		if (unit % 3600 === 0) return `${pad(h)}h`
		if (unit % 60 === 0) return `${pad(h)}h ${pad(m)}m`
		return `${pad(h)}h ${pad(m)}m ${pad(s)}s`
	}

	const arcseconds = Math.round(Math.abs(value) / ARCSEC)
	const unit = Math.round(step / ARCSEC)
	const sign = value < 0 && arcseconds > 0 ? '−' : '+'
	const d = Math.floor(arcseconds / 3600)
	const m = Math.floor((arcseconds % 3600) / 60)
	const s = arcseconds % 60
	if (unit % 3600 === 0) return `${sign}${d}°`
	if (unit % 60 === 0) return `${sign}${d}° ${pad(m)}′`
	return `${sign}${d}° ${pad(m)}′ ${pad(s)}″`
}

// Returns the pieces of a polyline inside a rectangle, each segment clipped by the Liang–Barsky algorithm; a piece
// ends where the polyline leaves the rectangle.
export function clipPolyline(points: readonly Point[], rect: Rect): Point[][] {
	const pieces: Point[][] = []
	let piece: Point[] = []

	const flush = () => {
		if (piece.length > 1) pieces.push(piece)
		piece = []
	}

	for (let i = 1; i < points.length; i++) {
		const clipped = clipSegment(points[i - 1], points[i], rect)

		if (!clipped) {
			flush()
			continue
		}

		const [a, b, enters, leaves] = clipped
		if (enters) flush()
		if (piece.length === 0) piece.push(a)
		piece.push(b)
		if (leaves) flush()
	}

	flush()
	return pieces
}

// Returns a segment clipped to a rectangle, with whether its start and end were moved onto the boundary; undefined
// when it is outside.
function clipSegment(a: Point, b: Point, rect: Rect): readonly [Point, Point, boolean, boolean] | undefined {
	const dx = b.x - a.x
	const dy = b.y - a.y
	let t0 = 0
	let t1 = 1

	for (const [p, q] of [
		[-dx, a.x - rect.x],
		[dx, rect.x + rect.width - a.x],
		[-dy, a.y - rect.y],
		[dy, rect.y + rect.height - a.y],
	]) {
		if (p === 0) {
			if (q < 0) return undefined
		} else {
			const t = q / p
			if (p < 0) t0 = Math.max(t0, t)
			else t1 = Math.min(t1, t)
			if (t0 > t1) return undefined
		}
	}

	return [t0 > 0 ? { x: a.x + t0 * dx, y: a.y + t0 * dy } : a, t1 < 1 ? { x: a.x + t1 * dx, y: a.y + t1 * dy } : b, t0 > 0, t1 < 1]
}

// Returns the polylines of several paths clipped to a rectangle.
function clipAll(paths: readonly (readonly Point[])[], rect: Rect): Point[][] {
	return paths.flatMap((path) => clipPolyline(path, rect))
}

// Returns the start of a polyline up to a length along it, in its own units.
function head(points: readonly Point[], length: number): Point[] {
	const out = [points[0]]
	let left = length

	for (let i = 1; i < points.length && left > 0; i++) {
		const a = points[i - 1]
		const b = points[i]
		const d = Math.hypot(b.x - a.x, b.y - a.y)

		if (d >= left) {
			out.push({ x: a.x + ((b.x - a.x) * left) / d, y: a.y + ((b.y - a.y) * left) / d })
			break
		}

		out.push(b)
		left -= d
	}

	return out
}

// Returns a line traced through sample over [from, to] as polylines in viewer coordinates: INITIAL_SEGMENTS segments,
// each subdivided while its midpoint is more than tolerance (image pixels) from the chord, up to MAX_DEPTH levels and
// MAX_SEGMENTS segments, broken where a sample cannot be projected or two samples are more than jump apart.
function trace(sample: (t: number) => Point | undefined, from: number, to: number, tolerance: number, jump: number): Point[][] {
	const paths: Point[][] = []
	let path: Point[] = []
	let budget = MAX_SEGMENTS

	const flush = () => {
		if (path.length > 1) paths.push(path)
		path = []
	}

	const refine = (t0: number, p0: Point, t1: number, p1: Point, depth: number) => {
		if (depth < MAX_DEPTH && budget > 0) {
			const tm = (t0 + t1) / 2
			const pm = sample(tm)

			if (!pm) {
				flush()
				path.push(p1)
				return
			}

			if (deviation(pm, p0, p1) > tolerance) {
				refine(t0, p0, tm, pm, depth + 1)
				refine(tm, pm, t1, p1, depth + 1)
				return
			}
		}

		budget--
		if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > jump) flush()
		path.push(p1)
	}

	let previous = sample(from)
	let t0 = from
	if (previous) path.push(previous)

	for (let i = 1; i <= INITIAL_SEGMENTS; i++) {
		const t = from + ((to - from) * i) / INITIAL_SEGMENTS
		const point = sample(t)

		if (!point) {
			flush()
		} else if (!previous) {
			path.push(point)
		} else {
			refine(t0, previous, t, point, 0)
		}

		previous = point
		t0 = t
	}

	flush()
	return paths
}

// Returns the distance of a point from the segment between two others, in their units.
function deviation(point: Point, a: Point, b: Point): number {
	const dx = b.x - a.x
	const dy = b.y - a.y
	const length = dx * dx + dy * dy
	const t = length > 0 ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length)) : 0
	return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy)
}

// Range of sky positions a region of the image covers, radians; right ascension unwrapped around the region's centre.
interface SkyCoverage {
	// Smallest right ascension, unwrapped.
	readonly raMin: number
	// Largest right ascension, unwrapped, less than raMin + 2π.
	readonly raMax: number
	// Smallest declination.
	readonly decMin: number
	// Largest declination.
	readonly decMax: number
}

// Returns the range of sky positions of a region from the positions of its centre and border, widened to every right
// ascension and to the pole when a pole is inside it; undefined when its centre cannot be unprojected.
function skyCoverage(solution: FitsHeader, region: Rect): SkyCoverage | undefined {
	const center = skyAt(solution, { x: region.x + region.width / 2, y: region.y + region.height / 2 })
	if (!center) return undefined

	let raMin = center[0]
	let raMax = center[0]
	let decMin = center[1]
	let decMax = center[1]

	for (let i = 0; i <= BORDER_SAMPLES; i++) {
		const t = i / BORDER_SAMPLES

		for (const point of [
			{ x: region.x + t * region.width, y: region.y },
			{ x: region.x + t * region.width, y: region.y + region.height },
			{ x: region.x, y: region.y + t * region.height },
			{ x: region.x + region.width, y: region.y + t * region.height },
		]) {
			const position = skyAt(solution, point)
			if (!position) continue
			const ra = unwrap(position[0], center[0])
			raMin = Math.min(raMin, ra)
			raMax = Math.max(raMax, ra)
			decMin = Math.min(decMin, position[1])
			decMax = Math.max(decMax, position[1])
		}
	}

	const inside = (point: Point | undefined) => !!point && point.x >= region.x && point.x <= region.x + region.width && point.y >= region.y && point.y <= region.y + region.height
	const north = inside(pointAt(solution, 0, Math.PI / 2))
	const south = inside(pointAt(solution, 0, -Math.PI / 2))
	if (north) decMax = Math.PI / 2
	if (south) decMin = -Math.PI / 2
	if (north || south || !(raMax > raMin)) return { raMin: center[0] - Math.PI, raMax: center[0] + Math.PI, decMin, decMax }
	return { raMin, raMax, decMin, decMax }
}

// Returns the smallest distance on screen, in screen pixels, between neighbouring meridians and between neighbouring
// parallels per radian of their spacing, measured across the lines at the centre and four inner points of a region;
// undefined when none of them can be measured. Near a pole the meridians converge and their distance tends to 0.
function projectedSpacing(solution: FitsHeader, region: Rect, scale: number): { readonly rightAscension: number; readonly declination: number } | undefined {
	let rightAscension = Infinity
	let declination = Infinity

	for (const [fx, fy] of [
		[0.5, 0.5],
		[0.25, 0.25],
		[0.75, 0.25],
		[0.25, 0.75],
		[0.75, 0.75],
	]) {
		const point = { x: region.x + fx * region.width, y: region.y + fy * region.height }
		const sky = skyAt(solution, point)
		const step = pixelScaleAt(solution, point)
		if (!sky || !step) continue

		const [ra, dec] = sky
		const delta = 10 * step
		const sign = dec + delta < Math.PI / 2 ? 1 : -1
		const north = pointAt(solution, ra, dec + sign * delta)
		if (!north) continue
		// Image pixels per radian along the meridian, towards north.
		const n = { x: (north.x - point.x) / (sign * delta), y: (north.y - point.y) / (sign * delta) }
		const cosDec = Math.cos(dec)
		const east = cosDec > 1e-9 ? pointAt(solution, normalizeAngle(ra + delta / cosDec), dec) : undefined

		if (!east) {
			rightAscension = 0
			declination = Math.min(declination, Math.hypot(n.x, n.y) * scale)
			continue
		}

		// Image pixels per radian of right ascension along the parallel, towards east.
		const e = { x: ((east.x - point.x) * cosDec) / delta, y: ((east.y - point.y) * cosDec) / delta }
		const cross = Math.abs(e.x * n.y - e.y * n.x)
		const nLength = Math.hypot(n.x, n.y)
		const eLength = Math.hypot(e.x, e.y)
		// Distance across the meridians per radian of right ascension, and across the parallels per radian of declination.
		if (nLength > 0) rightAscension = Math.min(rightAscension, (cross / nLength) * scale)
		if (eLength > 0) declination = Math.min(declination, (cross / eLength) * scale)
	}

	return Number.isFinite(rightAscension) && Number.isFinite(declination) ? { rightAscension, declination } : undefined
}

// Step of an axis chosen from its ladder.
interface ChosenStep {
	// Major spacing, in the ladder's unit.
	readonly step: number
	// Minor intervals per major interval.
	readonly divisions: number
	// Radians per unit of the ladder.
	readonly unit: number
}

// Returns the step of an axis: the previous one (radians) while its spacing stays within KEEP_SPACING, otherwise the
// smallest of the ladder spaced at least TARGET_SPACING apart on screen, widened until at most MAX_MAJOR_LINES lines
// span the range (radians); perRadian is the distance on screen between lines per radian of spacing.
function chooseStep(ladder: readonly LadderStep[], unit: number, perRadian: number, span: number, previous?: number): ChosenStep {
	const spacing = ([value]: LadderStep) => value * unit * perRadian
	const fits = ([value]: LadderStep) => span / (value * unit) <= MAX_MAJOR_LINES
	const kept = previous === undefined ? undefined : ladder.find(([value]) => Math.abs(value * unit - previous) < 1e-12)
	const chosen = kept && spacing(kept) >= KEEP_SPACING[0] && spacing(kept) <= KEEP_SPACING[1] && fits(kept) ? kept : (ladder.find((step) => spacing(step) >= TARGET_SPACING && fits(step)) ?? ladder.at(-1)!)
	return { step: chosen[0], divisions: chosen[1], unit }
}

// Returns a right ascension unwrapped into (reference - π, reference + π], radians.
function unwrap(ra: number, reference: number): number {
	let delta = ra - reference
	while (delta > Math.PI) delta -= 2 * Math.PI
	while (delta <= -Math.PI) delta += 2 * Math.PI
	return reference + delta
}

// Returns the intersection of two rectangles, or undefined when they do not overlap.
function intersect(a: Rect, b: Rect): Rect | undefined {
	const x = Math.max(a.x, b.x)
	const y = Math.max(a.y, b.y)
	const right = Math.min(a.x + a.width, b.x + b.width)
	const bottom = Math.min(a.y + a.height, b.y + b.height)
	return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : undefined
}

// Returns whether a grid's geometry still serves a visible part of the image at a zoom: inside its region and within
// SCALE_TOLERANCE of its zoom.
function covers(geometry: GridGeometry, visible: Rect, scale: number): boolean {
	const { region } = geometry
	const ratio = scale / geometry.scale
	return ratio <= SCALE_TOLERANCE && ratio >= 1 / SCALE_TOLERANCE && visible.x >= region.x && visible.y >= region.y && visible.x + visible.width <= region.x + region.width && visible.y + visible.height <= region.y + region.height
}
