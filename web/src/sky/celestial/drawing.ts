import { DEG2RAD, PI, PIOVERTWO, TAU } from 'nebulosa/src/core/constants'
import { type NumberArray, clamp } from 'nebulosa/src/math/numerical/math'
import { applyViewTransform, HORIZON_EPSILON, isFiniteDiskProjection } from './geometry'
import type { CelestialObject, DeepSkyObject, MovingBody, MovingBodyType, RenderState } from './types'
import { isDeepSkyObjectVisible, isStarVisibleAtZoom } from './visibility'

// Canvas drawing primitives shared by the star map layers: projection disk clipping, horizon-aware
// clipped polylines built from projection samplers, label placement inside the projection disk, object
// symbols, and hover/selection highlights. Positions are pixels and angles radians.

// Viewport margin in pixels for drawing and picking deep-sky objects; higher keeps near-edge objects active
// longer during pan.
export const DSO_VIEWPORT_MARGIN = 16

// Preferred horizontal label offset from a star or moving body in pixels.
export const STAR_LABEL_OFFSET_X = 7

// Preferred vertical label offset from a star or moving body in pixels.
export const STAR_LABEL_OFFSET_Y = -7

// Cardinal point labels and their azimuths in radians (north 0, east π/2).
const CARDINAL_POINT_LABELS = [
	['N', 0],
	['E', PIOVERTWO],
	['S', PI],
	['W', PI + PIOVERTWO],
] as const

// Altitude in radians at which cardinal point labels are drawn, just above the horizon.
const LABEL_ALTITUDE = 3 * DEG2RAD

// Scratch screen position for cardinal point labels.
const CARDINAL_POINT = new Float32Array(2)

// Scratch screen position for the zenith label.
const ZENITH_LABEL_POINT = new Float32Array(2)

// Scratch screen position for object highlights.
const OBJECT_HIGHLIGHT_POINT = new Float32Array(2)

// Path target of clipped polylines: a canvas context or a Path2D.
export type ProjectedPathSink = Pick<CanvasRenderingContext2D, 'moveTo' | 'lineTo'>

// Samples a curve at parameter t in [0, 1], writing its screen position at `out[0..1]` (NaN when not
// projectable), and returns its horizon visibility (negative below the horizon).
export type ProjectedSampler = (t: number, out: NumberArray) => number

// Receives the vertices emitted by drawClippedPolyline, for callers that cache them.
export interface ProjectedPolylineObserver {
	// Called once before the first vertex.
	readonly reset: VoidFunction
	// Called per emitted vertex; boundaryPoint marks horizon intersections.
	readonly append: (x: number, y: number, boundaryPoint: boolean) => void
	// Called when the polyline is interrupted.
	readonly break: VoidFunction
}

// Returns the screen x of the projection center in pixels.
export function projectionCenterX(state: RenderState) {
	return state.width / 2 + state.transform.x
}

// Returns the screen y of the projection center in pixels.
export function projectionCenterY(state: RenderState) {
	return state.height / 2 + state.transform.y
}

// Returns the projection disk radius in screen pixels after zoom.
export function transformedProjectionRadius(state: RenderState) {
	return state.projectionRadius * state.transform.k
}

// Clips the context to the projection disk.
export function clipProjectionDisk(ctx: CanvasRenderingContext2D, state: RenderState) {
	ctx.beginPath()
	ctx.arc(projectionCenterX(state), projectionCenterY(state), transformedProjectionRadius(state), 0, TAU)
	ctx.clip()
}

// Strokes the projection disk boundary with the current stroke style.
export function drawProjectionBoundary(ctx: CanvasRenderingContext2D, state: RenderState) {
	const radius = Math.max(0, transformedProjectionRadius(state) - 0.5)
	ctx.beginPath()
	ctx.arc(projectionCenterX(state), projectionCenterY(state), radius, 0, TAU)
	ctx.stroke()
}

