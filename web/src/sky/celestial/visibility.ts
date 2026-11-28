import { clamp } from 'nebulosa/src/math/numerical/math'
import { isFiniteNumber } from './geometry'
import type { DeepSkyObject, MovingBody, RenderState } from './types'

// Zoom-dependent magnitude limits of the star map: bright objects and labels show at base zoom and fainter
// ones appear progressively while zooming in, shared by the layers and picking so both agree on what is
// visible. Magnitudes are visual magnitudes; a zoom octave doubles the zoom factor. Every limit but those of the Sun,
// the Moon, and the planets also counts the size of the projection disk: a small disk (a phone) holds the whole sky in
// fewer pixels while its symbols and names keep their size, so it draws fewer of them. Deep-sky objects, asteroids and
// comets, and the names of stars, deep-sky objects, and constellations follow the density zoom, which shows on a small
// disk what a proportionally lower zoom would; star symbols, whose count grows steeply with magnitude, are thinned by
// the magnitudes that keep their density on the screen. Asteroids and comets, which a library of kernels may hold by the
// thousand, follow limits of their own that reach much fainter bodies when zoomed in.

// Radius in pixels of the base projection disk at which the limits read as designed (a desktop map); larger disks
// read the same.
const DENSITY_REFERENCE_RADIUS = 360
// Smallest share of the reference radius a small disk counts, 0 to 1; keeps a tiny map from emptying.
const DENSITY_MIN_SHARE = 0.35

// Star magnitude shown at base zoom; higher shows more faint stars initially.
const STAR_SYMBOL_BASE_MAGNITUDE = 6
// Star magnitudes taken off per halving of the disk radius below DENSITY_REFERENCE_RADIUS: a disk of a quarter of the
// area keeps the density of stars on the screen with a quarter of them, about 1.2 magnitudes brighter, the number of
// stars growing about 3.2 times per magnitude near the naked-eye limit.
const STAR_SYMBOL_MAGNITUDE_PER_RADIUS_OCTAVE = 1.2
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
// Lower bound of the deep-sky magnitude limit when zoomed out or on a small disk.
const DSO_SYMBOL_MIN_MAGNITUDE = 5
// Faintest deep-sky symbol ever shown; caps visual density.
const DSO_SYMBOL_MAX_MAGNITUDE = 14.5
// Deep-sky label magnitude shown at base zoom.
const DSO_LABEL_BASE_MAGNITUDE = 4.5
// Extra labeled deep-sky magnitude unlocked per zoom octave.
const DSO_LABEL_MAGNITUDE_PER_ZOOM = 2.5
// Lower bound of the deep-sky label magnitude limit when zoomed out or on a small disk.
const DSO_LABEL_MIN_MAGNITUDE = 3
// Faintest deep-sky label ever shown; caps label clutter.
const DSO_LABEL_MAX_MAGNITUDE = 14

// Faintest asteroid or comet drawn at zoom factor 1 (the whole sky), visual magnitude: the few brightest of them.
const SMALL_BODY_SYMBOL_BASE_MAGNITUDE = 9
// Magnitudes added to the asteroid and comet limit per zoom octave.
const SMALL_BODY_SYMBOL_MAGNITUDE_PER_ZOOM = 1.5
// Bounds of the asteroid and comet limit, visual magnitudes; the faintest reaches the near-Earth asteroids of a deep zoom.
const SMALL_BODY_SYMBOL_MIN_MAGNITUDE = 6
const SMALL_BODY_SYMBOL_MAX_MAGNITUDE = 22

// Faintest asteroid or comet named at zoom factor 1, visual magnitude, and per zoom octave, two magnitudes brighter than
// the symbols, within the bounds below.
const SMALL_BODY_LABEL_BASE_MAGNITUDE = 7
const SMALL_BODY_LABEL_MAGNITUDE_PER_ZOOM = 1.5
const SMALL_BODY_LABEL_MIN_MAGNITUDE = 4
const SMALL_BODY_LABEL_MAX_MAGNITUDE = 20

