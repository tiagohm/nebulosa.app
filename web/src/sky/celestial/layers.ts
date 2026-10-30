import { DEG2RAD, PI, PIOVERTWO, TAU } from 'nebulosa/src/core/constants'
import type { Point, Size } from 'nebulosa/src/math/numerical/geometry'
import { clamp } from 'nebulosa/src/math/numerical/math'
import { STAR_COLOR_BUCKETS, STAR_RADIUS_BUCKETS, STAR_STYLE_BUCKETS, type StarCatalog } from './catalog'
import {
	type ProjectedPolylineObserver,
	type ProjectedSampler,
	applyBasePathTransform,
	drawCardinalPoints,
	drawClippedPolyline,
	drawDsoSymbol,
	drawMovingBodySymbol,
	drawObjectHighlight,
	drawSelectedObject,
	drawProjectionBoundary,
	drawZenithLabel,
	DSO_VIEWPORT_MARGIN,
	movingBodyColor,
	positionSkyLabel,
	projectedSegmentLimit,
	projectionCenterX,
	projectionCenterY,
	skyLabelFont,
	skyLabelSize,
	STAR_LABEL_OFFSET_X,
	STAR_LABEL_OFFSET_Y,
	transformedProjectionRadius,
	writeProjectedSample,
} from './drawing'
import { angularDistance, applyViewTransform, isFiniteDiskProjection, isPointInsideViewportMargin, normalizeVector, writeBaseViewportBounds, writeRaDecUnitVector } from './geometry'
import { DEFAULT_STAR_OPTIONS, DEFAULT_THEME, TRANSPARENT } from './options'
import { sameObject } from './picking'
import { meanObliquity } from './time'
import type { CelestialObject, CelestialShape, ConstellationLine, MilkyWayRing, MilkyWayStep, MutableShapeRenderState, RenderState, ResolvedReferenceLineOptions, StarLayerOptions, ThemeOptions } from './types'
import { isDeepSkyLabelVisible, isDeepSkyObjectVisible, isMovingBodyVisible, starLabelMagnitudeLimit, starSymbolMagnitudeLimit } from './visibility'

// Built-in Canvas layers of the star map, drawn back to front by z-index: background, horizon, Milky Way,
// coordinate grid, reference lines, constellations, deep-sky objects, stars, moving bodies, labels, custom
// shapes, and the hover/selection overlay. Layers redraw only when dirty and cache projected geometry in
// base coordinates keyed on the render state's projected geometry revision, so pan and zoom only re-stroke.

// Zoom factor from which star radii grow with zoom; lower enlarges stars sooner.
const STAR_GROWTH_ZOOM = 2.25

// Largest growth factor of star radii while zooming.
const STAR_MAX_RADIUS_SCALE = 3

// Smallest radius in pixels of a star grown with zoom, so the faintest stay visible.
const STAR_GROWN_MIN_RADIUS = 0.75

// Largest radius in pixels of a grown star drawn as a square of the same area instead of a sprite; higher is faster
// until the corners show.
const STAR_SQUARE_MAX_RADIUS = 1.25

// Side of a square per unit of radius of the disc of the same area, √π.
const SQRT_PI = Math.sqrt(Math.PI)

// Minimum screen distance in pixels between star labels; higher reduces overlap but shows fewer labels.
const STAR_LABEL_MIN_SPACING = 36

// Distance in pixels grid boundary labels are moved inward from the projection disk edge.
const GRID_BOUNDARY_LABEL_INSET = 8

// Horizontal padding in pixels of a grid boundary label box.
const GRID_BOUNDARY_LABEL_PADDING_X = 3

// Vertical padding in pixels of a grid boundary label box.
const GRID_BOUNDARY_LABEL_PADDING_Y = 1

// Squared distance in pixels² under which two grid boundary label anchors are considered duplicates.
const GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ = 14 * 14

// Dash pattern in pixels of constellation boundaries.
const CONSTELLATION_BOUNDARY_LINE_DASH = [4, 4] as const

// Zoom factor below which constellation labels are hidden.
export const CONSTELLATION_LABEL_MIN_ZOOM = 0.75

// Drawable of a star sprite.
type CanvasImage = HTMLCanvasElement | OffscreenCanvas

// Cached sprite of one star style bucket.
interface StarStyle {
	// CSS fill color.
	readonly color: string
	// Disc radius in pixels.
	readonly radius: number
	// Pre-rendered disc.
	readonly sprite: CanvasImage
	// Half the sprite size in pixels.
	readonly halfSize: number
	// Disc rendered at the largest growth in device pixels, so growing it only ever scales it down and it stays sharp.
	readonly grownSprite: CanvasImage
	// Half the size of the grown sprite per pixel of radius drawn.
	readonly grownHalfSize: number
}

// Edge where a grid line meets the visible area: the projection disk or a viewport side.
type GridBoundaryEdge = 'circle' | 'left' | 'right' | 'top' | 'bottom'

// Anchor of a grid boundary label in screen pixels.
interface GridBoundaryLabelPoint extends Readonly<Point> {
	// Edge the anchor lies on, which decides how the label is placed.
	readonly edge: GridBoundaryEdge
}

// Grid boundary label waiting to be placed, reused across frames.
type GridBoundaryLabelCandidate = Point & {
	// Edge the anchor lies on.
	edge: GridBoundaryEdge
	// Label text.
	label: string
}

// Screen box occupied by a placed grid boundary label, in pixels.
type GridBoundaryLabelRect = Point & Size

// Grid line cached as base screen vertices.
interface CachedGridLine {
	// Label text (declination in degrees or right ascension in hours).
	readonly label: string
	// Base screen x of each vertex in pixels.
	readonly x: Float32Array
	// Base screen y of each vertex in pixels.
	readonly y: Float32Array
	// 1 when the vertex is a horizon intersection.
	readonly boundary: Uint8Array
	// 1 when the vertex starts a new subpath.
	readonly breakBefore: Uint8Array
}

// Layer with dirty-flag redraw behavior.
export abstract class InternalLayer {
	// Whether the layer is drawn.
	visible = true
	// Whether the layer must be redrawn on the next frame.
	dirty = true

	// Creates a layer with a unique id and a z-index ordering it among layers.
	constructor(
		readonly id: string,
		readonly zIndex: number,
	) {}

