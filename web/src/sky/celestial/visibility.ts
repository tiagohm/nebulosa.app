import { clamp } from 'nebulosa/src/math/numerical/math'
import { isFiniteNumber } from './geometry'
import type { DeepSkyObject, MovingBody, RenderState } from './types'

// Zoom-dependent magnitude limits of the star map: bright objects and labels show at base zoom and fainter
// ones appear progressively while zooming in, shared by the layers and picking so both agree on what is
// visible. Magnitudes are visual magnitudes; a zoom octave doubles the zoom factor.

// Star magnitude shown at base zoom; higher shows more faint stars initially.
const STAR_SYMBOL_BASE_MAGNITUDE = 6
// Extra star magnitude unlocked per zoom octave; higher reveals faint stars faster while zooming.
const STAR_SYMBOL_MAGNITUDE_PER_ZOOM = 1.9
// Lower bound of the star magnitude limit when zoomed out; higher hides fewer stars at low zoom.
const STAR_SYMBOL_MIN_MAGNITUDE = 4
// Star label magnitude shown at base zoom; higher labels more stars initially.
const STAR_LABEL_BASE_MAGNITUDE = 1.5
// Extra labeled star magnitude unlocked per zoom octave; higher reveals labels faster while zooming.
const STAR_LABEL_MAGNITUDE_PER_ZOOM = 2.2
// Lower bound of the star label magnitude limit.
const STAR_LABEL_MIN_MAGNITUDE = 1.5
// Magnitude assigned to deep-sky objects without one; higher makes them appear later while zooming.
const DSO_DEFAULT_MAGNITUDE = 10
// Deep-sky magnitude shown at base zoom; higher shows more faint objects initially.
const DSO_SYMBOL_BASE_MAGNITUDE = 7
// Extra deep-sky magnitude unlocked per zoom octave.
const DSO_SYMBOL_MAGNITUDE_PER_ZOOM = 1.9
// Lower bound of the deep-sky magnitude limit when zoomed out.
const DSO_SYMBOL_MIN_MAGNITUDE = 6
// Faintest deep-sky symbol ever shown; caps visual density.
const DSO_SYMBOL_MAX_MAGNITUDE = 14.5
// Deep-sky label magnitude shown at base zoom.
const DSO_LABEL_BASE_MAGNITUDE = 4.5
// Extra labeled deep-sky magnitude unlocked per zoom octave.
const DSO_LABEL_MAGNITUDE_PER_ZOOM = 2.5
// Lower bound of the deep-sky label magnitude limit.
const DSO_LABEL_MIN_MAGNITUDE = 4.5
// Faintest deep-sky label ever shown; caps label clutter.
const DSO_LABEL_MAX_MAGNITUDE = 14

// Returns the magnitude limit at zoom factor `k`: `baseMagnitude` at k = 1 plus `magnitudePerZoom` per zoom
// octave (k below 0.25 counts as 0.25), clamped to [minMagnitude, maxMagnitude].
function zoomMagnitudeLimit(k: number, baseMagnitude: number, magnitudePerZoom: number, minMagnitude: number, maxMagnitude: number) {
	const upperMagnitude = Math.max(minMagnitude, maxMagnitude)
	const limit = clamp(baseMagnitude + Math.log2(Math.max(k, 0.25)) * magnitudePerZoom, minMagnitude, upperMagnitude)
	return Math.min(limit, maxMagnitude)
}

// Returns the faintest star magnitude drawn at a zoom factor, capped by the configured limit.
export function starSymbolMagnitudeLimitAtZoom(zoom: number, maxMagnitude: number) {
	return zoomMagnitudeLimit(zoom, STAR_SYMBOL_BASE_MAGNITUDE, STAR_SYMBOL_MAGNITUDE_PER_ZOOM, STAR_SYMBOL_MIN_MAGNITUDE, maxMagnitude)
}

// Returns the faintest star magnitude drawn in a render state.
export function starSymbolMagnitudeLimit(state: RenderState) {
	return starSymbolMagnitudeLimitAtZoom(state.transform.k, state.stars.maxMagnitude)
}

// Returns the faintest star magnitude labeled in a render state.
export function starLabelMagnitudeLimit(state: RenderState) {
	return zoomMagnitudeLimit(state.transform.k, STAR_LABEL_BASE_MAGNITUDE, STAR_LABEL_MAGNITUDE_PER_ZOOM, STAR_LABEL_MIN_MAGNITUDE, state.stars.maxMagnitude)
}

// Returns whether a star of the given magnitude is drawn at a zoom factor.
export function isStarVisibleAtZoom(magnitude: number, zoom: number, maxMagnitude: number) {
	return magnitude <= starSymbolMagnitudeLimitAtZoom(zoom, maxMagnitude)
}

// Returns a deep-sky object's magnitude, or the default magnitude when it has none.
export function deepSkyMagnitude(object: DeepSkyObject) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : DSO_DEFAULT_MAGNITUDE
}

// Returns the faintest deep-sky magnitude drawn at zoom factor `k`.
function deepSkyObjectMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_SYMBOL_BASE_MAGNITUDE, DSO_SYMBOL_MAGNITUDE_PER_ZOOM, DSO_SYMBOL_MIN_MAGNITUDE, DSO_SYMBOL_MAX_MAGNITUDE)
}

// Returns the faintest deep-sky magnitude labeled at zoom factor `k`.
function deepSkyLabelMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_LABEL_BASE_MAGNITUDE, DSO_LABEL_MAGNITUDE_PER_ZOOM, DSO_LABEL_MIN_MAGNITUDE, DSO_LABEL_MAX_MAGNITUDE)
}

// Returns whether a deep-sky object is drawn at a zoom factor.
export function isDeepSkyObjectVisibleAtZoom(object: DeepSkyObject, zoom: number) {
	return deepSkyMagnitude(object) <= deepSkyObjectMagnitudeLimit(zoom)
}

// Returns whether a deep-sky object is drawn in a render state.
export function isDeepSkyObjectVisible(object: DeepSkyObject, state: RenderState) {
	return isDeepSkyObjectVisibleAtZoom(object, state.transform.k)
}

// Returns whether a deep-sky object is labeled in a render state.
export function isDeepSkyLabelVisible(object: DeepSkyObject, state: RenderState) {
	return deepSkyMagnitude(object) <= deepSkyLabelMagnitudeLimit(state.transform.k)
}

// Returns a moving body's magnitude, or 0 when it has none.
export function movingBodyMagnitude(object: MovingBody) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : 0
}

// Returns whether a moving body is drawn at a zoom factor; bodies without magnitude always are.
export function isMovingBodyVisibleAtZoom(object: MovingBody, zoom: number) {
	return !isFiniteNumber(object.magnitude) || object.magnitude <= deepSkyObjectMagnitudeLimit(zoom)
}

// Returns whether a moving body is drawn in a render state.
export function isMovingBodyVisible(object: MovingBody, state: RenderState) {
	return object.visible !== false && isMovingBodyVisibleAtZoom(object, state.transform.k)
}