// Returns the longest segment in pixels drawn between consecutive samples; longer jumps (wrap-arounds at
// the projection edge) start a new subpath.
export function projectedSegmentLimit(state: RenderState, transformScale = state.transform.k) {
	return Math.max(96, state.projectionRadius * transformScale * 0.75)
}

// Appends a projected point to a path, moving instead of drawing for the first point or after a jump longer
// than `maxDistance` pixels; returns whether the point was finite (the path is then started).
function appendProjectedPoint(ctx: ProjectedPathSink, point: NumberArray, previous: NumberArray, started: boolean, maxDistance: number): boolean {
	if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false

	const dx = point[0] - previous[0]
	const dy = point[1] - previous[1]

	if (!started || dx * dx + dy * dy > maxDistance * maxDistance) {
		ctx.moveTo(point[0], point[1])
	} else {
		ctx.lineTo(point[0], point[1])
	}

	previous[0] = point[0]
	previous[1] = point[1]
	return true
}

// Finishes a projection sample: marks `out` as not projected (NaN) when needed and returns the visibility.
export function writeProjectedSample(out: NumberArray, visibility: number, projected: boolean) {
	if (!projected) {
		out[0] = Number.NaN
		out[1] = Number.NaN
	}

	return visibility
}

// Returns whether a projection sample holds a finite screen position.
export function isProjectedSample(out: NumberArray) {
	return Number.isFinite(out[0]) && Number.isFinite(out[1])
}

// Draws a sampled curve with `steps` segments into a path, cutting it at the horizon (refined by bisection)
// and at projection discontinuities. `point` and `previous` are 2-element scratch arrays.
export function drawClippedPolyline(ctx: ProjectedPathSink, state: RenderState, steps: number, point: NumberArray, previous: NumberArray, sampler: ProjectedSampler, observer?: ProjectedPolylineObserver, maxDistance = projectedSegmentLimit(state, 1)) {
	let previousT = 0
	let previousVisibility = Number.NaN
	let previousProjected = false
	let started = false
	observer?.reset()

	for (let i = 0; i <= steps; i++) {
		const t = i / steps
		const visibility = sampler(t, point)
		const projected = isProjectedSample(point)
		const visible = visibility >= -HORIZON_EPSILON && projected

		if (i > 0 && Number.isFinite(previousVisibility) && previousVisibility * visibility < 0) {
			const intersectionT = findHorizonIntersection(previousT, previousVisibility, t, visibility, sampler, point)
			sampler(intersectionT, point)

			if (isProjectedSample(point)) {
				const previousStarted = started
				started = appendProjectedPoint(ctx, point, previous, started, maxDistance)

				if (previousStarted || visible) {
					observer?.append(point[0], point[1], true)
				}

				if (!visible) {
					started = false
					observer?.break()
				}
			}

			if (visible) {
				sampler(t, point)
			}
		}

		if (visible) {
			started = appendProjectedPoint(ctx, point, previous, started, maxDistance)
			observer?.append(point[0], point[1], false)
		} else if (!previousProjected || visibility < -HORIZON_EPSILON) {
			started = false
			observer?.break()
		}

		previousT = t
		previousVisibility = visibility
		previousProjected = projected
	}
}

// Applies the pan and zoom transform to the context so base-coordinate paths draw at screen positions.
export function applyBasePathTransform(ctx: CanvasRenderingContext2D, state: RenderState) {
	ctx.translate(state.width / 2 + state.transform.x, state.height / 2 + state.transform.y)
	ctx.scale(state.transform.k, state.transform.k)
	ctx.translate(-state.width / 2, -state.height / 2)
}