	// Marks the layer for redraw.
	markDirty() {
		this.dirty = true
	}

	// Marks the layer clean after redraw.
	markClean() {
		this.dirty = false
	}

	// Draws the layer; the context is saved, clipped to the projection disk, and restored around the call.
	abstract render(ctx: CanvasRenderingContext2D, state: RenderState): void
}

// Solid sky background.
export class BackgroundLayer extends InternalLayer {
	// Creates the background layer.
	constructor() {
		super('background', 0)
	}

	// Fills the canvas with the theme background.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.fillStyle = state.theme.background
		ctx.fillRect(0, 0, state.width, state.height)
	}
}

// Local horizon ring, projection boundary, cardinal points, and zenith.
export class HorizonLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private path = new Path2D()
	private samplerState!: RenderState
	private cachedRevision = -1

	// Samples the horizon at azimuth t × 2π.
	private readonly horizonSampler: ProjectedSampler = (t, out) => this.samplerState.projectHorizontalBaseSample(t * TAU, 0, out)

	// Creates the horizon layer.
	constructor() {
		super('horizon', 10)
	}

	// Draws the projection boundary and labels, and in equatorial views the horizon line and fill below it.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.fillStyle = state.theme.horizon.fillBelowHorizon
		ctx.strokeStyle = state.theme.horizon.color
		ctx.lineWidth = 0.9

		if (isFiniteDiskProjection(state.projection)) {
			drawProjectionBoundary(ctx, state)
		}

		if (state.coordinateSystem === 'horizontal') {
			drawCardinalPoints(ctx, state)
			drawZenithLabel(ctx, state)
			return
		}

		this.ensurePath(state)
		ctx.save()
		applyBasePathTransform(ctx, state)
		ctx.lineWidth = 0.9 / state.transform.k

		if (state.theme.horizon.fillBelowHorizon !== TRANSPARENT) {
			ctx.fill(this.path)
		}

		ctx.stroke(this.path)
		ctx.restore()
		drawCardinalPoints(ctx, state)
		drawZenithLabel(ctx, state)
	}

	// Rebuilds the cached horizon path when projected geometry changed.
	private ensurePath(state: RenderState) {
		if (this.cachedRevision === state.projectedGeometryRevision) return

		this.samplerState = state
		this.path = new Path2D()
		drawClippedPolyline(this.path, state, 288, this.point, this.previous, this.horizonSampler)
		this.cachedRevision = state.projectedGeometryRevision
	}
}

// Returns whether the whole projection disk is inside the viewport, so grid labels sit on the disk edge.
function projectionBoundaryFullyVisibleInViewport(state: RenderState) {
	if (!isFiniteDiskProjection(state.projection)) return false

	const cx = projectionCenterX(state)
	const cy = projectionCenterY(state)
	const radius = transformedProjectionRadius(state)

	if (radius <= 0) return false

	return cx - radius >= 0 && cx + radius <= state.width && cy - radius >= 0 && cy + radius <= state.height
}

// Adds a label anchor unless another anchor lies within the dedupe distance.
function appendUniqueGridBoundaryLabelPoint(points: GridBoundaryLabelPoint[], point: GridBoundaryLabelPoint) {
	for (let i = 0; i < points.length; i++) {
		const dx = points[i].x - point.x
		const dy = points[i].y - point.y

		if (dx * dx + dy * dy <= GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ) return
	}

	points.push(point)
}

// Adds a label anchor moved inward from a disk-edge point (pixels) toward the projection center.
function appendCircleGridBoundaryLabelPoint(points: GridBoundaryLabelPoint[], state: RenderState, x: number, y: number) {
	const cx = projectionCenterX(state)
	const cy = projectionCenterY(state)
	const dx = cx - x
	const dy = cy - y
	const length = Math.hypot(dx, dy)

	if (length <= 1e-9) return

	const labelX = x + (dx / length) * GRID_BOUNDARY_LABEL_INSET
	const labelY = y + (dy / length) * GRID_BOUNDARY_LABEL_INSET

	if (labelX < 0 || labelX > state.width || labelY < 0 || labelY > state.height) return

	appendUniqueGridBoundaryLabelPoint(points, { x: labelX, y: labelY, edge: 'circle' })
}

// Adds label anchors where the screen segment (x0, y0)-(x1, y1) crosses the viewport sides.
function appendViewportGridBoundaryIntersection(points: GridBoundaryLabelPoint[], state: RenderState, x0: number, y0: number, x1: number, y1: number) {
	const dx = x1 - x0
	const dy = y1 - y0
	const epsilon = 1e-7

	// Adds the crossing at segment parameter t when it lies on the segment and inside the viewport.
	function append(t: number, edge: GridBoundaryEdge) {
		if (t < -epsilon || t > 1 + epsilon) return

		const x = x0 + dx * t
		const y = y0 + dy * t

		if (x < -epsilon || x > state.width + epsilon || y < -epsilon || y > state.height + epsilon) return

		appendUniqueGridBoundaryLabelPoint(points, { x: clamp(x, 0, state.width), y: clamp(y, 0, state.height), edge })
	}

	if (Math.abs(dx) > epsilon) {
		append((0 - x0) / dx, 'left')
		append((state.width - x0) / dx, 'right')
	}

	if (Math.abs(dy) > epsilon) {
		append((0 - y0) / dy, 'top')
		append((state.height - y0) / dy, 'bottom')
	}
}

// Returns whether two label boxes overlap.
function gridBoundaryLabelRectIntersects(a: GridBoundaryLabelRect, b: GridBoundaryLabelRect) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