// Returns the magnitude limit at zoom factor `k`: `baseMagnitude` at k = 1 plus `magnitudePerZoom` per zoom
// octave (k below 0.25 counts as 0.25), clamped to [minMagnitude, maxMagnitude].
function zoomMagnitudeLimit(k: number, baseMagnitude: number, magnitudePerZoom: number, minMagnitude: number, maxMagnitude: number) {
	const upperMagnitude = Math.max(minMagnitude, maxMagnitude)
	const limit = clamp(baseMagnitude + Math.log2(Math.max(k, 0.25)) * magnitudePerZoom, minMagnitude, upperMagnitude)
	return Math.min(limit, maxMagnitude)
}

// Returns the share of the reference radius a base projection disk of `radius` pixels counts: 1 from
// DENSITY_REFERENCE_RADIUS up, and proportionally less below it, down to DENSITY_MIN_SHARE.
function densityShare(radius: number) {
	return clamp(radius / DENSITY_REFERENCE_RADIUS, DENSITY_MIN_SHARE, 1)
}

// Returns the zoom factor `zoom` as counted by the density limits on a base projection disk of `radius` pixels: the
// zoom itself from DENSITY_REFERENCE_RADIUS up, and proportionally less below it, down to DENSITY_MIN_SHARE of it.
export function densityZoom(zoom: number, radius: number) {
	return zoom * densityShare(radius)
}

// Returns the density zoom of a render state.
export function stateDensityZoom(state: RenderState) {
	return densityZoom(state.transform.k, state.projectionRadius)
}

// Returns the faintest star magnitude drawn at a zoom factor on a base projection disk of `radius` pixels, brighter on
// a disk smaller than DENSITY_REFERENCE_RADIUS, capped by the configured limit.
export function starSymbolMagnitudeLimitAtZoom(zoom: number, radius: number, maxMagnitude: number) {
	const baseMagnitude = STAR_SYMBOL_BASE_MAGNITUDE + Math.log2(densityShare(radius)) * STAR_SYMBOL_MAGNITUDE_PER_RADIUS_OCTAVE
	return zoomMagnitudeLimit(zoom, baseMagnitude, STAR_SYMBOL_MAGNITUDE_PER_ZOOM, STAR_SYMBOL_MIN_MAGNITUDE, maxMagnitude)
}

// Returns the faintest star magnitude drawn in a render state.
export function starSymbolMagnitudeLimit(state: RenderState) {
	return starSymbolMagnitudeLimitAtZoom(state.transform.k, state.projectionRadius, state.stars.maxMagnitude)
}

// Returns the faintest star magnitude labeled in a render state.
export function starLabelMagnitudeLimit(state: RenderState) {
	return zoomMagnitudeLimit(stateDensityZoom(state), STAR_LABEL_BASE_MAGNITUDE, STAR_LABEL_MAGNITUDE_PER_ZOOM, STAR_LABEL_MIN_MAGNITUDE, state.stars.maxMagnitude)
}

// Returns whether a star of the given magnitude is drawn at a zoom factor on a base projection disk of `radius` pixels.
export function isStarVisibleAtZoom(magnitude: number, zoom: number, radius: number, maxMagnitude: number) {
	return magnitude <= starSymbolMagnitudeLimitAtZoom(zoom, radius, maxMagnitude)
}

// Returns a deep-sky object's magnitude, or the default magnitude when it has none.
export function deepSkyMagnitude(object: DeepSkyObject) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : DSO_DEFAULT_MAGNITUDE
}

// Returns the faintest deep-sky magnitude drawn at zoom factor `k`.
export function deepSkyObjectMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_SYMBOL_BASE_MAGNITUDE, DSO_SYMBOL_MAGNITUDE_PER_ZOOM, DSO_SYMBOL_MIN_MAGNITUDE, DSO_SYMBOL_MAX_MAGNITUDE)
}