// Bisects the parameter in [minT, maxT] where the sampled visibility changes sign and returns the endpoint
// closest to the horizon after 16 iterations.
function findHorizonIntersection(minT: number, minVisibility: number, maxT: number, maxVisibility: number, sampler: ProjectedSampler, point: NumberArray) {
	let lowT = minT
	let highT = maxT
	let lowVisibility = minVisibility
	let highVisibility = maxVisibility

	for (let i = 0; i < 16; i++) {
		const midT = (lowT + highT) / 2
		const midVisibility = sampler(midT, point)

		if (!Number.isFinite(midVisibility)) {
			break
		}

		if (Math.sign(midVisibility) === Math.sign(lowVisibility)) {
			lowT = midT
			lowVisibility = midVisibility
		} else {
			highT = midT
			highVisibility = midVisibility
		}
	}

	return Math.abs(lowVisibility) < Math.abs(highVisibility) ? lowT : highT
}

// Returns a label font size in pixels that grows with zoom, up to 30% above `baseSize`.
export function skyLabelSize(state: RenderState, baseSize: number) {
	return clamp(baseSize * Math.sqrt(state.transform.k), baseSize, baseSize * 1.3)
}

// Returns the CSS font of a zoom-scaled sky label.
export function skyLabelFont(state: RenderState, baseSize: number) {
	return `${skyLabelSize(state, baseSize).toFixed(1)}px system-ui, sans-serif`
}

// Places a left-aligned label next to an anchor (pixels), preferring the right side and keeping it inside
// the viewport and the projection disk; writes its position at `out[0..1]` and returns false when it does
// not fit. Uses the context's current font for measurement.
export function positionSkyLabel(ctx: CanvasRenderingContext2D, state: RenderState, name: string, anchorX: number, anchorY: number, offsetX: number, offsetY: number, out: Float32Array) {
	const width = ctx.measureText(name).width
	const horizontalInset = 2
	const verticalInset = 6
	let minX = horizontalInset
	let maxX = state.width - width - horizontalInset
	let y = clamp(anchorY + offsetY, verticalInset, state.height - verticalInset)

	if (isFiniteDiskProjection(state.projection)) {
		const cx = projectionCenterX(state)
		const cy = projectionCenterY(state)
		const radius = Math.max(1, transformedProjectionRadius(state) - horizontalInset)
		y = clamp(y, cy - radius + verticalInset, cy + radius - verticalInset)
		const dy = y - cy
		const chord = Math.sqrt(Math.max(0, radius * radius - dy * dy))
		minX = Math.max(minX, cx - chord + horizontalInset)
		maxX = Math.min(maxX, cx + chord - width - horizontalInset)
	}

	if (maxX < minX) {
		return false
	}

	const rightX = anchorX + offsetX
	const leftX = anchorX - offsetX - width
	let x: number

	if (rightX >= minX && rightX <= maxX) {
		x = rightX
	} else if (leftX >= minX && leftX <= maxX) {
		x = leftX
	} else {
		const preferredX = anchorX > projectionCenterX(state) ? leftX : rightX
		x = clamp(preferredX, minX, maxX)
	}

	out[0] = x
	out[1] = y
	return true
}

// Draws the N, E, S, and W labels just above the horizon.
export function drawCardinalPoints(ctx: CanvasRenderingContext2D, state: RenderState) {
	const point = CARDINAL_POINT

	ctx.fillStyle = state.theme.horizon.color
	ctx.font = skyLabelFont(state, 11)
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'

	for (let i = 0; i < CARDINAL_POINT_LABELS.length; i++) {
		const [label, az] = CARDINAL_POINT_LABELS[i]

		if (state.projectHorizontalToScreen(az, LABEL_ALTITUDE, point)) {
			ctx.fillText(label, point[0], point[1])
		}
	}
}

// Draws a dot and a "Z" label at the zenith.
export function drawZenithLabel(ctx: CanvasRenderingContext2D, state: RenderState) {
	const point = ZENITH_LABEL_POINT

	if (!state.projectHorizontalToScreen(0, PIOVERTWO, point)) return

	ctx.fillStyle = state.theme.horizon.color
	ctx.font = skyLabelFont(state, 13)
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	ctx.beginPath()
	ctx.arc(point[0], point[1], Math.max(1.5, Math.min(3, state.transform.k * 1.5)), 0, TAU)
	ctx.fill()
	ctx.fillText('Z', point[0], point[1] - 14 * Math.sqrt(Math.min(2.25, state.transform.k)))
}