// Draws a boxed grid label at an anchor unless it overlaps one of the first `occupiedCount` boxes; reuses
// `occupied` entries and returns the new occupied count.
function drawGridBoundaryLabel(ctx: CanvasRenderingContext2D, state: RenderState, label: string, point: GridBoundaryLabelPoint, occupied: GridBoundaryLabelRect[], occupiedCount: number) {
	const fontSize = skyLabelSize(state, 9)
	const metrics = ctx.measureText(label)
	const width = Math.ceil(metrics.width) + GRID_BOUNDARY_LABEL_PADDING_X * 2
	const height = Math.ceil(fontSize) + GRID_BOUNDARY_LABEL_PADDING_Y * 2
	let x = point.x
	let y = point.y

	switch (point.edge) {
		case 'left':
			x = width / 2 + 2
			break
		case 'right':
			x = state.width - width / 2 - 2
			break
		case 'top':
			y = height / 2 + 2
			break
		case 'bottom':
			y = state.height - height / 2 - 2
			break
	}

	x = clamp(x, width / 2 + 1, state.width - width / 2 - 1)
	y = clamp(y, height / 2 + 1, state.height - height / 2 - 1)

	let rect = occupied[occupiedCount]

	if (!rect) {
		rect = { x: 0, y: 0, width: 0, height: 0 }
		occupied[occupiedCount] = rect
	}

	rect.x = x - width / 2
	rect.y = y - height / 2
	rect.width = width
	rect.height = height

	for (let i = 0; i < occupiedCount; i++) {
		if (gridBoundaryLabelRectIntersects(rect, occupied[i])) {
			return occupiedCount
		}
	}

	ctx.fillStyle = 'rgba(0, 0, 0, 0.68)'
	ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
	ctx.fillStyle = state.theme.grid.color
	ctx.fillText(label, x, y)
	return occupiedCount + 1
}

// Equatorial grid every 10° of declination and 1 h of right ascension, labeled where lines leave the view.
export class GridLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private readonly labelPoints: GridBoundaryLabelPoint[] = []
	private readonly labelCandidates: GridBoundaryLabelCandidate[] = []
	private readonly labelRects: GridBoundaryLabelRect[] = []
	private readonly cachedLines: CachedGridLine[] = []
	private readonly buildX: number[] = []
	private readonly buildY: number[] = []
	private readonly buildBoundary: number[] = []
	private readonly buildBreakBefore: number[] = []
	private path = new Path2D()
	private samplerState!: RenderState
	// Fixed coordinate of the line being sampled in radians: declination for parallels, RA for meridians.
	private samplerAngle = 0
	private cachedRevision = -1
	private labelCandidateCount = 0
	private buildStartsSubpath = true

	// Samples a declination parallel at right ascension t × 2π.
	private readonly raSampler: ProjectedSampler = (t, out) => {
		const ra = t * TAU
		return this.samplerState.projectEquatorialBaseSample(ra, this.samplerAngle, out)
	}

	// Samples a right ascension meridian at declination −π/2 + t × π.
	private readonly decSampler: ProjectedSampler = (t, out) => {
		const dec = -PIOVERTWO + t * PI
		return this.samplerState.projectEquatorialBaseSample(this.samplerAngle, dec, out)
	}

	// Collects the emitted vertices of the line being cached.
	private readonly cacheObserver: ProjectedPolylineObserver = {
		reset: () => {
			this.buildX.length = 0
			this.buildY.length = 0
			this.buildBoundary.length = 0
			this.buildBreakBefore.length = 0
			this.buildStartsSubpath = true
		},
		append: (x, y, boundaryPoint) => {
			this.buildX.push(x)
			this.buildY.push(y)
			this.buildBoundary.push(boundaryPoint ? 1 : 0)
			this.buildBreakBefore.push(this.buildStartsSubpath ? 1 : 0)
			this.buildStartsSubpath = false
		},
		break: () => {
			this.buildStartsSubpath = true
		},
	}

	// Creates the grid layer.
	constructor() {
		super('grid', 20)
	}

	// Strokes the cached grid path and draws boundary labels derived from its base vertices.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		this.ensureCache(state)
		ctx.save()
		ctx.strokeStyle = state.theme.grid.color
		ctx.globalAlpha = state.theme.grid.opacity
		applyBasePathTransform(ctx, state)
		ctx.lineWidth = 0.65 / state.transform.k
		ctx.stroke(this.path)
		ctx.restore()
		this.collectLabelCandidates(state)
		this.renderGridLabels(ctx, state)
	}

	// Rebuilds the cached grid path and vertices when projected geometry changed.
	private ensureCache(state: RenderState) {
		if (this.cachedRevision === state.projectedGeometryRevision) return

		this.samplerState = state
		this.path = new Path2D()
		this.cachedLines.length = 0

		for (let decDeg = -85; decDeg <= 85; decDeg += 10) {
			this.samplerAngle = decDeg * DEG2RAD
			this.cacheGridLine(state, 360, this.raSampler, decDeg.toFixed(0))
		}

		for (let raHour = 0; raHour < 24; raHour += 1) {
			this.samplerAngle = (raHour / 24) * TAU
			this.cacheGridLine(state, 240, this.decSampler, `${raHour}h`)
		}

		this.cachedRevision = state.projectedGeometryRevision
	}

	// Appends one sampled grid line to the path and caches its vertices with a label.
	private cacheGridLine(state: RenderState, steps: number, sampler: ProjectedSampler, label: string) {
		drawClippedPolyline(this.path, state, steps, this.point, this.previous, sampler, this.cacheObserver)
		this.cachedLines.push({
			label,
			x: Float32Array.from(this.buildX),
			y: Float32Array.from(this.buildY),
			boundary: Uint8Array.from(this.buildBoundary),
			breakBefore: Uint8Array.from(this.buildBreakBefore),
		})
	}

	// Finds where each cached line meets the projection disk edge or the viewport sides.
	private collectLabelCandidates(state: RenderState) {
		const useViewportBoundary = !projectionBoundaryFullyVisibleInViewport(state)
		this.labelCandidateCount = 0

		for (let lineIndex = 0; lineIndex < this.cachedLines.length; lineIndex++) {
			const line = this.cachedLines[lineIndex]
			this.labelPoints.length = 0
			let previousVisible = false
			let previousX = 0
			let previousY = 0

			for (let i = 0; i < line.x.length; i++) {
				if (line.breakBefore[i]) {
					previousVisible = false
				}

				applyViewTransform(line.x[i], line.y[i], state.width, state.height, state.transform, this.point)
				const x = this.point[0]
				const y = this.point[1]

				if (line.boundary[i]) {
					appendCircleGridBoundaryLabelPoint(this.labelPoints, state, x, y)
				}

				if (useViewportBoundary && previousVisible) {
					appendViewportGridBoundaryIntersection(this.labelPoints, state, previousX, previousY, x, y)
				}

				previousVisible = true
				previousX = x
				previousY = y
			}

			this.appendLabelCandidates(line.label)
		}
	}

	// Turns the current line's anchors into reusable label candidates.
	private appendLabelCandidates(label: string) {
		for (let i = 0; i < this.labelPoints.length; i++) {
			const point = this.labelPoints[i]
			let candidate = this.labelCandidates[this.labelCandidateCount]

			if (!candidate) {
				candidate = { x: 0, y: 0, edge: point.edge, label }
				this.labelCandidates[this.labelCandidateCount] = candidate
			}

			candidate.x = point.x
			candidate.y = point.y
			candidate.edge = point.edge
			candidate.label = label
			this.labelCandidateCount++
		}
	}

	// Draws the label candidates that do not overlap earlier ones.
	private renderGridLabels(ctx: CanvasRenderingContext2D, state: RenderState) {
		let labelRectCount = 0

		ctx.globalAlpha = Math.min(0.95, Math.max(0.58, state.theme.grid.opacity + 0.28))
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'

		for (let i = 0; i < this.labelCandidateCount; i++) {
			const candidate = this.labelCandidates[i]
			labelRectCount = drawGridBoundaryLabel(ctx, state, candidate.label, candidate, this.labelRects, labelRectCount)
		}

		this.labelRects.length = labelRectCount
	}
}