// Returns the faintest deep-sky magnitude labeled at zoom factor `k`.
export function deepSkyLabelMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_LABEL_BASE_MAGNITUDE, DSO_LABEL_MAGNITUDE_PER_ZOOM, DSO_LABEL_MIN_MAGNITUDE, DSO_LABEL_MAX_MAGNITUDE)
}

// Returns whether a deep-sky object is drawn at a density zoom (see densityZoom).
export function isDeepSkyObjectVisibleAtZoom(object: DeepSkyObject, zoom: number) {
	return deepSkyMagnitude(object) <= deepSkyObjectMagnitudeLimit(zoom)
}

// Returns whether a deep-sky object is drawn in a render state.
export function isDeepSkyObjectVisible(object: DeepSkyObject, state: RenderState) {
	return isDeepSkyObjectVisibleAtZoom(object, stateDensityZoom(state))
}

// Returns whether a deep-sky object is labeled in a render state.
export function isDeepSkyLabelVisible(object: DeepSkyObject, state: RenderState) {
	return deepSkyMagnitude(object) <= deepSkyLabelMagnitudeLimit(stateDensityZoom(state))
}

// Returns the faintest asteroid or comet magnitude drawn at zoom factor `k`.
export function smallBodyMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, SMALL_BODY_SYMBOL_BASE_MAGNITUDE, SMALL_BODY_SYMBOL_MAGNITUDE_PER_ZOOM, SMALL_BODY_SYMBOL_MIN_MAGNITUDE, SMALL_BODY_SYMBOL_MAX_MAGNITUDE)
}

// Returns the faintest asteroid or comet magnitude named at zoom factor `k`.
export function smallBodyLabelMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, SMALL_BODY_LABEL_BASE_MAGNITUDE, SMALL_BODY_LABEL_MAGNITUDE_PER_ZOOM, SMALL_BODY_LABEL_MIN_MAGNITUDE, SMALL_BODY_LABEL_MAX_MAGNITUDE)
}

// Returns whether a moving body is an asteroid or a comet.
export function isSmallBody(object: MovingBody) {
	return object.type === 'asteroid' || object.type === 'comet'
}

// Returns a moving body's magnitude, or 0 when it has none.
export function movingBodyMagnitude(object: MovingBody) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : 0
}

// Returns whether a moving body is drawn at a zoom factor on a base projection disk of `radius` pixels: an asteroid or
// comet within smallBodyMagnitudeLimit of the density zoom, or at any magnitude when `allSmallBodies`, any other within
// the deep-sky limit of the zoom itself; bodies without magnitude, or always visible, always are.
export function isMovingBodyVisibleAtZoom(object: MovingBody, zoom: number, radius: number, allSmallBodies: boolean = false) {
	if (object.alwaysVisible === true || !isFiniteNumber(object.magnitude) || (allSmallBodies && isSmallBody(object))) return true
	return object.magnitude <= (isSmallBody(object) ? smallBodyMagnitudeLimit(densityZoom(zoom, radius)) : deepSkyObjectMagnitudeLimit(zoom))
}

// Returns whether the name of a visible moving body may be left out: that of an asteroid or comet not always visible
// (such as one of the kernels of the library), named only where it fits; the names of the Sun, the Moon, the planets, and
// the bodies always visible are always drawn.
export function isMovingLabelOptional(object: MovingBody) {
	return isSmallBody(object) && object.alwaysVisible !== true
}

// Returns whether an optional moving-body name is bright enough to be drawn in a render state; one without magnitude
// always is.
export function isOptionalMovingLabelVisible(object: MovingBody, state: RenderState) {
	return !isFiniteNumber(object.magnitude) || object.magnitude <= smallBodyLabelMagnitudeLimit(stateDensityZoom(state))
}

// Returns whether a moving body is drawn in a render state.
export function isMovingBodyVisible(object: MovingBody, state: RenderState) {
	return object.visible !== false && isMovingBodyVisibleAtZoom(object, state.transform.k, state.projectionRadius, state.allSmallBodies)
}