// Draws a deep-sky symbol of `radius` pixels for a Stellarium object type: an ellipse for galaxies, a circle
// for clusters, a crossed circle for globular clusters, and a small square otherwise.
export function drawDsoSymbol(ctx: CanvasRenderingContext2D, type: DeepSkyObject['type'], x: number, y: number, radius: number) {
	switch (type) {
		case 1: // galaxy
		case 2: // active galaxy
		case 3: // radio galaxy
		case 4: // interacting galaxy
			ctx.beginPath()
			ctx.ellipse(x, y, radius * 1.4, radius * 0.7, -PIOVERTWO / 2, 0, TAU)
			ctx.stroke()
			break
		case 6: // star cluster
		case 7: // open cluster
		case 9: // stellar association
		case 17: // cluster associated with nebulosity
			ctx.beginPath()
			ctx.arc(x, y, radius, 0, TAU)
			ctx.stroke()
			break
		case 8: // globular cluster
			ctx.beginPath()
			ctx.arc(x, y, radius, 0, TAU)
			ctx.stroke()
			ctx.beginPath()
			ctx.moveTo(x - radius, y)
			ctx.lineTo(x + radius, y)
			ctx.moveTo(x, y - radius)
			ctx.lineTo(x, y + radius)
			ctx.stroke()
			break
		default:
			ctx.fillRect(x - 2, y - 2, 2 * 2, 2 * 2)
			break
	}
}

// Draws a moving body symbol: a tailed circle for comets and a filled disc otherwise.
export function drawMovingBodySymbol(ctx: CanvasRenderingContext2D, type: MovingBodyType, x: number, y: number) {
	if (type === 'comet') {
		ctx.beginPath()
		ctx.moveTo(x - 6, y + 3)
		ctx.lineTo(x - 1, y)
		ctx.stroke()
		ctx.beginPath()
		ctx.arc(x, y, 2.8, 0, TAU)
		ctx.stroke()
		return
	}

	ctx.beginPath()
	ctx.arc(x, y, type === 'asteroid' ? 3 : 4.5, 0, TAU)
	ctx.fill()
}

// Returns the theme color of a moving body by type.
export function movingBodyColor(object: MovingBody, state: RenderState) {
	if (object.type === 'comet') return state.theme.movingBodies.cometColor
	if (object.type === 'asteroid') return state.theme.movingBodies.asteroidColor
	return state.theme.movingBodies.planetColor
}

// Radius in pixels of the ring of the selection reticle.
const SELECTION_RING_RADIUS = 11

// Inner and outer distance in pixels from the center of the ticks of the selection reticle.
const SELECTION_TICK_RANGE = [15, 23] as const

// Halo drawn under the selection reticle so it stands out on bright and dark sky alike.
const SELECTION_HALO = 'rgba(0, 0, 0, 0.7)'

// The x/y directions of the four ticks pointing at the object.
const RETICLE_TICKS = [
	[0, -1],
	[1, 0],
	[0, 1],
	[-1, 0],
] as const

// Draws the selection reticle centered at a point in pixels: a ring and four ticks pointing at the
// object, stroked over a dark halo.
export function drawSelectionReticle(ctx: CanvasRenderingContext2D, x: number, y: number, color: string) {
	ctx.save()
	ctx.lineCap = 'round'

	for (const [lineWidth, strokeStyle] of [
		[6, SELECTION_HALO],
		[2, color],
	] as const) {
		ctx.lineWidth = lineWidth
		ctx.strokeStyle = strokeStyle
		ctx.beginPath()
		ctx.arc(x, y, SELECTION_RING_RADIUS, 0, TAU)

		for (const [dx, dy] of RETICLE_TICKS) {
			ctx.moveTo(x + dx * SELECTION_TICK_RANGE[0], y + dy * SELECTION_TICK_RANGE[0])
			ctx.lineTo(x + dx * SELECTION_TICK_RANGE[1], y + dy * SELECTION_TICK_RANGE[1])
		}

		ctx.stroke()
	}

	ctx.restore()
}