// Local meridian, celestial equator, and ecliptic of date.
export class ReferenceLineLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private localMeridianPath = new Path2D()
	private celestialEquatorPath = new Path2D()
	private eclipticPath = new Path2D()
	private samplerState!: RenderState
	// Azimuth in radians of the meridian half being sampled (0 north, π south).
	private localMeridianAz = 0
	// Whether the meridian half is sampled from the zenith down.
	private localMeridianReverse = false
	private eclipticCosObliquity = 1
	private eclipticSinObliquity = 0
	private cachedRevision = -1
	private cachedSegmentLimit = Number.NaN

	// Samples a meridian half at altitude t × π/2 (or reversed).
	private readonly localMeridianSampler: ProjectedSampler = (t, out) => {
		const alt = (this.localMeridianReverse ? 1 - t : t) * PIOVERTWO
		return this.samplerState.projectHorizontalBaseSample(this.localMeridianAz, alt, out)
	}

	// Samples the celestial equator at right ascension t × 2π.
	private readonly celestialEquatorSampler: ProjectedSampler = (t, out) => {
		const ra = t * TAU
		return this.samplerState.projectEquatorialBaseSample(ra, 0, out)
	}

	// Samples the ecliptic at ecliptic longitude t × 2π.
	private readonly eclipticSampler: ProjectedSampler = (t, out) => {
		const lambda = t * TAU
		const sinLambda = Math.sin(lambda)
		return this.samplerState.projectEquatorialVectorBaseSample(Math.cos(lambda), sinLambda * this.eclipticCosObliquity, sinLambda * this.eclipticSinObliquity, out)
	}

	// Creates the reference line layer.
	constructor() {
		super('referenceLines', 25)
	}

	// Strokes the enabled reference lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		this.ensurePaths(state)
		ctx.globalAlpha = 0.7
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		applyBasePathTransform(ctx, state)
		this.drawLine(ctx, state.referenceLines.localMeridian, this.localMeridianPath, state.transform.k)
		this.drawLine(ctx, state.referenceLines.celestialEquator, this.celestialEquatorPath, state.transform.k)
		this.drawLine(ctx, state.referenceLines.ecliptic, this.eclipticPath, state.transform.k)
	}

	// Rebuilds the cached paths when projected geometry or the zoom-dependent segment limit changed.
	private ensurePaths(state: RenderState) {
		const segmentLimit = projectedSegmentLimit(state) / state.transform.k

		if (this.cachedRevision === state.projectedGeometryRevision && this.cachedSegmentLimit === segmentLimit) return

		this.samplerState = state
		this.localMeridianPath = new Path2D()
		this.localMeridianAz = 0
		this.localMeridianReverse = false
		drawClippedPolyline(this.localMeridianPath, state, 120, this.point, this.previous, this.localMeridianSampler, undefined, segmentLimit)
		this.localMeridianAz = PI
		this.localMeridianReverse = true
		drawClippedPolyline(this.localMeridianPath, state, 120, this.point, this.previous, this.localMeridianSampler, undefined, segmentLimit)

		this.celestialEquatorPath = new Path2D()
		drawClippedPolyline(this.celestialEquatorPath, state, 360, this.point, this.previous, this.celestialEquatorSampler, undefined, segmentLimit)

		const obliquity = meanObliquity(state.time)
		this.eclipticCosObliquity = Math.cos(obliquity)
		this.eclipticSinObliquity = Math.sin(obliquity)
		this.eclipticPath = new Path2D()
		drawClippedPolyline(this.eclipticPath, state, 360, this.point, this.previous, this.eclipticSampler, undefined, segmentLimit)
		this.cachedRevision = state.projectedGeometryRevision
		this.cachedSegmentLimit = segmentLimit
	}

	// Strokes one cached path with its style when enabled, compensating the line width for zoom `scale`.
	private drawLine(ctx: CanvasRenderingContext2D, style: ResolvedReferenceLineOptions, path: Path2D, scale: number) {
		if (!style.enabled) return

		ctx.strokeStyle = style.color
		ctx.lineWidth = style.lineWidth / scale
		ctx.stroke(path)
	}
}

// Shared renderer of constellation polylines, drawn as great-circle arcs.
abstract class ConstellationSegmentLayer extends InternalLayer {
	private readonly fromVector = new Float32Array(3)
	private readonly toVector = new Float32Array(3)
	private readonly sampleVector = new Float32Array(3)
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private path = new Path2D()
	private cachedLines: readonly ConstellationLine[] | null = null
	private cachedRevision = -1
	private samplerState!: RenderState

	// Samples the arc between the current segment endpoints at parameter t.
	private readonly segmentSampler: ProjectedSampler = (t, out) => {
		const u = 1 - t

		this.sampleVector[0] = this.fromVector[0] * u + this.toVector[0] * t
		this.sampleVector[1] = this.fromVector[1] * u + this.toVector[1] * t
		this.sampleVector[2] = this.fromVector[2] * u + this.toVector[2] * t

		if (!normalizeVector(this.sampleVector)) {
			return writeProjectedSample(out, Number.NaN, false)
		}

		return this.samplerState.projectEquatorialVectorBaseSample(this.sampleVector[0], this.sampleVector[1], this.sampleVector[2], out)
	}

	// Strokes the polylines with a color, opacity in [0, 1], and line width in pixels, rebuilding the cached
	// path when the lines or projected geometry changed.
	protected drawSegments(ctx: CanvasRenderingContext2D, state: RenderState, lines: readonly ConstellationLine[], color: string, alpha: number, lineWidth: number) {
		this.samplerState = state

		if (this.cachedRevision !== state.projectedGeometryRevision || this.cachedLines !== lines) {
			this.path = new Path2D()

			for (const line of lines) {
				for (let j = 1, k = 0; j < line.length; j++, k++) {
					this.drawSegment(this.path, state, line[k], line[j])
				}
			}

			this.cachedLines = lines
			this.cachedRevision = state.projectedGeometryRevision
		}

		ctx.strokeStyle = color
		ctx.globalAlpha = alpha
		applyBasePathTransform(ctx, state)
		ctx.lineWidth = lineWidth / state.transform.k
		ctx.stroke(this.path)
	}

	// Appends the arc between two vertices, sampled about once per degree (8 to 180 steps).
	private drawSegment(path: Path2D, state: RenderState, from: ConstellationLine[number], to: ConstellationLine[number]) {
		writeRaDecUnitVector(from[0], from[1], this.fromVector)
		writeRaDecUnitVector(to[0], to[1], this.toVector)

		const distance = angularDistance(this.fromVector[0], this.fromVector[1], this.fromVector[2], this.toVector[0], this.toVector[1], this.toVector[2])
		const steps = Math.max(8, Math.min(180, Math.ceil(distance / DEG2RAD)))

		drawClippedPolyline(path, state, steps, this.point, this.previous, this.segmentSampler)
	}
}

// Constellation stick figures.
export class ConstellationLineLayer extends ConstellationSegmentLayer {
	// Creates the constellation line layer.
	constructor() {
		super('constellations', 30)
	}

	// Strokes the constellation lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const theme = state.theme.constellations
		const color = theme.lineColor || theme.color
		const opacity = theme.lineOpacity ?? theme.opacity
		this.drawSegments(ctx, state, state.constellations.lines ?? [], color, opacity, 0.9)
	}
}

// Dashed constellation boundaries.
export class ConstellationBoundaryLayer extends ConstellationSegmentLayer {
	// Dash pattern in base pixels, compensated for zoom.
	private readonly scaledLineDash = [0, 0]

	// Creates the constellation boundary layer.
	constructor() {
		super('constellationBoundaries', 32)
	}

	// Strokes the constellation boundaries as dashed lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const inverseScale = 1 / state.transform.k
		this.scaledLineDash[0] = CONSTELLATION_BOUNDARY_LINE_DASH[0] * inverseScale
		this.scaledLineDash[1] = CONSTELLATION_BOUNDARY_LINE_DASH[1] * inverseScale
		ctx.setLineDash(this.scaledLineDash)
		const theme = state.theme.constellations
		const color = theme.boundaryColor || theme.color
		const opacity = theme.boundaryOpacity ?? theme.opacity
		this.drawSegments(ctx, state, state.constellations.boundaries ?? [], color, opacity, 0.6)
	}
}

// Returns the number of segments of a Milky Way ring.
function milkyWayRingSegmentCount(ring: MilkyWayRing) {
	return ring.closed ? ring.pointCount : ring.pointCount - 1
}

// Returns the outline color of a Milky Way level.
function milkyWayLevelColor(theme: ThemeOptions['milkyWay'], index: number) {
	return theme.levelColors?.[index] ?? theme.lineColor
}

// Returns the outline opacity in [0, 1] of a Milky Way level.
function milkyWayLevelOpacity(theme: ThemeOptions['milkyWay'], index: number) {
	return theme.levelOpacities?.[index] ?? 1
}

// Milky Way outlines from d3-celestial mw.json MultiPolygon coordinates, one path per brightness level.
export class MilkyWayLayer extends InternalLayer {
	private readonly sampleVector = new Float32Array(3)
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private readonly paths: Path2D[] = []
	private cachedSteps: readonly Readonly<MilkyWayStep>[] | null = null
	private cachedRevision = -1
	private samplerState!: RenderState
	private samplerRing!: MilkyWayRing

	// Samples the current ring at parameter t along its segments.
	private readonly ringSampler: ProjectedSampler = (t, out) => {
		const ring = this.samplerRing
		const segmentCount = milkyWayRingSegmentCount(ring)

		if (segmentCount <= 0) {
			return writeProjectedSample(out, Number.NaN, false)
		}

		const segment = t * segmentCount
		const index = Math.min(segmentCount - 1, Math.floor(segment))
		const nextIndex = index + 1 === ring.pointCount ? 0 : index + 1
		const localT = segment - index
		const u = 1 - localT
		const fromOffset = index * 3
		const toOffset = nextIndex * 3

		this.sampleVector[0] = ring.vectors[fromOffset] * u + ring.vectors[toOffset] * localT
		this.sampleVector[1] = ring.vectors[fromOffset + 1] * u + ring.vectors[toOffset + 1] * localT
		this.sampleVector[2] = ring.vectors[fromOffset + 2] * u + ring.vectors[toOffset + 2] * localT

		if (!normalizeVector(this.sampleVector)) {
			return writeProjectedSample(out, Number.NaN, false)
		}

		return this.samplerState.projectEquatorialVectorBaseSample(this.sampleVector[0], this.sampleVector[1], this.sampleVector[2], out)
	}

	// Creates the Milky Way layer.
	constructor() {
		super('milkyWay', 15)
	}

	// Strokes each Milky Way level with a non-zero opacity.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const steps = state.milkyWay

		if (steps.length === 0) return

		const theme = state.theme.milkyWay
		const lineOpacity = clamp(theme.lineOpacity, 0, 1)

		if (lineOpacity <= 0 || theme.lineWidth <= 0) return