// Draws the selection reticle on an object when it is projected on the map, even when the zoom is too low
// for its symbol to be drawn, so a selection never disappears while zooming out.
export function drawSelectedObject(ctx: CanvasRenderingContext2D, state: RenderState, object: CelestialObject | null, color: string) {
	if (!object) return

	const point = OBJECT_HIGHLIGHT_POINT
	if (!projectObjectToScreen(object, state, point, true)) return

	drawSelectionReticle(ctx, point[0], point[1], color)
}

// Strokes a ring of `radius` pixels around an object when it is currently visible.
export function drawObjectHighlight(ctx: CanvasRenderingContext2D, state: RenderState, object: CelestialObject | null, color: string, radius: number) {
	if (!object) return

	const point = OBJECT_HIGHLIGHT_POINT

	if (!projectObjectToScreen(object, state, point)) return

	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.arc(point[0], point[1], radius, 0, TAU)
	ctx.stroke()
}

// Writes the current screen position of a picked object at `out[0..1]`; returns false when its layer is
// hidden or the object is not visible (projected, and bright enough for the zoom unless `anyZoom`).
function projectObjectToScreen(object: CelestialObject, state: RenderState, out: NumberArray, anyZoom: boolean = false): boolean {
	if (!isObjectLayerVisible(object, state)) {
		return false
	}

	switch (object.type) {
		case 'star': {
			const catalog = state.starCatalog
			if (!catalog || !catalog.visible[object.index]) return false
			if (!anyZoom && !isStarVisibleAtZoom(catalog.mag[object.index], state.transform.k, state.stars.maxMagnitude)) return false
			applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, out)
			return true
		}
		case 'deepSky': {
			const catalog = state.deepSkyCatalog
			if (!catalog || !catalog.visible[object.index]) return false
			if (!anyZoom && !isDeepSkyObjectVisible(object.object, state)) return false
			applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, out)
			return true
		}
		case 'movingBody': {
			const movingBody = currentMovingBodyForObject(object, state)
			return movingBody ? state.projectEquatorialToScreen(movingBody.position.rightAscension, movingBody.position.declination, out) : false
		}
		case 'constellationLabel':
			return state.projectEquatorialToScreen(object.label.rightAscension, object.label.declination, out)
		case 'shape':
			return object.shape.visible !== false && object.shape.selectable !== false && state.projectEquatorialToScreen(object.shape.coordinate.rightAscension, object.shape.coordinate.declination, out)
	}
}

// Returns the current moving body of a picked object by id, trying its recorded index first.
function currentMovingBodyForObject(object: Extract<CelestialObject, { type: 'movingBody' }>, state: RenderState): Readonly<MovingBody> | null {
	const indexed = state.movingBodies[object.index]

	if (indexed?.id === object.object.id) {
		return indexed
	}

	for (let i = 0; i < state.movingBodies.length; i++) {
		const movingBody = state.movingBodies[i]
		if (movingBody.id === object.object.id) return movingBody
	}

	return null
}

// Returns whether the layer that draws an object is visible.
function isObjectLayerVisible(object: CelestialObject, state: RenderState) {
	switch (object.type) {
		case 'star':
			return state.celestial.isLayerVisible('stars')
		case 'deepSky':
			return state.celestial.isLayerVisible('deepSky')
		case 'movingBody':
			return state.celestial.isLayerVisible('movingBodies')
		case 'constellationLabel':
			return state.celestial.isLayerVisible('constellationLabels')
		case 'shape':
			return state.celestial.isLayerVisible('shapes')
	}
}