		this.samplerState = state
		this.ensurePaths(state, steps)
		applyBasePathTransform(ctx, state)
		ctx.lineWidth = theme.lineWidth / state.transform.k
		ctx.lineJoin = 'round'
		ctx.lineCap = 'round'

		for (let i = 0; i < steps.length; i++) {
			const lineOpacityPerLevel = milkyWayLevelOpacity(theme, i)

			if (lineOpacityPerLevel <= 0) continue

			ctx.strokeStyle = milkyWayLevelColor(theme, i)
			ctx.globalAlpha = lineOpacity * lineOpacityPerLevel
			ctx.stroke(this.paths[i])
		}
	}

	// Rebuilds the cached level paths when the data or projected geometry changed.
	private ensurePaths(state: RenderState, steps: readonly Readonly<MilkyWayStep>[]) {
		if (this.cachedRevision === state.projectedGeometryRevision && this.cachedSteps === steps) return

		this.paths.length = steps.length

		for (let i = 0; i < steps.length; i++) {
			const path = new Path2D()
			const rings = steps[i].rings

			for (let j = 0; j < rings.length; j++) {
				this.samplerRing = rings[j]
				drawClippedPolyline(path, state, Math.max(16, milkyWayRingSegmentCount(rings[j])), this.point, this.previous, this.ringSampler)
			}

			this.paths[i] = path
		}

		this.cachedSteps = steps
		this.cachedRevision = state.projectedGeometryRevision
	}
}

// Deep-sky object symbols and labels.
export class DeepSkyObjectLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	// Creates the deep-sky layer.
	constructor() {
		super('deepSky', 40)
	}

	// Draws the projected objects visible at the current zoom and their labels.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const catalog = state.deepSkyCatalog
		if (!catalog) return

		ctx.strokeStyle = state.theme.deepSky.color
		ctx.fillStyle = state.theme.deepSky.color
		ctx.lineWidth = 1
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'
		catalog.beginLabelRender()

		for (let i = 0; i < catalog.visibleCount; i++) {
			const index = catalog.visibleIndices[i]
			const object = catalog.objects[index]

			if (!isDeepSkyObjectVisible(object, state)) {
				continue
			}

			applyViewTransform(catalog.screenX[index], catalog.screenY[index], state.width, state.height, state.transform, this.point)

			if (!isPointInsideViewportMargin(this.point[0], this.point[1], state.width, state.height, DSO_VIEWPORT_MARGIN)) {
				continue
			}

			drawDsoSymbol(ctx, object.type, this.point[0], this.point[1], 4)

			if (object.name && isDeepSkyLabelVisible(object, state)) {
				ctx.fillStyle = state.theme.deepSky.labelColor

				if (positionSkyLabel(ctx, state, object.name, this.point[0], this.point[1], 10, -2, this.labelPoint)) {
					ctx.fillText(object.name, this.labelPoint[0], this.labelPoint[1])
					catalog.recordLabelVisible(index)
				}

				ctx.fillStyle = state.theme.deepSky.color
			}
		}
	}
}

// Creates a canvas for sprite caches, preferring OffscreenCanvas.
function createScratchCanvas(width: number, height: number): CanvasImage {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height)
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	return canvas
}

// Converts a B-V color index in magnitudes ([-0.4, 2.0] spans blue to red) into a coarse CSS star color.
function bvToColor(bv: number) {
	const t = clamp((bv + 0.4) / 2.4, 0, 1)
	const r = Math.round(155 + 100 * t)
	const g = Math.round(185 + 55 * (1 - Math.abs(t - 0.55)))
	const b = Math.round(255 - 135 * t)
	return `rgb(${r}, ${g}, ${b})`
}

// Builds one sprite style per star style bucket, ordered as StarCatalog style buckets.
function buildStarStyles(theme: ThemeOptions, starOptions: Required<StarLayerOptions>, dpr: number): StarStyle[] {
	const styles: StarStyle[] = []

	for (let colorBucket = 0; colorBucket < STAR_COLOR_BUCKETS; colorBucket++) {
		const color = starOptions.colorByBV ? bvToColor(-0.4 + (colorBucket / (STAR_COLOR_BUCKETS - 1)) * 2.4) : theme.stars.baseColor

		for (let radiusBucket = 0; radiusBucket < STAR_RADIUS_BUCKETS; radiusBucket++) {
			const radius = theme.stars.minRadius + (radiusBucket / (STAR_RADIUS_BUCKETS - 1)) * (theme.stars.maxRadius - theme.stars.minRadius)
			styles.push(createStarStyle(color, radius, dpr))
		}
	}

	return styles
}

// Returns a square sprite holding a disc of `radius` pixels, and its size in pixels.
function createDiscSprite(color: string, radius: number) {
	const size = Math.max(3, Math.ceil(radius * 2 + 2))
	const sprite = createScratchCanvas(size, size)
	const ctx = sprite.getContext('2d')

	if (ctx) {
		ctx.clearRect(0, 0, size, size)
		ctx.fillStyle = color
		ctx.beginPath()
		ctx.arc(size / 2, size / 2, radius, 0, TAU)
		ctx.fill()
	}

	return { sprite, size }
}

// Renders the sprites of a star disc of `radius` pixels for a device pixel ratio.
function createStarStyle(color: string, radius: number, dpr: number): StarStyle {
	const { sprite, size } = createDiscSprite(color, radius)
	const grownRadius = radius * STAR_MAX_RADIUS_SCALE * dpr
	const grown = createDiscSprite(color, grownRadius)
	return { color, radius, sprite, halfSize: size / 2, grownSprite: grown.sprite, grownHalfSize: grown.size / (2 * grownRadius) }
}

// Star symbols and labels, drawn per style bucket as cached sprites, which grow when zoomed in. Sprites replaced vector
// circles because a GPU-backed canvas rasterizes thousands of arcs two to three times slower than it draws the same
// discs as images (measured at 2 to 8 times the base zoom), which is what stalls a zoom gesture on a deep catalog.
export class StarLayer extends InternalLayer {
	private styles = buildStarStyles(DEFAULT_THEME, DEFAULT_STAR_OPTIONS, 1)
	// Theme and option values the styles were built from.
	private styleSignature = ''
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)
	private readonly baseViewportBounds = new Float64Array(4)
	private labelIndices = new Int32Array(0)
	private labelX = new Float32Array(0)
	private labelY = new Float32Array(0)

	// Creates the star layer.
	constructor() {
		super('stars', 50)
	}

	// Draws the projected stars visible at the current zoom, then their labels.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const catalog = state.starCatalog

		if (!catalog) return

		this.ensureStyles(state)

		this.renderStars(ctx, state, catalog)
		this.renderStarLabels(ctx, state, catalog)
	}

	// Draws stars in base coordinates as cached sprites, or single pixels for the smallest radii of an ungrown view.
	// Radii grow with the square root of the zoom from STAR_GROWTH_ZOOM on.
	private renderStars(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		const { transform, width, height } = state
		const maxMagnitude = starSymbolMagnitudeLimit(state)
		const inverseScale = 1 / transform.k
		const grown = transform.k >= STAR_GROWTH_ZOOM
		const radiusScale = Math.min(Math.sqrt(transform.k), STAR_MAX_RADIUS_SCALE)

		ctx.save()
		applyBasePathTransform(ctx, state)

		const indices = catalog.getBucketedVisibleIndices()

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			const start = catalog.getBucketStart(bucket)
			const end = catalog.getBucketEnd(bucket)

			if (end <= start) {
				continue
			}

			const style = this.styles[bucket]
			const radius = grown ? Math.max(STAR_GROWN_MIN_RADIUS, style.radius * radiusScale) : style.radius
			const screenHalfSize = grown ? style.grownHalfSize * radius : style.halfSize
			const margin = Math.max(2, screenHalfSize + 2)
			writeBaseViewportBounds(width, height, transform, margin, this.baseViewportBounds)

			if (radius <= (grown ? STAR_SQUARE_MAX_RADIUS : 0.8)) {
				// A disc this small reads the same as an antialiased square of its area, which is far cheaper to fill.
				const side = (grown ? radius * SQRT_PI : 1) * inverseScale
				const offset = grown ? side / 2 : 0
				ctx.fillStyle = style.color

				for (let i = start; i < end; i++) {
					const index = indices[i]

					if (catalog.mag[index] > maxMagnitude) {
						continue
					}

					const x = catalog.screenX[index]
					const y = catalog.screenY[index]

					if (x < this.baseViewportBounds[0] || x > this.baseViewportBounds[1] || y < this.baseViewportBounds[2] || y > this.baseViewportBounds[3]) {
						continue
					}

					ctx.fillRect(x - offset, y - offset, side, side)
				}
			} else {
				const sprite = grown ? style.grownSprite : style.sprite
				const halfSize = screenHalfSize * inverseScale
				const spriteSize = 2 * halfSize

				for (let i = start; i < end; i++) {
					const index = indices[i]

					if (catalog.mag[index] > maxMagnitude) {
						continue
					}

					const x = catalog.screenX[index]
					const y = catalog.screenY[index]

					if (x < this.baseViewportBounds[0] || x > this.baseViewportBounds[1] || y < this.baseViewportBounds[2] || y > this.baseViewportBounds[3]) {
						continue
					}

					ctx.drawImage(sprite, x - halfSize, y - halfSize, spriteSize, spriteSize)
				}
			}
		}

		ctx.restore()
	}

	// Labels bright enough named stars in the viewport, skipping labels too close to drawn ones.
	private renderStarLabels(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		catalog.beginLabelRender()

		if (!state.stars.labels || !catalog.namedIndices || catalog.namedIndices.length === 0) return

		const maxMagnitude = starLabelMagnitudeLimit(state)
		let labelCount = 0
		this.ensureLabelCapacity(catalog.namedIndices.length)
		writeBaseViewportBounds(state.width, state.height, state.transform, 0, this.baseViewportBounds)

		for (let i = 0; i < catalog.namedIndices.length; i++) {
			const index = catalog.namedIndices[i]
			const magnitude = catalog.mag[index]

			if (!catalog.visible[index] || magnitude > maxMagnitude) {
				continue
			}

			const x = catalog.screenX[index]
			const y = catalog.screenY[index]

			if (x < this.baseViewportBounds[0] || x > this.baseViewportBounds[1] || y < this.baseViewportBounds[2] || y > this.baseViewportBounds[3]) {
				continue
			}

			applyViewTransform(x, y, state.width, state.height, state.transform, this.point)
			this.labelIndices[labelCount] = index
			this.labelX[labelCount] = this.point[0]
			this.labelY[labelCount] = this.point[1]
			labelCount++
		}

		if (labelCount === 0) return

		ctx.fillStyle = state.theme.stars.labelColor
		ctx.font = state.theme.stars.labelFont
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		let drawn = 0

		for (let i = 0; i < labelCount; i++) {
			const index = this.labelIndices[i]
			const name = catalog.names[index]

			if (!name || !positionSkyLabel(ctx, state, name, this.labelX[i], this.labelY[i], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) {
				continue
			}

			const x = this.labelPoint[0]
			const y = this.labelPoint[1]

			if (this.hasNearbyLabel(drawn, x, y)) {
				continue
			}

			this.labelX[drawn] = x
			this.labelY[drawn] = y
			drawn++
			ctx.fillText(name, x, y)
			catalog.recordLabelVisible(index)
		}
	}

	// Grows the label scratch arrays to at least `capacity` entries.
	private ensureLabelCapacity(capacity: number) {
		if (this.labelIndices.length >= capacity) return

		this.labelIndices = new Int32Array(capacity)
		this.labelX = new Float32Array(capacity)
		this.labelY = new Float32Array(capacity)
	}

	// Returns whether one of the first `drawn` labels lies closer than the minimum spacing to (x, y).
	private hasNearbyLabel(drawn: number, x: number, y: number) {
		const minDistanceSquared = STAR_LABEL_MIN_SPACING * STAR_LABEL_MIN_SPACING

		for (let i = 0; i < drawn; i++) {
			const dx = this.labelX[i] - x
			const dy = this.labelY[i] - y

			if (dx * dx + dy * dy < minDistanceSquared) {
				return true
			}
		}

		return false
	}

	// Rebuilds the sprite styles when the theme or star options they depend on changed.
	private ensureStyles(state: RenderState) {
		const signature = `${state.stars.colorByBV}|${state.theme.stars.baseColor}|${state.theme.stars.minRadius}|${state.theme.stars.maxRadius}|${state.dpr}`

		if (signature === this.styleSignature) return

		this.styles = buildStarStyles(state.theme, state.stars, state.dpr)
		this.styleSignature = signature
	}
}

// Planet, asteroid, and comet symbols and labels.
export class MovingBodyLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	// Creates the moving body layer.
	constructor() {
		super('movingBodies', 60)
	}

	// Draws the visible moving bodies and their labels.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		for (let i = 0; i < state.movingBodies.length; i++) {
			const object = state.movingBodies[i]

			if (!isMovingBodyVisible(object, state)) {
				continue
			}

			if (!state.projectEquatorialToScreen(object.position.rightAscension, object.position.declination, this.point)) {
				continue
			}

			const color = movingBodyColor(object, state)
			ctx.strokeStyle = color
			ctx.fillStyle = color
			ctx.lineWidth = 1
			drawMovingBodySymbol(ctx, object.type, this.point[0], this.point[1])

			const label = object.name ?? object.type
			ctx.fillStyle = state.theme.movingBodies.labelColor

			if (positionSkyLabel(ctx, state, label, this.point[0], this.point[1], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) {
				ctx.fillText(label, this.labelPoint[0], this.labelPoint[1])
			}
		}
	}
}

// Constellation names.
export class ConstellationLabelLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	// Creates the constellation label layer.
	constructor() {
		super('constellationLabels', 70)
	}

	// Draws the constellation labels above the minimum zoom.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		if (state.transform.k < CONSTELLATION_LABEL_MIN_ZOOM) return

		const theme = state.theme.constellations
		const labels = state.constellations.labels ?? []
		ctx.fillStyle = theme.labelColor || theme.color
		ctx.globalAlpha = theme.labelOpacity ?? theme.opacity
		ctx.font = theme.labelFont
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'

		for (let i = 0; i < labels.length; i++) {
			const label = labels[i]

			if (state.projectEquatorialToScreen(label.rightAscension, label.declination, this.point)) {
				ctx.fillText(label.name, this.point[0], this.point[1])
			}
		}

		ctx.globalAlpha = 1
	}
}

// Caller-drawn shapes anchored at equatorial coordinates.
export class ShapeLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	// State passed to shape renderers, filled before each call.
	private readonly shapeState: MutableShapeRenderState = {
		id: '',
		x: 0,
		y: 0,
		coordinate: { rightAscension: 0, declination: 0 },
		shape: undefined as unknown as Readonly<CelestialShape>,
		state: undefined as unknown as RenderState,
	}

	// Creates the shape layer.
	constructor() {
		super('shapes', 75)
	}

	// Calls each visible, projectable shape's renderer inside a saved context.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		for (let i = 0; i < state.shapes.length; i++) {
			const shape = state.shapes[i]

			if (shape.visible === false || !state.projectEquatorialToScreen(shape.coordinate.rightAscension, shape.coordinate.declination, this.point)) {
				continue
			}

			ctx.save()
			this.shapeState.id = shape.id
			this.shapeState.x = this.point[0]
			this.shapeState.y = this.point[1]
			this.shapeState.coordinate = shape.coordinate
			this.shapeState.shape = shape
			this.shapeState.state = state
			shape.render(state.celestial, ctx, this.shapeState)
			ctx.restore()
		}
	}
}

// Hover and selection rings, plus labels of highlighted objects whose label was not drawn.
export class InteractionOverlayLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	// Creates the overlay layer.
	constructor() {
		super('overlay', 80)
	}

	// Draws the selected and hovered object highlights and labels.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		drawSelectedObject(ctx, state, state.selectedObject, state.theme.selectedObject.color)
		drawObjectHighlight(ctx, state, state.hoverObject, state.theme.hoverHighlight.color, 6)
		this.drawHighlightedLabel(ctx, state, state.selectedObject)

		if (!sameObject(state.selectedObject, state.hoverObject)) {
			this.drawHighlightedLabel(ctx, state, state.hoverObject)
		}
	}

	// Draws the label of a highlighted star or deep-sky object.
	private drawHighlightedLabel(ctx: CanvasRenderingContext2D, state: RenderState, object: CelestialObject | null) {
		if (!object) return

		switch (object.type) {
			case 'star':
				this.drawHighlightedStarLabel(ctx, state, object)
				break
			case 'deepSky':
				this.drawHighlightedDeepSkyLabel(ctx, state, object)
				break
		}
	}

	// Draws a highlighted star's name when the star layer did not label it.
	private drawHighlightedStarLabel(ctx: CanvasRenderingContext2D, state: RenderState, object: Extract<CelestialObject, { type: 'star' }>) {
		const catalog = state.starCatalog

		if (!catalog || !catalog.visible[object.index] || catalog.labelVisible[object.index] !== 0) return

		const name = object.name ?? catalog.names[object.index]

		if (!name) return

		applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, this.point)

		if (!isPointInsideViewportMargin(this.point[0], this.point[1], state.width, state.height, 0)) return

		ctx.fillStyle = state.theme.stars.labelColor
		ctx.font = state.theme.stars.labelFont
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		if (positionSkyLabel(ctx, state, name, this.point[0], this.point[1], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) {
			ctx.fillText(name, this.labelPoint[0], this.labelPoint[1])
		}
	}

	// Draws a highlighted deep-sky object's name when the deep-sky layer did not label it.
	private drawHighlightedDeepSkyLabel(ctx: CanvasRenderingContext2D, state: RenderState, object: Extract<CelestialObject, { type: 'deepSky' }>) {
		const catalog = state.deepSkyCatalog
		const dso = object.object

		if (!catalog || !catalog.visible[object.index] || !dso.name || catalog.labelVisible[object.index] !== 0) return
		applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, this.point)
		if (!isPointInsideViewportMargin(this.point[0], this.point[1], state.width, state.height, DSO_VIEWPORT_MARGIN)) return

		ctx.fillStyle = state.theme.deepSky.labelColor
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		if (positionSkyLabel(ctx, state, dso.name, this.point[0], this.point[1], 10, -2, this.labelPoint)) {
			ctx.fillText(dso.name, this.labelPoint[0], this.labelPoint[1])
		}
	}
}
