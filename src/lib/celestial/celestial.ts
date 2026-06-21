import { select } from 'd3-selection'
import { type D3ZoomEvent, type ZoomBehavior, zoom, zoomIdentity } from 'd3-zoom'
import { deg, normalizeAngle, type Angle } from 'nebulosa/src/angle'
import { DEG2RAD, PI, PIOVERTWO, TAU } from 'nebulosa/src/constants'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import type { Point, Size } from 'nebulosa/src/geometry'
import { clamp, type NumberArray } from 'nebulosa/src/math'
import type { StellariumObjectType } from 'nebulosa/src/stellarium'

// Public coordinate/projection options.
export type ProjectionType = 'azimuthalEquidistant' | 'azimuthalEqualArea' | 'orthographic' | 'stereographic' | 'gnomonic'

// Public coordinate-system options.
export type CoordinateSystem = 'horizontal' | 'equatorial'

// Supported event names emitted by Celestial.
export type CelestialEventName = 'hover' | 'click' | 'objectHover' | 'objectLeave' | 'selectionChange' | 'viewTransformChange' | 'renderStart' | 'renderEnd' | 'updateStart' | 'updateEnd' | 'resize' | 'error'

export type CelestialTime = Date | number

// Observer location in geodetic degrees/meters.
export interface ObserverLocation {
	latitude: number
	longitude: number
	elevation?: number
}

// Star object input for convenient object-array loading.
export interface Star extends EquatorialCoordinate {
	id?: string | number
	name?: string
	magnitude?: number
	bv?: number
	pmRA?: number
	pmDEC?: number
	epoch?: number
	flags?: number
}

// Typed-array catalog input for large catalogs.
export interface StarCatalogInput {
	ra: NumberArray
	dec: NumberArray
	mag?: NumberArray
	bv?: NumberArray
	pmRA?: NumberArray
	pmDEC?: NumberArray
	flags?: NumberArray
	names?: readonly string[]
	ids?: readonly StarId[]
	epoch?: number
	count?: number
}

// Constellation line segment.
export type ConstellationLine = readonly [Angle, Angle][]

// Constellation label entry.
export interface ConstellationLabel extends EquatorialCoordinate {
	name: string
}

// Constellation data consumed by line/label layers.
export interface ConstellationData {
	lines?: ConstellationLine[]
	labels?: ConstellationLabel[]
	boundaries?: ConstellationLine[]
}

export type MilkyWayPosition = readonly [Angle, Angle]
export type MilkyWayLinearRingCoordinates = readonly MilkyWayPosition[]
export type MilkyWayPolygonCoordinates = readonly MilkyWayLinearRingCoordinates[]
export type MilkyWayCoordinates = readonly MilkyWayPolygonCoordinates[]

// Deep-sky object shape.
export interface DeepSkyObject extends EquatorialCoordinate {
	id?: StarId
	name?: string
	type: StellariumObjectType
	magnitude?: number
	sizeArcMin?: number
}

// Solar-system body ids are intentionally open for app-specific bodies.
export type SolarSystemBody = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

export type MovingBodyType = SolarSystemBody | 'asteroid' | 'comet'

export interface MovingBody {
	readonly id: string
	readonly type: MovingBodyType
	readonly position: EquatorialCoordinate
	readonly name?: string
	magnitude?: number
	visible?: boolean
	selectable?: boolean
}

// Theme configuration used by Canvas renderers.
export interface ThemeOptions {
	background: string
	stars: {
		baseColor: string
		labelColor: string
		labelFont: string
		magnitudeScale: [number, number]
		minRadius: number
		maxRadius: number
	}
	grid: {
		color: string
		opacity: number
	}
	horizon: {
		color: string
		fillBelowHorizon: string
	}
	milkyWay: {
		color: string
		opacity: number
		lineColor: string
		levelColors?: readonly string[]
		levelOpacities?: readonly number[]
		lineOpacity: number
		lineWidth: number
	}
	constellations: {
		color: string
		opacity: number
		labelColor?: string
		labelFont: string
		labelOpacity?: number
		lineColor?: string
		lineOpacity?: number
		boundaryColor?: string
		boundaryOpacity?: number
	}
	deepSky: {
		color: string
		labelColor: string
	}
	movingBodies: {
		planetColor: string
		asteroidColor: string
		cometColor: string
		labelColor: string
	}
	selectedObject: {
		color: string
	}
	hoverHighlight: {
		color: string
	}
}

// Auto-update modes separate astronomical updates from animation frames.
export interface AutoUpdateOptions {
	mode?: 'realtime' | 'simulation'
	interval?: number
	timeStep?: number
}

// Star rendering options.
export interface StarLayerOptions {
	maxMagnitude?: number
	colorByBV?: boolean
	sizeByMagnitude?: boolean
	maxRenderStars?: number
	labels?: boolean
}

export interface ReferenceLineOptions {
	enabled?: boolean
	color?: string
	lineWidth?: number
}

export interface ReferenceLinesOptions {
	localMeridian?: ReferenceLineOptions
	celestialEquator?: ReferenceLineOptions
	ecliptic?: ReferenceLineOptions
}

// Interaction options.
export interface InteractionOptions {
	enabled?: boolean
	minZoom?: number
	maxZoom?: number
	pickRadius?: number
	pointerMoveThrottleMs?: number
	preferD3Zoom?: boolean
	wheelZoomSpeed?: number
}

// Celestial constructor options.
export interface CelestialOptions {
	width?: number
	height?: number
	projection?: ProjectionType
	coordinateSystem?: CoordinateSystem
	updateInterval?: number
	stars?: StarLayerOptions
	referenceLines?: ReferenceLinesOptions
	layers?: Partial<Record<string, boolean>>
	theme?: PartialThemeOptions
	interactions?: InteractionOptions
}

// Public render state passed to custom layers.
export interface RenderState {
	readonly celestial: Celestial
	readonly width: number
	readonly height: number
	readonly dpr: number
	readonly time: number // unix milliseconds
	readonly observer: Readonly<ObserverLocation>
	readonly projection: ProjectionType
	readonly coordinateSystem: CoordinateSystem
	readonly transform: Readonly<ViewTransform>
	readonly projectionRadius: number
	readonly referenceLines: ResolvedReferenceLinesOptions
	readonly stars: Readonly<Required<StarLayerOptions>>
	readonly theme: Readonly<ThemeOptions>
	readonly starCatalog: StarCatalog | null
	readonly constellations: Readonly<ConstellationData>
	readonly milkyWay: readonly Readonly<MilkyWayStep>[]
	readonly dsos: readonly Readonly<DeepSkyObject>[]
	readonly deepSkyLabelVisible: NumberArray
	readonly movingBodies: readonly Readonly<MovingBody>[]
	readonly shapes: readonly Readonly<CelestialShape>[]
	readonly hoverObject: Readonly<CelestialObject> | null
	readonly selectedObject: Readonly<CelestialObject> | null
	readonly projectEquatorialToScreen: (ra: number, dec: number, out: NumberArray) => boolean
	readonly projectHorizontalToScreen: (az: number, alt: number, out: NumberArray) => boolean
	readonly equatorialVisibility: (ra: number, dec: number) => number
	readonly horizontalVisibility: (az: number, alt: number) => number
}

// Public update state passed to custom layers.
export interface UpdateState {
	readonly time: Date
	readonly observer: ObserverLocation
	readonly projection: ProjectionType
	readonly coordinateSystem: CoordinateSystem
	readonly starCatalog: StarCatalog | null
}

// Public layer contract for extension.
export interface Layer {
	readonly id: string
	readonly visible: boolean
	readonly zIndex: number
	readonly render: (ctx: CanvasRenderingContext2D, state: RenderState) => void
	readonly update?: (state: UpdateState) => void
	readonly destroy: VoidFunction
}

export interface ShapeRenderState {
	readonly id: string
	readonly x: number
	readonly y: number
	readonly coordinate: Readonly<EquatorialCoordinate>
	readonly shape: Readonly<CelestialShape>
	readonly state: RenderState
}

type MutableShapeRenderState = {
	-readonly [K in keyof ShapeRenderState]: ShapeRenderState[K]
}

export interface CelestialShape {
	readonly id: string
	readonly coordinate: EquatorialCoordinate
	readonly visible?: boolean
	readonly selectable?: boolean
	readonly render: (celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) => void
}

// Public object shape used by picking/events.
export type CelestialObject =
	| { type: 'star'; index: number; id?: StarId; name?: string; mag?: number; ra: number; dec: number }
	| { type: 'deepSky'; index: number; object: DeepSkyObject }
	| { type: 'movingBody'; index: number; object: MovingBody }
	| { type: 'constellationLabel'; index: number; label: ConstellationLabel }
	| { type: 'shape'; id: string; shape: CelestialShape }

export type CelestialEventMap = {
	readonly hover: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null }>
	readonly click: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null }>
	readonly objectHover: Readonly<{ object: CelestialObject }>
	readonly objectLeave: Readonly<{ object: CelestialObject }>
	readonly selectionChange: Readonly<{ object: CelestialObject }>
	readonly viewTransformChange: Readonly<{ transform: ViewTransform }>
	readonly renderStart: Readonly<{ time: number }>
	readonly renderEnd: Readonly<{ time: number; duration: number; fps: number }>
	readonly updateStart: Readonly<{ time: number }>
	readonly updateEnd: Readonly<{ time: number; duration: number }>
	readonly resize: Readonly<{ width: number; height: number }>
	readonly error: Error
}

// Event callback payload is event-specific but remains ergonomic for consumers.
export type CelestialEventCallback<K extends CelestialEventName = CelestialEventName> = (payload: CelestialEventMap[K], eventName: K) => void

// View transform matches d3-zoom's x/y/k shape.
export interface ViewTransform {
	x: number
	y: number
	k: number
}

type PartialThemeOptions = {
	[K in keyof ThemeOptions]?: ThemeOptions[K] extends Record<string, unknown> ? Partial<ThemeOptions[K]> : ThemeOptions[K]
}

type CanvasImage = HTMLCanvasElement | OffscreenCanvas

type LayerRecord = {
	readonly layer: InternalLayer
	readonly canvas: HTMLCanvasElement
	readonly ctx: CanvasRenderingContext2D
}

type MilkyWayRing = {
	readonly vectors: Float32Array
	readonly pointCount: number
	readonly closed: boolean
}

type MilkyWayStep = {
	readonly rings: readonly MilkyWayRing[]
}

type AnyCelestialEventCallback = (payload: CelestialEventMap[CelestialEventName], eventName: CelestialEventName) => void

type ResolvedReferenceLineOptions = Required<ReferenceLineOptions>

type ResolvedReferenceLinesOptions = {
	readonly localMeridian: ResolvedReferenceLineOptions
	readonly celestialEquator: ResolvedReferenceLineOptions
	readonly ecliptic: ResolvedReferenceLineOptions
}

type ResolvedCelestialOptions = {
	width: number
	height: number
	projection: ProjectionType
	readonly coordinateSystem: CoordinateSystem
	observer: ObserverLocation
	time: number // unix milliseconds
	updateInterval: number
	readonly stars: Required<StarLayerOptions>
	readonly referenceLines: ResolvedReferenceLinesOptions
	readonly layers: Record<string, boolean>
	readonly theme: ThemeOptions
	readonly interactions: Required<InteractionOptions>
}

const J2000_EPOCH = 2000 // Julian epoch used as the baseline for proper-motion star positions.
const J2000_UNIX_MS = 946728000000 // Unix timestamp, in milliseconds, for the J2000 reference epoch.
const JULIAN_EPOCH = 2440587.5 // Julian-date offset for converting Unix milliseconds to Julian date.
const DAY_MS = 86400000 // Milliseconds in one civil day.
const YEAR_MS = 365.25 * DAY_MS // Mean year length used for lightweight Julian epoch interpolation.
const DEFAULT_WIDTH = 800 // Fallback canvas width when callers do not provide one.
const DEFAULT_HEIGHT = 800 // Fallback canvas height when callers do not provide one.
const DEFAULT_UPDATE_INTERVAL = 10000 // Default realtime update interval; lower updates sky positions more often, higher reduces background work.
const WHEEL_DELTA_LINE_PIXELS = 16 // Pixel equivalent for wheel events reported in text-line units; higher makes those wheels zoom faster.
const WHEEL_DELTA_PAGE_PIXELS = 800 // Pixel equivalent for wheel events reported in page units; higher makes page-mode wheels zoom faster.
const HORIZON_EPSILON = 1e-7 // Horizon visibility tolerance; higher hides near-horizon geometry sooner, lower can show floating-point noise.
const POLE_EPSILON = 1e-10 // Pole singularity tolerance for RA/Dec sampling; higher merges points near poles sooner.
const PROJECTION_PADDING = 10 // Screen padding around finite projection disks; higher shrinks the sky disk, lower uses more canvas.
const STAR_RADIUS_BUCKETS = 6 // Number of sprite size buckets; higher improves magnitude-size granularity but increases sprite cache work.
const STAR_COLOR_BUCKETS = 16 // Number of B-V color buckets; higher improves color granularity but increases sprite cache work.
const STAR_STYLE_BUCKETS = STAR_RADIUS_BUCKETS * STAR_COLOR_BUCKETS // Total cached star style buckets derived from radius and color bucket counts.
const VECTOR_STAR_ZOOM_THRESHOLD = 2.25 // Zoom where stars switch to vector drawing; lower sharpens stars sooner, higher favors faster sprite drawing.
const VECTOR_STAR_MAX_COUNT = 20000 // Catalog size ceiling for vector stars; higher keeps sharp rendering for denser views at greater CPU cost.
const VECTOR_STAR_MAX_RADIUS_SCALE = 3 // Maximum vector-star radius growth while zooming; higher makes bright stars expand more at high zoom.
const STAR_SYMBOL_BASE_MAGNITUDE = 7 // Star magnitude shown at base zoom; higher shows more faint stars initially, lower keeps the view cleaner.
const STAR_SYMBOL_MAGNITUDE_PER_ZOOM = 1.9 // Extra star magnitude unlocked per zoom octave; higher reveals faint stars faster while zooming.
const STAR_SYMBOL_MIN_MAGNITUDE = 4.5 // Faintest enforced lower bound when zoomed out; higher hides more stars at low zoom.
const STAR_LABEL_BASE_MAGNITUDE = 1.5 // Star label magnitude shown at base zoom; higher labels more stars initially, lower labels only brighter ones.
const STAR_LABEL_MAGNITUDE_PER_ZOOM = 2.2 // Extra labeled star magnitude unlocked per zoom octave; higher reveals labels faster while zooming.
const STAR_LABEL_MIN_MAGNITUDE = 1.5 // Minimum star label magnitude limit; higher suppresses dimmer labels even at low zoom.
const STAR_LABEL_MIN_SPACING = 36 // Minimum screen spacing between star labels; higher reduces overlap but shows fewer labels.
const STAR_LABEL_OFFSET_X = 7 // Preferred horizontal star-label offset from the star position.
const STAR_LABEL_OFFSET_Y = -7 // Preferred vertical star-label offset from the star position.
const DSO_DEFAULT_MAGNITUDE = 10 // Magnitude assigned to DSOs without catalog magnitude; higher makes unknown objects appear later with zoom.
const DSO_SYMBOL_BASE_MAGNITUDE = 8 // DSO magnitude shown at base zoom; higher shows more faint DSOs initially, lower keeps the map cleaner.
const DSO_SYMBOL_MAGNITUDE_PER_ZOOM = 1.9 // Extra DSO magnitude unlocked per zoom octave; higher reveals faint DSOs faster while zooming.
const DSO_SYMBOL_MIN_MAGNITUDE = 6 // Faintest enforced DSO lower bound when zoomed out; higher hides more DSOs at low zoom.
const DSO_SYMBOL_MAX_MAGNITUDE = 14.5 // Faintest DSO symbol ever shown by zoom; higher allows dimmer DSOs, lower caps visual density.
const DSO_LABEL_BASE_MAGNITUDE = 5.5 // DSO label magnitude shown at base zoom; higher labels more DSOs initially, lower labels only bright DSOs.
const DSO_LABEL_MAGNITUDE_PER_ZOOM = 2.5 // Extra labeled DSO magnitude unlocked per zoom octave; higher reveals DSO labels faster while zooming.
const DSO_LABEL_MIN_MAGNITUDE = 5.5 // Minimum DSO label magnitude limit; higher suppresses dimmer labels even at low zoom.
const DSO_LABEL_MAX_MAGNITUDE = 14 // Faintest DSO label ever shown by zoom; higher allows more labels, lower reduces label clutter.
const DSO_VIEWPORT_MARGIN = 16 // Viewport margin for drawing/picking DSOs; higher keeps near-edge objects active longer during pan.
const PICK_TYPE_STAR = 1 // Picking index type id for stars.
const PICK_TYPE_DSO = 2 // Picking index type id for deep-sky objects.
const PICK_TYPE_MOVING_BODY = 3 // Picking index type id for planets, asteroids, and comets.
const PICK_TYPE_CONSTELLATION_LABEL = 4 // Picking index type id for constellation labels.
const PICK_TYPE_SHAPE = 5 // Picking index type id for custom shapes.

const DEFAULT_THEME: ThemeOptions = {
	background: '#000000',
	stars: {
		baseColor: '#f8fbff',
		labelColor: '#d8deca',
		labelFont: '10px system-ui, sans-serif',
		magnitudeScale: [-1.5, 9],
		minRadius: 0.45,
		maxRadius: 1.8,
	},
	grid: {
		color: '#6c7178',
		opacity: 0.38,
	},
	horizon: {
		color: '#1f9a41',
		fillBelowHorizon: 'rgba(0, 0, 0, 0)',
	},
	milkyWay: {
		color: '#f2f4ff',
		opacity: 0,
		lineColor: '#f8f9ff',
		levelColors: ['#29B6F6', '#03A9F4', '#039BE5', '#0288D1', '#0277BD'],
		levelOpacities: [0.7, 0.6, 0.5, 0.4, 0.3],
		lineOpacity: 0.6,
		lineWidth: 0.65,
	},
	constellations: {
		color: '#b8bcc4',
		opacity: 0.7,
		labelColor: '#b9c1b6',
		labelFont: '10px system-ui, sans-serif',
		labelOpacity: 0.7,
		lineColor: '#FFEE58',
		lineOpacity: 0.3,
		boundaryColor: '#880E4F',
		boundaryOpacity: 0.6,
	},
	deepSky: {
		color: '#ff9d00',
		labelColor: '#ffb000',
	},
	movingBodies: {
		planetColor: '#ffb000',
		asteroidColor: '#d8d2c0',
		cometColor: '#9ee7ff',
		labelColor: '#ffcc58',
	},
	selectedObject: {
		color: '#ffdf6e',
	},
	hoverHighlight: {
		color: '#8ae6ff',
	},
}

const DEFAULT_OBSERVER: ObserverLocation = {
	latitude: 0,
	longitude: 0,
	elevation: 0,
}

const DEFAULT_LAYER_VISIBILITY: Record<string, boolean> = {
	background: true,
	stars: true,
	milkyWay: true,
	constellations: true,
	constellationBoundaries: false,
	constellationLabels: true,
	referenceLines: true,
	grid: true,
	horizon: true,
	deepSky: true,
	movingBodies: true,
	shapes: true,
	overlay: true,
}

const ASTRONOMICAL_DIRTY_LAYER_IDS = ['grid', 'referenceLines', 'milkyWay', 'constellations', 'constellationBoundaries', 'constellationLabels', 'deepSky', 'stars', 'movingBodies', 'shapes'] as const

const DEFAULT_STAR_OPTIONS: Required<StarLayerOptions> = {
	maxMagnitude: 9,
	colorByBV: true,
	sizeByMagnitude: true,
	maxRenderStars: Number.POSITIVE_INFINITY,
	labels: true,
}

const DEFAULT_REFERENCE_LINES_OPTIONS: ResolvedReferenceLinesOptions = {
	localMeridian: {
		enabled: true,
		color: 'rgba(136, 210, 255, 0.8)',
		lineWidth: 0.85,
	},
	celestialEquator: {
		enabled: true,
		color: 'rgba(255, 210, 96, 0.8)',
		lineWidth: 0.85,
	},
	ecliptic: {
		enabled: true,
		color: 'rgba(231, 120, 255, 0.8)',
		lineWidth: 0.85,
	},
}

const DEFAULT_INTERACTION_OPTIONS: Required<InteractionOptions> = {
	enabled: true,
	minZoom: 0.35,
	maxZoom: 1000,
	pickRadius: 7,
	pointerMoveThrottleMs: 32,
	preferD3Zoom: true,
	wheelZoomSpeed: 0.0004,
}

// Returns true for finite numbers only.
function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function normalizedWheelDeltaY(event: WheelEvent) {
	if (event.deltaMode === 1) return event.deltaY * WHEEL_DELTA_LINE_PIXELS
	if (event.deltaMode === 2) return event.deltaY * WHEEL_DELTA_PAGE_PIXELS
	return event.deltaY
}

// Converts a unix epoch in milliseconds into a Julian date.
function julianDate(date: number) {
	return date / DAY_MS + JULIAN_EPOCH
}

// Converts a unix epoch in milliseconds into a Julian epoch year.
function julianEpochYear(date: number) {
	return J2000_EPOCH + (date - J2000_UNIX_MS) / YEAR_MS
}

// Computes Greenwich mean sidereal time in radians.
function greenwichMeanSiderealTime(date: number) {
	const jd = julianDate(date)
	const t = (jd - 2451545) / 36525
	const degrees = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000
	return normalizeAngle(deg(degrees))
}

// Computes local sidereal time in radians.
function localSiderealTime(date: number, longitudeDegrees: number) {
	return normalizeAngle(greenwichMeanSiderealTime(date) + deg(longitudeDegrees))
}

// Writes an RA/Dec unit vector.
function writeRaDecUnitVector(ra: number, dec: number, out: NumberArray, offset = 0) {
	if (Math.abs(Math.abs(dec) - PIOVERTWO) <= POLE_EPSILON) {
		out[offset] = 0
		out[offset + 1] = 0
		out[offset + 2] = dec < 0 ? -1 : 1
		return
	}

	const cosDec = Math.cos(dec)
	out[offset] = cosDec * Math.cos(ra)
	out[offset + 1] = cosDec * Math.sin(ra)
	out[offset + 2] = Math.sin(dec)
}

// Writes a horizontal unit vector from azimuth/altitude.
function writeHorizontalUnitVector(az: number, alt: number, out: NumberArray, offset = 0) {
	const cosAlt = Math.cos(alt)
	out[offset] = cosAlt * Math.sin(az)
	out[offset + 1] = cosAlt * Math.cos(az)
	out[offset + 2] = Math.sin(alt)
}

// Computes a global equatorial-to-horizontal matrix.
function writeEquatorialToHorizontalMatrix(time: number, observer: ObserverLocation, out: NumberArray) {
	const lst = localSiderealTime(time, observer.longitude)
	const lat = observer.latitude * DEG2RAD
	const sinLst = Math.sin(lst)
	const cosLst = Math.cos(lst)
	const sinLat = Math.sin(lat)
	const cosLat = Math.cos(lat)

	out[0] = -sinLst
	out[1] = cosLst
	out[2] = 0
	out[3] = -sinLat * cosLst
	out[4] = -sinLat * sinLst
	out[5] = cosLat
	out[6] = cosLat * cosLst
	out[7] = cosLat * sinLst
	out[8] = sinLat
}

// Multiplies a 3x3 matrix by a vector.
function multiplyMatrixVector(matrix: Float64Array, x: number, y: number, z: number, out: NumberArray, offset = 0) {
	out[offset] = matrix[0] * x + matrix[1] * y + matrix[2] * z
	out[offset + 1] = matrix[3] * x + matrix[4] * y + matrix[5] * z
	out[offset + 2] = matrix[6] * x + matrix[7] * y + matrix[8] * z
}

// Normalizes a 3D vector in place.
function normalizeVector(out: NumberArray, offset = 0): boolean {
	const x = out[offset]
	const y = out[offset + 1]
	const z = out[offset + 2]
	const length = Math.hypot(x, y, z)

	if (length <= 1e-12) return false

	out[offset] = x / length
	out[offset + 1] = y / length
	out[offset + 2] = z / length
	return true
}

// Writes a cross product.
function writeCross(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: NumberArray, offset = 0) {
	out[offset] = ay * bz - az * by
	out[offset + 1] = az * bx - ax * bz
	out[offset + 2] = ax * by - ay * bx
}

// Computes angular distance between two unit vectors.
function angularDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
	return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1))
}

const WRITE_VIEW_MATRIX_WORK = new Float32Array(6)

// Writes a view matrix from a center vector and a stable reference up vector.
function writeViewMatrix(center: NumberArray, referenceUp: NumberArray, out: NumberArray) {
	const work = WRITE_VIEW_MATRIX_WORK

	work[0] = center[0]
	work[1] = center[1]
	work[2] = center[2]

	if (!normalizeVector(work)) {
		work[0] = 0
		work[1] = 0
		work[2] = 1
	}

	writeCross(referenceUp[0], referenceUp[1], referenceUp[2], work[0], work[1], work[2], work, 3)

	if (!normalizeVector(work, 3)) {
		writeCross(1, 0, 0, work[0], work[1], work[2], work, 3)
		normalizeVector(work, 3)
	}

	writeCross(work[0], work[1], work[2], work[3], work[4], work[5], out, 3)
	normalizeVector(out, 3)

	out[0] = work[3]
	out[1] = work[4]
	out[2] = work[5]
	out[6] = work[0]
	out[7] = work[1]
	out[8] = work[2]
}

// Projects a view-space unit vector into normalized plane coordinates.
function projectViewVector(type: ProjectionType, x: number, y: number, z: number, out: NumberArray) {
	const visibleZ = Math.max(0, z)

	switch (type) {
		case 'azimuthalEquidistant': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const theta = Math.acos(clamp(visibleZ, -1, 1))

			if (theta <= 1e-9) {
				out[0] = 0
				out[1] = 0
				return true
			}

			const sinTheta = Math.sin(theta)

			if (Math.abs(sinTheta) <= 1e-9) {
				return false
			}

			const k = theta / (PIOVERTWO * sinTheta)
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'azimuthalEqualArea': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const k = 1 / Math.sqrt(1 + visibleZ)
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'orthographic': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			out[0] = x
			out[1] = y
			return true
		}
		case 'stereographic': {
			if (z < -HORIZON_EPSILON) {
				return false
			}

			const d = 1 + visibleZ

			if (d <= 1e-9) {
				return false
			}

			const k = 1 / d
			out[0] = x * k
			out[1] = y * k
			return true
		}
		case 'gnomonic': {
			if (z <= 0.02) {
				return false
			}

			out[0] = x / z
			out[1] = y / z
			return Math.abs(out[0]) < 8 && Math.abs(out[1]) < 8
		}
	}
}

// Inverts normalized projection-plane coordinates into a view-space unit vector.
function unprojectViewVector(type: ProjectionType, x: number, y: number, out: NumberArray) {
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false

	let px = x
	let py = y
	let rho = Math.hypot(px, py)

	if (isFiniteDiskProjection(type)) {
		if (rho > 1 + HORIZON_EPSILON) {
			return false
		}

		if (rho > 1) {
			px /= rho
			py /= rho
			rho = 1
		}
	}

	if (rho <= 1e-12) {
		out[0] = 0
		out[1] = 0
		out[2] = 1
		return true
	}

	switch (type) {
		case 'azimuthalEquidistant': {
			const theta = rho * PIOVERTWO
			const k = Math.sin(theta) / rho
			out[0] = px * k
			out[1] = py * k
			out[2] = Math.cos(theta)
			return true
		}
		case 'azimuthalEqualArea': {
			const z = 1 - rho * rho
			const k = Math.sqrt(Math.max(0, 1 + z))
			out[0] = px * k
			out[1] = py * k
			out[2] = z
			return true
		}
		case 'orthographic':
			out[0] = px
			out[1] = py
			out[2] = Math.sqrt(Math.max(0, 1 - rho * rho))
			return true
		case 'stereographic': {
			const d = 1 + rho * rho
			out[0] = (2 * px) / d
			out[1] = (2 * py) / d
			out[2] = (1 - rho * rho) / d
			return true
		}
		case 'gnomonic': {
			out[0] = px
			out[1] = py
			out[2] = 1
			return normalizeVector(out)
		}
	}
}

// Applies the current screen transform to a base screen coordinate.
function applyViewTransform(x: number, y: number, width: number, height: number, transform: ViewTransform, out: NumberArray) {
	out[0] = width / 2 + transform.x + (x - width / 2) * transform.k
	out[1] = height / 2 + transform.y + (y - height / 2) * transform.k
}

function isPointInsideViewportMargin(x: number, y: number, width: number, height: number, margin: number) {
	return x >= -margin && x <= width + margin && y >= -margin && y <= height + margin
}

// Returns the screen radius used by finite azimuthal projection disks.
function projectionScale(width: number, height: number, projection: ProjectionType) {
	const size = Math.min(width, height)
	switch (projection) {
		case 'stereographic':
		case 'azimuthalEqualArea':
		case 'azimuthalEquidistant':
		case 'orthographic':
			return Math.max(1, size / 2 - PROJECTION_PADDING)
		case 'gnomonic':
			return size * 0.2
	}
}

function isFiniteDiskProjection(projection: ProjectionType): boolean {
	return projection !== 'gnomonic'
}

// Checks whether a projection type is supported.
function validateProjection(value: ProjectionType): ProjectionType {
	switch (value) {
		case 'azimuthalEquidistant':
		case 'azimuthalEqualArea':
		case 'orthographic':
		case 'stereographic':
		case 'gnomonic':
			return value
		default:
			return 'azimuthalEquidistant'
	}
}

// Copies and validates observer values.
function validateObserver(observer: ObserverLocation): ObserverLocation {
	return {
		latitude: clamp(isFiniteNumber(observer.latitude) ? observer.latitude : 0, -90, 90),
		longitude: clamp(isFiniteNumber(observer.longitude) ? observer.longitude : 0, -180, 180),
		elevation: isFiniteNumber(observer.elevation) ? observer.elevation : 0,
	}
}

function normalizeMilkyWayCoordinates(coordinates: MilkyWayCoordinates): MilkyWayStep[] {
	const steps: MilkyWayStep[] = []

	for (let i = 0; i < coordinates.length; i++) {
		const rings = normalizeMilkyWayPolygon(coordinates[i])
		if (rings.length > 0) steps.push({ rings })
	}

	return steps
}

function normalizeMilkyWayPolygon(polygon: MilkyWayPolygonCoordinates): MilkyWayRing[] {
	const rings: MilkyWayRing[] = []

	for (let i = 0; i < polygon.length; i++) {
		const ring = normalizeMilkyWayRing(polygon[i])
		if (ring) rings.push(ring)
	}

	return rings
}

function normalizeMilkyWayRing(ring: MilkyWayLinearRingCoordinates): MilkyWayRing | null {
	const n = ring.length
	const coordinates = new Float32Array(n * 2)
	const vectors = new Float32Array(n * 3)
	let pointCount = 0

	for (let i = 0; i < n; i++) {
		const [ra, dec] = ring[i]
		coordinates[pointCount * 2] = ra
		coordinates[pointCount * 2 + 1] = dec
		writeRaDecUnitVector(ra, dec, vectors, pointCount * 3)
		pointCount++
	}

	const closed = pointCount > 2 && milkyWayRingPointMatches(coordinates, 0, pointCount - 1)

	if (closed) {
		pointCount--
	}

	if (pointCount < 2) return null

	return { vectors: vectors.subarray(0, pointCount * 3), pointCount, closed }
}

function milkyWayRingPointMatches(coordinates: Float32Array, a: number, b: number) {
	const ai = a * 2
	const bi = b * 2
	return Math.abs(coordinates[ai] - coordinates[bi]) <= 1e-7 && Math.abs(coordinates[ai + 1] - coordinates[bi + 1]) <= 1e-7
}

// Deep-merges theme options without mutating defaults.
function mergeTheme(theme?: PartialThemeOptions): ThemeOptions {
	return {
		background: theme?.background ?? DEFAULT_THEME.background,
		stars: { ...DEFAULT_THEME.stars, ...theme?.stars },
		grid: { ...DEFAULT_THEME.grid, ...theme?.grid },
		horizon: { ...DEFAULT_THEME.horizon, ...theme?.horizon },
		milkyWay: { ...DEFAULT_THEME.milkyWay, ...theme?.milkyWay },
		constellations: { ...DEFAULT_THEME.constellations, ...theme?.constellations },
		deepSky: { ...DEFAULT_THEME.deepSky, ...theme?.deepSky },
		movingBodies: { ...DEFAULT_THEME.movingBodies, ...theme?.movingBodies },
		selectedObject: { ...DEFAULT_THEME.selectedObject, ...theme?.selectedObject },
		hoverHighlight: { ...DEFAULT_THEME.hoverHighlight, ...theme?.hoverHighlight },
	}
}

function mergeReferenceLines(referenceLines?: ReferenceLinesOptions): ResolvedReferenceLinesOptions {
	return {
		localMeridian: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.localMeridian, referenceLines?.localMeridian),
		celestialEquator: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.celestialEquator, referenceLines?.celestialEquator),
		ecliptic: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.ecliptic, referenceLines?.ecliptic),
	}
}

function mergeReferenceLine(defaults: ResolvedReferenceLineOptions, options?: ReferenceLineOptions): ResolvedReferenceLineOptions {
	return {
		enabled: options?.enabled ?? defaults.enabled,
		color: options?.color ?? defaults.color,
		lineWidth: Math.max(0.1, options?.lineWidth ?? defaults.lineWidth),
	}
}

// Normalizes options into a fully usable shape.
function resolveOptions(options: CelestialOptions): ResolvedCelestialOptions {
	const layers: Record<string, boolean> = { ...DEFAULT_LAYER_VISIBILITY }
	const interactions = { ...DEFAULT_INTERACTION_OPTIONS, ...options.interactions }
	interactions.wheelZoomSpeed = clamp(isFiniteNumber(interactions.wheelZoomSpeed) ? interactions.wheelZoomSpeed : DEFAULT_INTERACTION_OPTIONS.wheelZoomSpeed, 0.00005, 0.01)

	for (const [id, visible] of Object.entries(options.layers ?? {})) {
		if (typeof visible === 'boolean') {
			layers[id] = visible
		}
	}

	return {
		width: Math.max(1, Math.floor(options.width ?? DEFAULT_WIDTH)),
		height: Math.max(1, Math.floor(options.height ?? DEFAULT_HEIGHT)),
		projection: validateProjection(options.projection ?? 'stereographic'),
		coordinateSystem: options.coordinateSystem ?? 'horizontal',
		observer: DEFAULT_OBSERVER,
		time: Date.now(),
		updateInterval: Math.max(1, Math.floor(options.updateInterval ?? DEFAULT_UPDATE_INTERVAL)),
		stars: { ...DEFAULT_STAR_OPTIONS, ...options.stars },
		referenceLines: mergeReferenceLines(options.referenceLines),
		layers,
		theme: mergeTheme(options.theme),
		interactions,
	}
}

// Creates an HTML canvas or OffscreenCanvas for sprite caches.
function createScratchCanvas(width: number, height: number): CanvasImage {
	if (typeof OffscreenCanvas !== 'undefined') {
		return new OffscreenCanvas(width, height)
	}

	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	return canvas
}

// Returns a 2D context for a scratch canvas.
function getScratchContext(canvas: CanvasImage): OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null {
	return canvas.getContext('2d')
}

// Converts B-V color index into a coarse star color.
function bvToColor(bv: number) {
	const t = clamp((bv + 0.4) / 2.4, 0, 1)
	const r = Math.round(155 + 100 * t)
	const g = Math.round(185 + 55 * (1 - Math.abs(t - 0.55)))
	const b = Math.round(255 - 135 * t)
	return `rgb(${r}, ${g}, ${b})`
}

// Builds star sprite buckets for fast drawing.
function buildStarStyles(theme: ThemeOptions, starOptions: Required<StarLayerOptions>): StarStyle[] {
	const styles: StarStyle[] = []

	for (let colorBucket = 0; colorBucket < STAR_COLOR_BUCKETS; colorBucket++) {
		const color = starOptions.colorByBV ? bvToColor(-0.4 + (colorBucket / (STAR_COLOR_BUCKETS - 1)) * 2.4) : theme.stars.baseColor

		for (let radiusBucket = 0; radiusBucket < STAR_RADIUS_BUCKETS; radiusBucket++) {
			const radius = theme.stars.minRadius + (radiusBucket / (STAR_RADIUS_BUCKETS - 1)) * (theme.stars.maxRadius - theme.stars.minRadius)
			styles.push(createStarStyle(color, radius))
		}
	}

	return styles
}

// Creates a single star sprite style.
function createStarStyle(color: string, radius: number): StarStyle {
	const size = Math.max(3, Math.ceil(radius * 2 + 2))
	const sprite = createScratchCanvas(size, size)
	const ctx = getScratchContext(sprite)

	if (ctx) {
		ctx.clearRect(0, 0, size, size)
		ctx.fillStyle = color
		ctx.beginPath()
		ctx.arc(size / 2, size / 2, radius, 0, TAU)
		ctx.fill()
	}

	return { color, radius, sprite, halfSize: size / 2 }
}

// Resolves a DOM container from an element or selector.
function resolveContainer(container: HTMLElement | string): HTMLElement {
	if (typeof container !== 'string') {
		return container
	}

	const element = document.querySelector(container)

	if (!(element instanceof HTMLElement)) {
		throw new Error(`Celestial container not found: ${container}`)
	}

	return element
}

// Style bucket used by StarLayer.
interface StarStyle {
	readonly color: string
	readonly radius: number
	readonly sprite: CanvasImage
	readonly halfSize: number
}

type StarId = string | number

// High-performance star catalog storage.
export class StarCatalog {
	readonly ra: NumberArray
	readonly dec: NumberArray
	readonly mag: NumberArray
	readonly bv?: NumberArray
	readonly eqX: NumberArray
	readonly eqY: NumberArray
	readonly eqZ: NumberArray
	readonly screenX: NumberArray
	readonly screenY: NumberArray
	readonly visible: NumberArray
	readonly labelVisible: NumberArray
	readonly flags?: NumberArray
	readonly names?: readonly string[]
	readonly ids?: readonly StarId[]
	readonly namedIndices?: Int32Array
	readonly count: number

	private readonly pmRA?: NumberArray
	private readonly pmDEC?: NumberArray
	private readonly epochs?: NumberArray
	private readonly styleBucket: Uint16Array
	private readonly visibleIndices: NumberArray
	private readonly bucketedVisibleIndices: NumberArray
	private readonly labelVisibleIndices: NumberArray
	private readonly bucketCounts = new Int32Array(STAR_STYLE_BUCKETS)
	private readonly bucketStarts = new Int32Array(STAR_STYLE_BUCKETS + 1)
	private readonly bucketWriteOffsets = new Int32Array(STAR_STYLE_BUCKETS)
	private preparedEpoch = Number.NaN

	visibleCount = 0
	labelVisibleCount = 0

	constructor(input: readonly Star[] | StarCatalogInput) {
		const data = normalizeStarInput(input)
		this.count = data.count
		this.ra = data.ra
		this.dec = data.dec
		this.mag = data.mag
		this.bv = data.bv
		this.flags = data.flags
		this.names = data.names
		this.ids = data.ids
		this.namedIndices = data.names ? collectNamedIndices(data.names, data.count) : undefined
		this.pmRA = data.pmRA
		this.pmDEC = data.pmDEC
		this.epochs = data.epochs
		this.eqX = new Float32Array(this.count)
		this.eqY = new Float32Array(this.count)
		this.eqZ = new Float32Array(this.count)
		this.screenX = new Float32Array(this.count)
		this.screenY = new Float32Array(this.count)
		this.visible = new Uint8Array(this.count)
		this.labelVisible = new Uint8Array(this.count)
		this.styleBucket = new Uint16Array(this.count)
		this.visibleIndices = new Int32Array(this.count)
		this.bucketedVisibleIndices = new Int32Array(this.count)
		this.labelVisibleIndices = new Int32Array(this.count)
		this.updateEquatorialVectors(J2000_EPOCH, true)
	}

	private static readonly EQUATORIAL_VECTOR = new Float32Array(3)

	// Applies proper motion and refreshes equatorial unit vectors when needed.
	updateEquatorialVectors(epochYear: number, force = false) {
		if (!force && Math.abs(this.preparedEpoch - epochYear) < 1e-4) return

		const vector = StarCatalog.EQUATORIAL_VECTOR

		for (let i = 0; i < this.count; i++) {
			const epoch = this.epochs?.[i] ?? J2000_EPOCH
			const dt = epochYear - epoch
			const ra = normalizeAngle(this.ra[i] + (this.pmRA?.[i] ?? 0) * dt)
			const dec = clamp(this.dec[i] + (this.pmDEC?.[i] ?? 0) * dt, -PIOVERTWO, PIOVERTWO)
			writeRaDecUnitVector(ra, dec, vector)
			this.eqX[i] = vector[0]
			this.eqY[i] = vector[1]
			this.eqZ[i] = vector[2]
		}

		this.preparedEpoch = epochYear
	}

	// Refreshes cached style buckets outside the draw loop.
	cacheStyleBuckets(options: Required<StarLayerOptions>, theme: ThemeOptions) {
		const minMag = theme.stars.magnitudeScale[0]
		const maxMag = theme.stars.magnitudeScale[1]
		const magRange = Math.max(0.01, maxMag - minMag)

		for (let i = 0; i < this.count; i++) {
			const mag = this.mag[i]
			const brightness = 1 - clamp((mag - minMag) / magRange, 0, 1)
			const radiusBucket = options.sizeByMagnitude ? clamp(Math.floor(brightness * STAR_RADIUS_BUCKETS), 0, STAR_RADIUS_BUCKETS - 1) : Math.floor(STAR_RADIUS_BUCKETS / 2)
			const bv = this.bv?.[i] ?? 0.65
			const colorBucket = options.colorByBV ? clamp(Math.floor(((clamp(bv, -0.4, 2) + 0.4) / 2.4) * STAR_COLOR_BUCKETS), 0, STAR_COLOR_BUCKETS - 1) : Math.floor(STAR_COLOR_BUCKETS / 2)
			this.styleBucket[i] = colorBucket * STAR_RADIUS_BUCKETS + radiusBucket
		}
	}

	// Starts a projection pass.
	beginProjection() {
		this.visible.fill(0)
		this.bucketCounts.fill(0)
		this.visibleCount = 0
	}

	// Records one visible projected star.
	recordVisible(index: number, x: number, y: number) {
		this.visible[index] = 1
		this.screenX[index] = x
		this.screenY[index] = y
		this.visibleIndices[this.visibleCount++] = index
		this.bucketCounts[this.styleBucket[index]]++
	}

	beginLabelRender() {
		for (let i = 0; i < this.labelVisibleCount; i++) {
			this.labelVisible[this.labelVisibleIndices[i]] = 0
		}

		this.labelVisibleCount = 0
	}

	recordLabelVisible(index: number) {
		if (this.labelVisible[index]) return

		this.labelVisible[index] = 1
		this.labelVisibleIndices[this.labelVisibleCount++] = index
	}

	// Builds contiguous style buckets for renderer state locality.
	finalizeProjectionBuckets() {
		let cursor = 0

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			this.bucketStarts[bucket] = cursor
			cursor += this.bucketCounts[bucket]
		}

		this.bucketStarts[STAR_STYLE_BUCKETS] = cursor

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			this.bucketWriteOffsets[bucket] = this.bucketStarts[bucket]
		}

		for (let i = 0; i < this.visibleCount; i++) {
			const index = this.visibleIndices[i]
			const bucket = this.styleBucket[index]
			this.bucketedVisibleIndices[this.bucketWriteOffsets[bucket]++] = index
		}
	}

	// Iterates visible stars grouped by style bucket.
	forEachBucket(callback: (bucket: number, indices: NumberArray, start: number, end: number) => void) {
		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			const start = this.bucketStarts[bucket]
			const end = this.bucketStarts[bucket + 1]

			if (end > start) {
				callback(bucket, this.bucketedVisibleIndices, start, end)
			}
		}
	}

	// Resolves a star object for event payloads.
	getObject(index: number): CelestialObject {
		return {
			type: 'star',
			index,
			id: this.ids?.[index],
			name: this.names?.[index],
			mag: this.mag[index],
			ra: this.ra[index],
			dec: this.dec[index],
		}
	}

	// Exposes style buckets to internal renderers without object allocation.
	getStyleBucket(index: number) {
		return this.styleBucket[index]
	}

	// Exposes bucketed indices to internal picking without extra copies.
	getBucketedVisibleIndices() {
		return this.bucketedVisibleIndices
	}

	getBucketStart(bucket: number) {
		return this.bucketStarts[bucket]
	}

	getBucketEnd(bucket: number) {
		return this.bucketStarts[bucket + 1]
	}
}

// Normalizes object-array and typed-array star inputs into typed arrays.
function normalizeStarInput(input: readonly Star[] | StarCatalogInput) {
	if ('ra' in input) {
		const count = Math.min(input.count ?? input.ra.length, input.ra.length, input.dec.length)
		const ra = copyFloat32(input.ra, count, 0, normalizeAngle)
		const dec = copyFloat32(input.dec, count, 0, (value) => clamp(value, -PIOVERTWO, PIOVERTWO))
		const mag = input.mag ? copyFloat32(input.mag, count, 99) : fillFloat32(count, 99)
		const bv = input.bv ? copyFloat32(input.bv, count, 0.65) : undefined
		const pmRA = input.pmRA ? copyFloat32(input.pmRA, count, 0) : undefined
		const pmDEC = input.pmDEC ? copyFloat32(input.pmDEC, count, 0) : undefined
		const flags = input.flags ? copyUint8(input.flags, count) : undefined
		const epochs = fillFloat32(count, input.epoch ?? J2000_EPOCH)

		return { count, ra, dec, mag, bv, pmRA, pmDEC, flags, epochs, names: input.names, ids: input.ids } as const
	} else {
		const count = input.length
		const ra = new Float32Array(count)
		const dec = new Float32Array(count)
		const mag = new Float32Array(count)
		const bv = new Float32Array(count)
		const pmRA = new Float32Array(count)
		const pmDEC = new Float32Array(count)
		const flags = new Uint8ClampedArray(count)
		const epochs = new Float32Array(count)
		const names: string[] = []
		const ids: StarId[] = []
		let hasBv = false
		let hasPm = false
		let hasFlags = false
		let hasNames = false
		let hasIds = false

		for (let i = 0; i < count; i++) {
			const star = input[i]

			ra[i] = normalizeAngle(isFiniteNumber(star.rightAscension) ? star.rightAscension : 0)
			dec[i] = clamp(isFiniteNumber(star.declination) ? star.declination : 0, -PIOVERTWO, PIOVERTWO)
			mag[i] = isFiniteNumber(star.magnitude) ? star.magnitude : 99

			if (isFiniteNumber(star.bv)) {
				bv[i] = star.bv
				hasBv = true
			}

			if (isFiniteNumber(star.pmRA) || isFiniteNumber(star.pmDEC)) {
				pmRA[i] = star.pmRA ?? 0
				pmDEC[i] = star.pmDEC ?? 0
				hasPm = true
			}

			if (isFiniteNumber(star.flags)) {
				flags[i] = star.flags
				hasFlags = true
			}

			epochs[i] = isFiniteNumber(star.epoch) ? star.epoch : J2000_EPOCH

			if (star.name) {
				names[i] = star.name
				hasNames = true
			}

			if (star.id) {
				ids[i] = star.id
				hasIds = true
			}
		}

		return {
			count,
			ra,
			dec,
			mag,
			bv: hasBv ? bv : undefined,
			pmRA: hasPm ? pmRA : undefined,
			pmDEC: hasPm ? pmDEC : undefined,
			flags: hasFlags ? flags : undefined,
			epochs,
			names: hasNames ? names : undefined,
			ids: hasIds ? ids : undefined,
		} as const
	}
}

// Builds a compact index of labelable stars so render scans avoid unnamed catalog rows.
function collectNamedIndices(names: readonly string[], count: number) {
	let namedCount = 0

	for (let i = 0; i < count; i++) {
		if (names[i]) {
			namedCount++
		}
	}

	const indices = new Int32Array(namedCount)
	let cursor = 0

	for (let i = 0; i < count; i++) {
		if (names[i]) {
			indices[cursor++] = i
		}
	}

	return indices
}

// Copies finite values into a Float32Array.
function copyFloat32(source: NumberArray, count: number, fallback: number, map?: (value: number) => number) {
	const output = new Float32Array(count)

	for (let i = 0; i < count; i++) {
		const value = source[i]
		output[i] = isFiniteNumber(value) ? (map ? map(value) : value) : fallback
	}

	return output
}

// Fills a Float32Array with one value.
function fillFloat32(count: number, value: number) {
	const output = new Float32Array(count)
	output.fill(value)
	return output
}

// Copies flags into a Uint8Array.
function copyUint8(source: NumberArray, count: number) {
	const output = new Uint8ClampedArray(count)
	for (let i = 0; i < count; i++) output[i] = Math.floor(source[i] ?? 0)
	return output
}

// Fixed-grid spatial index for screen-space picking.
class FixedGridSpatialIndex {
	private cellSize = 24
	private columns = 1
	private rows = 1
	private heads = new Int32Array(1)
	private next = new Int32Array(0)
	private type = new Uint8Array(0)
	private index = new Int32Array(0)
	private x = new Float32Array(0)
	private y = new Float32Array(0)
	private mag = new Float32Array(0)
	private readonly nearest: MutablePickIndex = { type: 0, index: 0 }
	private count = 0

	// Resets grid dimensions and clears entries.
	reset(width: number, height: number, cellSize: number) {
		this.cellSize = Math.max(4, cellSize)
		this.columns = Math.max(1, Math.ceil(width / this.cellSize))
		this.rows = Math.max(1, Math.ceil(height / this.cellSize))
		const neededCells = this.columns * this.rows

		if (this.heads.length !== neededCells) {
			this.heads = new Int32Array(neededCells)
		}

		this.heads.fill(-1)
		this.count = 0
	}

	// Adds a pickable screen-space object.
	add(type: number, index: number, x: number, y: number, mag = 99) {
		if (x < 0 || y < 0) return

		const cellX = Math.floor(x / this.cellSize)
		const cellY = Math.floor(y / this.cellSize)
		if (cellX < 0 || cellY < 0 || cellX >= this.columns || cellY >= this.rows) return

		this.ensureCapacity(this.count + 1)
		const entry = this.count++
		const cell = cellY * this.columns + cellX
		this.type[entry] = type
		this.index[entry] = index
		this.x[entry] = x
		this.y[entry] = y
		this.mag[entry] = mag
		this.next[entry] = this.heads[cell]
		this.heads[cell] = entry
	}

	// Finds nearest object within a radius.
	findNearest(x: number, y: number, radius: number): PickIndex | null {
		const minCellX = clamp(Math.floor((x - radius) / this.cellSize), 0, this.columns - 1)
		const maxCellX = clamp(Math.floor((x + radius) / this.cellSize), 0, this.columns - 1)
		const minCellY = clamp(Math.floor((y - radius) / this.cellSize), 0, this.rows - 1)
		const maxCellY = clamp(Math.floor((y + radius) / this.cellSize), 0, this.rows - 1)
		const radiusSq = radius * radius
		let bestEntry = -1
		let bestScore = Number.POSITIVE_INFINITY

		for (let cy = minCellY; cy <= maxCellY; cy++) {
			for (let cx = minCellX; cx <= maxCellX; cx++) {
				let entry = this.heads[cy * this.columns + cx]

				while (entry >= 0) {
					const dx = this.x[entry] - x
					const dy = this.y[entry] - y
					const distanceSq = dx * dx + dy * dy

					if (distanceSq <= radiusSq) {
						const priority = this.type[entry] === PICK_TYPE_STAR ? Math.max(0, this.mag[entry] + 2) : Math.min(-4, this.mag[entry])
						const score = distanceSq + priority
						if (score < bestScore) {
							bestScore = score
							bestEntry = entry
						}
					}

					entry = this.next[entry]
				}
			}
		}

		if (bestEntry < 0) {
			return null
		}

		this.nearest.type = this.type[bestEntry]
		this.nearest.index = this.index[bestEntry]
		return this.nearest
	}

	// Returns the number of indexed objects.
	get size() {
		return this.count
	}

	// Ensures typed arrays can hold the requested capacity.
	private ensureCapacity(capacity: number) {
		if (this.x.length >= capacity) return

		const nextCapacity = Math.max(capacity, Math.max(1024, this.x.length * 2))
		this.x = growFloat32(this.x, nextCapacity)
		this.y = growFloat32(this.y, nextCapacity)
		this.mag = growFloat32(this.mag, nextCapacity)
		this.index = growInt32(this.index, nextCapacity)
		this.next = growInt32(this.next, nextCapacity)
		this.type = growUint8(this.type, nextCapacity)
	}
}

type PickIndex = {
	readonly type: number
	readonly index: number
}

type MutablePickIndex = {
	-readonly [K in keyof PickIndex]: PickIndex[K]
}

// Grows a Float32Array.
function growFloat32(source: Float32Array, capacity: number) {
	const output = new Float32Array(capacity)
	output.set(source)
	return output
}

// Grows an Int32Array.
function growInt32(source: Int32Array, capacity: number) {
	const output = new Int32Array(capacity)
	output.set(source)
	return output
}

// Grows a Uint8Array.
function growUint8(source: Uint8Array, capacity: number) {
	const output = new Uint8Array(capacity)
	output.set(source)
	return output
}

// Basic event emitter with unsubscribe support.
class EventEmitter {
	private readonly callbacks = new Map<CelestialEventName, Set<AnyCelestialEventCallback>>()

	// Registers an event callback.
	on<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): () => void {
		let callbacks = this.callbacks.get(eventName)

		if (!callbacks) {
			callbacks = new Set()
			this.callbacks.set(eventName, callbacks)
		}

		callbacks.add(callback as AnyCelestialEventCallback)

		return () => this.off(eventName, callback)
	}

	// Removes an event callback.
	off<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>) {
		this.callbacks.get(eventName)?.delete(callback as AnyCelestialEventCallback)
	}

	// Checks if any callbacks are registered for an event.
	has(eventName: CelestialEventName) {
		const callbacks = this.callbacks.get(eventName)
		return callbacks !== undefined && callbacks.size > 0
	}

	// Emits an event payload.
	emit<K extends CelestialEventName>(eventName: K, payload: CelestialEventMap[K]) {
		const callbacks = this.callbacks.get(eventName)
		if (!callbacks) return

		for (const callback of callbacks) {
			callback(payload, eventName)
		}
	}

	// Clears all callbacks.
	clear() {
		this.callbacks.clear()
	}
}

// Internal layer adds dirty-flag behavior to the public interface.
abstract class InternalLayer implements Layer {
	visible = true
	dirty = true

	constructor(
		readonly id: string,
		readonly zIndex: number,
	) {}

	destroy() {}

	// Marks the layer for redraw.
	markDirty() {
		this.dirty = true
	}

	// Marks the layer clean after redraw.
	markClean() {
		this.dirty = false
	}

	abstract render(ctx: CanvasRenderingContext2D, state: RenderState): void
}

// Solid background layer.
class BackgroundLayer extends InternalLayer {
	constructor() {
		super('background', 0)
	}

	// Draws the sky background.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.fillStyle = state.theme.background
		ctx.fillRect(0, 0, state.width, state.height)
	}
}

function projectionCenterX(state: RenderState) {
	return state.width / 2 + state.transform.x
}

function projectionCenterY(state: RenderState) {
	return state.height / 2 + state.transform.y
}

function transformedProjectionRadius(state: RenderState) {
	return state.projectionRadius * state.transform.k
}

function clipProjectionDisk(ctx: CanvasRenderingContext2D, state: RenderState) {
	ctx.beginPath()
	ctx.arc(projectionCenterX(state), projectionCenterY(state), transformedProjectionRadius(state), 0, TAU)
	ctx.clip()
}

function drawProjectionBoundary(ctx: CanvasRenderingContext2D, state: RenderState) {
	const radius = Math.max(0, transformedProjectionRadius(state) - 0.5)
	ctx.beginPath()
	ctx.arc(projectionCenterX(state), projectionCenterY(state), radius, 0, TAU)
	ctx.stroke()
}

function projectedSegmentLimit(state: RenderState) {
	return Math.max(96, transformedProjectionRadius(state) * 0.75)
}

function appendProjectedPoint(ctx: CanvasRenderingContext2D, state: RenderState, point: NumberArray, previous: NumberArray, started: boolean): boolean {
	if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) return false

	const dx = point[0] - previous[0]
	const dy = point[1] - previous[1]
	const maxDistance = projectedSegmentLimit(state)

	if (!started || dx * dx + dy * dy > maxDistance * maxDistance) {
		ctx.moveTo(point[0], point[1])
	} else {
		ctx.lineTo(point[0], point[1])
	}

	previous[0] = point[0]
	previous[1] = point[1]
	return true
}

type ProjectedSampler = (t: number, out: NumberArray) => number

function writeProjectedSample(out: NumberArray, visibility: number, projected: boolean) {
	if (!projected) {
		out[0] = Number.NaN
		out[1] = Number.NaN
	}

	return visibility
}

function isProjectedSample(out: NumberArray) {
	return Number.isFinite(out[0]) && Number.isFinite(out[1])
}

function drawClippedPolyline(ctx: CanvasRenderingContext2D, state: RenderState, steps: number, point: NumberArray, previous: NumberArray, sampler: ProjectedSampler) {
	let previousT = 0
	let previousVisibility = Number.NaN
	let previousProjected = false
	let started = false

	for (let i = 0; i <= steps; i++) {
		const t = i / steps
		const visibility = sampler(t, point)
		const projected = isProjectedSample(point)
		const visible = visibility >= -HORIZON_EPSILON && projected

		if (i > 0 && Number.isFinite(previousVisibility) && previousVisibility * visibility < 0) {
			const intersectionT = findHorizonIntersection(previousT, previousVisibility, t, visibility, sampler, point)
			sampler(intersectionT, point)

			if (isProjectedSample(point)) {
				started = appendProjectedPoint(ctx, state, point, previous, started)

				if (!visible) {
					started = false
				}
			}

			if (visible) {
				sampler(t, point)
			}
		}

		if (visible) {
			started = appendProjectedPoint(ctx, state, point, previous, started)
		} else if (!previousProjected || visibility < -HORIZON_EPSILON) {
			started = false
		}

		previousT = t
		previousVisibility = visibility
		previousProjected = projected
	}
}

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

function skyLabelSize(state: RenderState, baseSize: number) {
	const size = clamp(baseSize * Math.sqrt(state.transform.k), baseSize, baseSize * 1.3)
	return size
}

function skyLabelFont(state: RenderState, baseSize: number) {
	return `${skyLabelSize(state, baseSize).toFixed(1)}px system-ui, sans-serif`
}

function meanObliquity(date: number) {
	const t = (julianDate(date) - 2451545) / 36525
	const seconds = 21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))
	return deg(23 + 26 / 60 + seconds / 3600)
}

// Horizon layer draws the local horizon ring over the active sky projection.
class HorizonLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)

	constructor() {
		super('horizon', 10)
	}

	// Draws horizon fill and stroke.
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

		ctx.beginPath()
		let started = false

		for (let i = 0; i <= 288; i++) {
			const az = (i / 288) * TAU
			const ok = state.projectHorizontalToScreen(az, 0, this.point)

			if (!ok) {
				started = false
				continue
			}

			started = appendProjectedPoint(ctx, state, this.point, this.previous, started)
		}

		if (started) {
			if (state.theme.horizon.fillBelowHorizon !== 'rgba(0, 0, 0, 0)') {
				ctx.closePath()
				ctx.fill()
			}

			ctx.stroke()
		}

		drawCardinalPoints(ctx, state)
		drawZenithLabel(ctx, state)
	}
}

type GridBoundaryEdge = 'circle' | 'left' | 'right' | 'top' | 'bottom'

interface GridBoundaryLabelPoint extends Readonly<Point> {
	readonly edge: GridBoundaryEdge
}

type GridBoundaryLabelRect = Point & Size

const GRID_BOUNDARY_LABEL_INSET = 8
const GRID_BOUNDARY_LABEL_PADDING_X = 3
const GRID_BOUNDARY_LABEL_PADDING_Y = 1
const GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ = 14 * 14

function projectionBoundaryFullyVisibleInViewport(state: RenderState) {
	if (!isFiniteDiskProjection(state.projection)) return false

	const cx = projectionCenterX(state)
	const cy = projectionCenterY(state)
	const radius = transformedProjectionRadius(state)

	if (radius <= 0) return false

	return cx - radius >= 0 && cx + radius <= state.width && cy - radius >= 0 && cy + radius <= state.height
}

function appendUniqueGridBoundaryLabelPoint(points: GridBoundaryLabelPoint[], point: GridBoundaryLabelPoint) {
	for (let i = 0; i < points.length; i++) {
		const dx = points[i].x - point.x
		const dy = points[i].y - point.y

		if (dx * dx + dy * dy <= GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ) return
	}

	points.push(point)
}

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

function appendViewportGridBoundaryIntersection(points: GridBoundaryLabelPoint[], state: RenderState, x0: number, y0: number, x1: number, y1: number) {
	const dx = x1 - x0
	const dy = y1 - y0
	const epsilon = 1e-7

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

function findGridBoundaryLabelPoints(state: RenderState, steps: number, point: NumberArray, sampler: ProjectedSampler, useViewportBoundary: boolean, out: GridBoundaryLabelPoint[]) {
	out.length = 0

	let previousT = 0
	let previousVisibility = Number.NaN
	let previousProjected = false
	let previousVisible = false
	let previousX = 0
	let previousY = 0

	function appendVisiblePoint(x: number, y: number, boundaryPoint: boolean) {
		if (boundaryPoint) {
			appendCircleGridBoundaryLabelPoint(out, state, x, y)
		}

		if (useViewportBoundary) {
			if (previousVisible) {
				appendViewportGridBoundaryIntersection(out, state, previousX, previousY, x, y)
			}
		}

		previousVisible = true
		previousX = x
		previousY = y
	}

	for (let i = 0; i <= steps; i++) {
		const t = i / steps
		const visibility = sampler(t, point)
		const projected = isProjectedSample(point)
		const visible = visibility >= -HORIZON_EPSILON && projected
		const sampleX = point[0]
		const sampleY = point[1]

		if (i > 0 && Number.isFinite(previousVisibility) && previousVisibility * visibility < 0) {
			const intersectionT = findHorizonIntersection(previousT, previousVisibility, t, visibility, sampler, point)
			sampler(intersectionT, point)

			if (isProjectedSample(point)) {
				if (previousVisible || visible) {
					appendVisiblePoint(point[0], point[1], true)
				}

				if (!visible) {
					previousVisible = false
				}
			}
		}

		if (visible) {
			appendVisiblePoint(sampleX, sampleY, false)
		} else if (!previousProjected || visibility < -HORIZON_EPSILON) {
			previousVisible = false
		}

		previousT = t
		previousVisibility = visibility
		previousProjected = projected
	}
}

function gridBoundaryLabelRectIntersects(a: GridBoundaryLabelRect, b: GridBoundaryLabelRect) {
	return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

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

// Grid layer draws coarse equatorial or horizontal reference lines.
class GridLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private readonly labelPoints: GridBoundaryLabelPoint[] = []
	private readonly labelRects: GridBoundaryLabelRect[] = []
	private samplerState!: RenderState
	private samplerAngle = 0

	private readonly raSampler: ProjectedSampler = (t, out) => {
		const ra = t * TAU
		const state = this.samplerState
		return writeProjectedSample(out, state.equatorialVisibility(ra, this.samplerAngle), state.projectEquatorialToScreen(ra, this.samplerAngle, out))
	}

	private readonly decSampler: ProjectedSampler = (t, out) => {
		const dec = -PIOVERTWO + t * PI
		const state = this.samplerState
		return writeProjectedSample(out, state.equatorialVisibility(this.samplerAngle, dec), state.projectEquatorialToScreen(this.samplerAngle, dec, out))
	}

	constructor() {
		super('grid', 20)
	}

	// Draws reference grid lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.strokeStyle = state.theme.grid.color
		ctx.globalAlpha = state.theme.grid.opacity
		ctx.lineWidth = 0.65

		this.renderEquatorialGrid(ctx, state)

		ctx.globalAlpha = 1
	}

	// Draws RA/Dec grid lines.
	private renderEquatorialGrid(ctx: CanvasRenderingContext2D, state: RenderState) {
		this.samplerState = state

		for (let decDeg = -85; decDeg <= 85; decDeg += 10) {
			this.samplerAngle = decDeg * DEG2RAD
			ctx.beginPath()
			drawClippedPolyline(ctx, state, 360, this.point, this.previous, this.raSampler)
			ctx.stroke()
		}

		for (let raHour = 0; raHour < 24; raHour += 1) {
			this.samplerAngle = (raHour / 24) * TAU
			ctx.beginPath()
			drawClippedPolyline(ctx, state, 240, this.point, this.previous, this.decSampler)
			ctx.stroke()
		}

		this.renderEquatorialGridLabels(ctx, state)
	}

	private renderEquatorialGridLabels(ctx: CanvasRenderingContext2D, state: RenderState) {
		const useViewportBoundary = !projectionBoundaryFullyVisibleInViewport(state)
		let labelRectCount = 0
		this.samplerState = state

		ctx.save()
		ctx.globalAlpha = Math.min(0.95, Math.max(0.58, state.theme.grid.opacity + 0.28))
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'

		for (let decDeg = -85; decDeg <= 85; decDeg += 10) {
			this.samplerAngle = decDeg * DEG2RAD
			findGridBoundaryLabelPoints(state, 360, this.point, this.raSampler, useViewportBoundary, this.labelPoints)

			for (let i = 0; i < this.labelPoints.length; i++) {
				labelRectCount = drawGridBoundaryLabel(ctx, state, decDeg.toFixed(0), this.labelPoints[i], this.labelRects, labelRectCount)
			}
		}

		for (let raHour = 0; raHour < 24; raHour += 1) {
			this.samplerAngle = (raHour / 24) * TAU
			findGridBoundaryLabelPoints(state, 240, this.point, this.decSampler, useViewportBoundary, this.labelPoints)

			for (let i = 0; i < this.labelPoints.length; i++) {
				labelRectCount = drawGridBoundaryLabel(ctx, state, `${raHour}h`, this.labelPoints[i], this.labelRects, labelRectCount)
			}
		}

		this.labelRects.length = labelRectCount

		ctx.restore()
	}
}

// Reference-line renderer for local meridian, celestial equator, and ecliptic of date.
class ReferenceLineLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private samplerState!: RenderState
	private localMeridianAz = 0
	private localMeridianReverse = false
	private eclipticCosObliquity = 1
	private eclipticSinObliquity = 0

	private readonly localMeridianSampler: ProjectedSampler = (t, out) => {
		const state = this.samplerState
		const alt = (this.localMeridianReverse ? 1 - t : t) * PIOVERTWO
		return writeProjectedSample(out, state.horizontalVisibility(this.localMeridianAz, alt), state.projectHorizontalToScreen(this.localMeridianAz, alt, out))
	}

	private readonly celestialEquatorSampler: ProjectedSampler = (t, out) => {
		const state = this.samplerState
		const ra = t * TAU
		return writeProjectedSample(out, state.equatorialVisibility(ra, 0), state.projectEquatorialToScreen(ra, 0, out))
	}

	private readonly eclipticSampler: ProjectedSampler = (t, out) => {
		const state = this.samplerState
		const lambda = t * TAU
		const sinLambda = Math.sin(lambda)
		const ra = normalizeAngle(Math.atan2(sinLambda * this.eclipticCosObliquity, Math.cos(lambda)))
		const dec = Math.asin(clamp(sinLambda * this.eclipticSinObliquity, -1, 1))
		return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
	}

	constructor() {
		super('referenceLines', 25)
	}

	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		this.samplerState = state
		ctx.save()
		ctx.globalAlpha = 0.7
		ctx.lineCap = 'round'
		ctx.lineJoin = 'round'
		this.drawLocalMeridian(ctx, state)
		this.drawCelestialEquator(ctx, state)
		this.drawEcliptic(ctx, state)
		ctx.restore()
	}

	private drawLocalMeridian(ctx: CanvasRenderingContext2D, state: RenderState) {
		const style = state.referenceLines.localMeridian

		if (!style.enabled) return

		this.applyStyle(ctx, style)

		ctx.beginPath()
		this.localMeridianAz = 0
		this.localMeridianReverse = false
		drawClippedPolyline(ctx, state, 120, this.point, this.previous, this.localMeridianSampler)
		this.localMeridianAz = PI
		this.localMeridianReverse = true
		drawClippedPolyline(ctx, state, 120, this.point, this.previous, this.localMeridianSampler)

		ctx.stroke()
	}

	private drawCelestialEquator(ctx: CanvasRenderingContext2D, state: RenderState) {
		const style = state.referenceLines.celestialEquator

		if (!style.enabled) return

		this.applyStyle(ctx, style)

		ctx.beginPath()
		drawClippedPolyline(ctx, state, 360, this.point, this.previous, this.celestialEquatorSampler)
		ctx.stroke()
	}

	private drawEcliptic(ctx: CanvasRenderingContext2D, state: RenderState) {
		const style = state.referenceLines.ecliptic

		if (!style.enabled) return

		const obliquity = meanObliquity(state.time)
		this.eclipticCosObliquity = Math.cos(obliquity)
		this.eclipticSinObliquity = Math.sin(obliquity)
		this.applyStyle(ctx, style)

		ctx.beginPath()
		drawClippedPolyline(ctx, state, 360, this.point, this.previous, this.eclipticSampler)
		ctx.stroke()
	}

	private applyStyle(ctx: CanvasRenderingContext2D, style: ResolvedReferenceLineOptions) {
		ctx.strokeStyle = style.color
		ctx.lineWidth = style.lineWidth
	}
}

// Shared renderer for constellation line-like data.
abstract class ConstellationSegmentLayer extends InternalLayer {
	private readonly fromVector = new Float32Array(3)
	private readonly toVector = new Float32Array(3)
	private readonly sampleVector = new Float32Array(3)
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private samplerState!: RenderState

	private readonly segmentSampler: ProjectedSampler = (t, out) => {
		const u = 1 - t

		this.sampleVector[0] = this.fromVector[0] * u + this.toVector[0] * t
		this.sampleVector[1] = this.fromVector[1] * u + this.toVector[1] * t
		this.sampleVector[2] = this.fromVector[2] * u + this.toVector[2] * t

		if (!normalizeVector(this.sampleVector)) {
			return writeProjectedSample(out, Number.NaN, false)
		}

		const state = this.samplerState
		const ra = normalizeAngle(Math.atan2(this.sampleVector[1], this.sampleVector[0]))
		const dec = Math.asin(clamp(this.sampleVector[2], -1, 1))
		return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
	}

	protected drawSegments(ctx: CanvasRenderingContext2D, state: RenderState, lines: readonly ConstellationLine[], color: string, alpha: number, lineWidth: number) {
		this.samplerState = state
		ctx.strokeStyle = color
		ctx.globalAlpha = alpha
		ctx.lineWidth = lineWidth
		ctx.beginPath()

		for (const line of lines) {
			for (let j = 1, k = 0; j < line.length; j++, k++) {
				this.drawSegment(ctx, state, line[k], line[j])
			}
		}

		ctx.stroke()
		ctx.globalAlpha = 1
	}

	private drawSegment(ctx: CanvasRenderingContext2D, state: RenderState, from: ConstellationLine[number], to: ConstellationLine[number]) {
		writeRaDecUnitVector(from[0], from[1], this.fromVector)
		writeRaDecUnitVector(to[0], to[1], this.toVector)

		const distance = angularDistance(this.fromVector[0], this.fromVector[1], this.fromVector[2], this.toVector[0], this.toVector[1], this.toVector[2])
		const steps = Math.max(8, Math.min(180, Math.ceil(distance / deg(1))))

		drawClippedPolyline(ctx, state, steps, this.point, this.previous, this.segmentSampler)
	}
}

// Constellation line renderer.
class ConstellationLineLayer extends ConstellationSegmentLayer {
	constructor() {
		super('constellations', 30)
	}

	// Draws supplied constellation line segments.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const theme = state.theme.constellations
		const color = theme.lineColor || theme.color
		const opacity = theme.lineOpacity ?? theme.opacity
		this.drawSegments(ctx, state, state.constellations.lines ?? [], color, opacity, 0.9)
	}
}

const CONSTELLATION_BOUNDARY_LINE_DASH = [4, 4] as const

// Constellation boundary renderer.
class ConstellationBoundaryLayer extends ConstellationSegmentLayer {
	constructor() {
		super('constellationBoundaries', 32)
	}

	// Draws supplied constellation boundaries as dashed lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.save()
		ctx.setLineDash(CONSTELLATION_BOUNDARY_LINE_DASH)
		const theme = state.theme.constellations
		const color = theme.boundaryColor || theme.color
		const opacity = theme.boundaryOpacity ?? theme.opacity
		this.drawSegments(ctx, state, state.constellations.boundaries ?? [], color, opacity, 0.6)
		ctx.restore()
	}
}

// Milky Way renderer for d3-celestial mw.json MultiPolygon coordinate arrays.
class MilkyWayLayer extends InternalLayer {
	private readonly sampleVector = new Float32Array(3)
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private samplerState!: RenderState
	private samplerRing!: MilkyWayRing

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

		const state = this.samplerState
		const ra = normalizeAngle(Math.atan2(this.sampleVector[1], this.sampleVector[0]))
		const dec = Math.asin(clamp(this.sampleVector[2], -1, 1))
		return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
	}

	constructor() {
		super('milkyWay', 15)
	}

	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const steps = state.milkyWay

		if (steps.length === 0) return

		const theme = state.theme.milkyWay
		const fillOpacity = clamp(theme.opacity, 0, 1)
		const lineOpacity = clamp(theme.lineOpacity, 0, 1)

		if (fillOpacity <= 0 && (lineOpacity <= 0 || theme.lineWidth <= 0)) return

		this.samplerState = state
		ctx.save()

		if (isFiniteDiskProjection(state.projection)) {
			clipProjectionDisk(ctx, state)
		}

		ctx.lineWidth = theme.lineWidth
		ctx.lineJoin = 'round'
		ctx.lineCap = 'round'

		for (let i = 0; i < steps.length; i++) {
			const lineOpacityPerLevel = milkyWayLevelOpacity(theme, i)

			if (lineOpacityPerLevel <= 0) continue

			const color = milkyWayLevelColor(theme, i)

			ctx.fillStyle = color
			ctx.strokeStyle = color
			ctx.beginPath()
			this.drawStep(ctx, state, steps[i])

			// Filled clipped polygons need real polygon clipping; outlines avoid false closure segments at the projection boundary.
			// if (fillOpacity > 0 && !isFiniteDiskProjection(state.projection)) {
			// 	ctx.globalAlpha = fillOpacity
			// 	ctx.fill('evenodd')
			// }

			ctx.globalAlpha = lineOpacity * lineOpacityPerLevel
			ctx.stroke()
		}

		ctx.restore()
	}

	private drawStep(ctx: CanvasRenderingContext2D, state: RenderState, step: MilkyWayStep) {
		const rings = step.rings

		for (let i = 0; i < rings.length; i++) {
			this.drawRing(ctx, state, rings[i])
		}
	}

	private drawRing(ctx: CanvasRenderingContext2D, state: RenderState, ring: MilkyWayRing) {
		this.samplerRing = ring
		drawClippedPolyline(ctx, state, Math.max(16, milkyWayRingSegmentCount(ring)), this.point, this.previous, this.ringSampler)
	}
}

function milkyWayRingSegmentCount(ring: MilkyWayRing) {
	return ring.closed ? ring.pointCount : ring.pointCount - 1
}

function milkyWayLevelColor(theme: ThemeOptions['milkyWay'], index: number) {
	return theme.levelColors?.[index] ?? theme.lineColor
}

function milkyWayLevelOpacity(theme: ThemeOptions['milkyWay'], index: number) {
	return theme.levelOpacities?.[index] ?? 1
}

// Deep-sky object renderer.
class DeepSkyObjectLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	constructor() {
		super('deepSky', 40)
	}

	// Draws simple predictable DSO symbols.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.strokeStyle = state.theme.deepSky.color
		ctx.fillStyle = state.theme.deepSky.color
		ctx.lineWidth = 1
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'
		state.deepSkyLabelVisible.fill(0)

		for (let i = 0; i < state.dsos.length; i++) {
			const object = state.dsos[i]

			if (!isDeepSkyObjectVisible(object, state)) {
				continue
			}

			if (!state.projectEquatorialToScreen(object.rightAscension, object.declination, this.point)) {
				continue
			}

			if (!isPointInsideViewportMargin(this.point[0], this.point[1], state.width, state.height, DSO_VIEWPORT_MARGIN)) {
				continue
			}

			const radius = 4 // deepSkySymbolRadius(object, state)
			drawDsoSymbol(ctx, object.type, this.point[0], this.point[1], radius)

			if (object.name && isDeepSkyLabelVisible(object, state)) {
				ctx.fillStyle = state.theme.deepSky.labelColor

				if (positionSkyLabel(ctx, state, object.name, this.point[0], this.point[1], 10, -2, this.labelPoint)) {
					ctx.fillText(object.name, this.labelPoint[0], this.labelPoint[1])
					state.deepSkyLabelVisible[i] = 1
				}

				ctx.fillStyle = state.theme.deepSky.color
			}
		}
	}
}

// Star catalog renderer.
class StarLayer extends InternalLayer {
	private styles = buildStarStyles(DEFAULT_THEME, DEFAULT_STAR_OPTIONS)
	private styleSignature = ''
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)
	private labelIndices = new Int32Array(0)
	private labelX = new Float32Array(0)
	private labelY = new Float32Array(0)

	constructor() {
		super('stars', 50)
	}

	// Draws visible stars grouped by style bucket.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const catalog = state.starCatalog

		if (!catalog) return

		this.ensureStyles(state)

		if (state.transform.k >= VECTOR_STAR_ZOOM_THRESHOLD && catalog.visibleCount <= VECTOR_STAR_MAX_COUNT) {
			this.renderVectorStars(ctx, state, catalog)
		} else {
			this.renderSpriteStars(ctx, state, catalog)
		}

		this.renderStarLabels(ctx, state, catalog)
	}

	private renderSpriteStars(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		const { transform, width, height } = state
		const maxMagnitude = starSymbolMagnitudeLimit(state)

		ctx.save()
		ctx.translate(width / 2 + transform.x, height / 2 + transform.y)
		ctx.scale(transform.k, transform.k)
		ctx.translate(-width / 2, -height / 2)

		const indices = catalog.getBucketedVisibleIndices()

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			const start = catalog.getBucketStart(bucket)
			const end = catalog.getBucketEnd(bucket)

			if (end <= start) {
				continue
			}

			const style = this.styles[bucket]
			const margin = Math.max(2, style.halfSize * transform.k + 2)

			if (style.radius <= 0.8) {
				ctx.fillStyle = style.color

				for (let i = start; i < end; i++) {
					const index = indices[i]

					if (catalog.mag[index] > maxMagnitude) {
						continue
					}

					applyViewTransform(catalog.screenX[index], catalog.screenY[index], width, height, transform, this.point)

					if (this.point[0] < -margin || this.point[0] > width + margin || this.point[1] < -margin || this.point[1] > height + margin) {
						continue
					}

					ctx.fillRect(catalog.screenX[index], catalog.screenY[index], 1, 1)
				}
			} else {
				const sprite = style.sprite
				const halfSize = style.halfSize

				for (let i = start; i < end; i++) {
					const index = indices[i]

					if (catalog.mag[index] > maxMagnitude) {
						continue
					}

					applyViewTransform(catalog.screenX[index], catalog.screenY[index], width, height, transform, this.point)

					if (this.point[0] < -margin || this.point[0] > width + margin || this.point[1] < -margin || this.point[1] > height + margin) {
						continue
					}

					ctx.drawImage(sprite, catalog.screenX[index] - halfSize, catalog.screenY[index] - halfSize)
				}
			}
		}

		ctx.restore()
	}

	private renderVectorStars(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		const transform = state.transform
		const width = state.width
		const height = state.height
		const maxMagnitude = starSymbolMagnitudeLimit(state)
		const radiusScale = Math.min(Math.sqrt(transform.k), VECTOR_STAR_MAX_RADIUS_SCALE)
		const margin = state.theme.stars.maxRadius * VECTOR_STAR_MAX_RADIUS_SCALE + 2

		const indices = catalog.getBucketedVisibleIndices()

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			const start = catalog.getBucketStart(bucket)
			const end = catalog.getBucketEnd(bucket)

			if (end <= start) {
				continue
			}

			const style = this.styles[bucket]
			const radius = Math.max(0.75, style.radius * radiusScale)
			ctx.fillStyle = style.color
			ctx.beginPath()

			for (let i = start; i < end; i++) {
				const index = indices[i]

				if (catalog.mag[index] > maxMagnitude) {
					continue
				}

				applyViewTransform(catalog.screenX[index], catalog.screenY[index], width, height, transform, this.point)

				if (this.point[0] < -margin || this.point[0] > width + margin || this.point[1] < -margin || this.point[1] > height + margin) {
					continue
				}

				ctx.moveTo(this.point[0] + radius, this.point[1])
				ctx.arc(this.point[0], this.point[1], radius, 0, TAU)
			}

			ctx.fill()
		}
	}

	private renderStarLabels(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		catalog.beginLabelRender()

		if (!state.stars.labels || !catalog.names || !catalog.namedIndices || catalog.namedIndices.length === 0) return

		const maxMagnitude = starLabelMagnitudeLimit(state)
		let labelCount = 0
		this.ensureLabelCapacity(catalog.namedIndices.length)

		for (let i = 0; i < catalog.namedIndices.length; i++) {
			const index = catalog.namedIndices[i]
			const magnitude = catalog.mag[index]

			if (!catalog.visible[index] || magnitude > maxMagnitude) {
				continue
			}

			applyViewTransform(catalog.screenX[index], catalog.screenY[index], state.width, state.height, state.transform, this.point)

			if (this.point[0] < 0 || this.point[0] > state.width || this.point[1] < 0 || this.point[1] > state.height) {
				continue
			}

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

			if (!name || !this.positionStarLabel(ctx, state, name, this.labelX[i], this.labelY[i], this.labelPoint)) {
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

	private ensureLabelCapacity(capacity: number) {
		if (this.labelIndices.length >= capacity) return

		this.labelIndices = new Int32Array(capacity)
		this.labelX = new Float32Array(capacity)
		this.labelY = new Float32Array(capacity)
	}

	private positionStarLabel(ctx: CanvasRenderingContext2D, state: RenderState, name: string, starX: number, starY: number, out: Float32Array) {
		return positionSkyLabel(ctx, state, name, starX, starY, STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, out)
	}

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

	// Rebuilds sprite styles when theme or options change.
	private ensureStyles(state: RenderState) {
		const signature = `${state.stars.colorByBV}|${state.theme.stars.baseColor}|${state.theme.stars.minRadius}|${state.theme.stars.maxRadius}`

		if (signature === this.styleSignature) return

		this.styles = buildStarStyles(state.theme, state.stars)
		this.styleSignature = signature
	}
}

function positionSkyLabel(ctx: CanvasRenderingContext2D, state: RenderState, name: string, anchorX: number, anchorY: number, offsetX: number, offsetY: number, out: Float32Array) {
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

// Dynamic planet, asteroid, and comet renderer.
class MovingBodyLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	constructor() {
		super('movingBodies', 60)
	}

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

			if (isMovingBodyLabelVisible(object, state)) {
				const label = object.name ?? object.type
				ctx.fillStyle = state.theme.movingBodies.labelColor

				if (positionSkyLabel(ctx, state, label, this.point[0], this.point[1], STAR_LABEL_OFFSET_X, STAR_LABEL_OFFSET_Y, this.labelPoint)) {
					ctx.fillText(label, this.labelPoint[0], this.labelPoint[1])
				}
			}
		}
	}
}

// Label renderer for constellations.
class ConstellationLabelLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	constructor() {
		super('constellationLabels', 70)
	}

	// Draws constellation labels above a zoom threshold.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		if (state.transform.k < 0.75) return

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

// Custom equatorial shape renderer.
class ShapeLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly shapeState: MutableShapeRenderState = {
		id: '',
		x: 0,
		y: 0,
		coordinate: { rightAscension: 0, declination: 0 },
		shape: null as unknown as Readonly<CelestialShape>,
		state: null as unknown as RenderState,
	}

	constructor() {
		super('shapes', 75)
	}

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

// Interaction overlay draws hover and selection rings.
class InteractionOverlayLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly labelPoint = new Float32Array(2)

	constructor() {
		super('overlay', 80)
	}

	// Draws selected and hovered object highlights.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		drawObjectHighlight(ctx, state, state.selectedObject, state.theme.selectedObject.color, 8)
		drawObjectHighlight(ctx, state, state.hoverObject, state.theme.hoverHighlight.color, 6)
		this.drawHighlightedLabel(ctx, state, state.selectedObject)

		if (!sameObject(state.selectedObject, state.hoverObject)) {
			this.drawHighlightedLabel(ctx, state, state.hoverObject)
		}
	}

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

	private drawHighlightedStarLabel(ctx: CanvasRenderingContext2D, state: RenderState, object: Extract<CelestialObject, { type: 'star' }>) {
		const catalog = state.starCatalog

		if (!catalog || !catalog.visible[object.index] || catalog.labelVisible[object.index] !== 0) return

		const name = object.name ?? catalog.names?.[object.index]

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

	private drawHighlightedDeepSkyLabel(ctx: CanvasRenderingContext2D, state: RenderState, object: Extract<CelestialObject, { type: 'deepSky' }>) {
		const dso = object.object

		if (!dso.name || state.deepSkyLabelVisible[object.index] !== 0) return
		if (!state.projectEquatorialToScreen(dso.rightAscension, dso.declination, this.point)) return
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

// Bright stars can be labeled at base zoom; fainter names appear progressively while zooming in.
function zoomMagnitudeLimit(k: number, baseMagnitude: number, magnitudePerZoom: number, minMagnitude: number, maxMagnitude: number) {
	const upperMagnitude = Math.max(minMagnitude, maxMagnitude)
	const limit = clamp(baseMagnitude + Math.log2(Math.max(k, 0.25)) * magnitudePerZoom, minMagnitude, upperMagnitude)
	return Math.min(limit, maxMagnitude)
}

function starSymbolMagnitudeLimitAtZoom(zoom: number, maxMagnitude: number) {
	return zoomMagnitudeLimit(zoom, STAR_SYMBOL_BASE_MAGNITUDE, STAR_SYMBOL_MAGNITUDE_PER_ZOOM, STAR_SYMBOL_MIN_MAGNITUDE, maxMagnitude)
}

function starSymbolMagnitudeLimit(state: RenderState) {
	return starSymbolMagnitudeLimitAtZoom(state.transform.k, state.stars.maxMagnitude)
}

function starLabelMagnitudeLimit(state: RenderState) {
	return zoomMagnitudeLimit(state.transform.k, STAR_LABEL_BASE_MAGNITUDE, STAR_LABEL_MAGNITUDE_PER_ZOOM, STAR_LABEL_MIN_MAGNITUDE, state.stars.maxMagnitude)
}

function isStarVisibleAtZoom(magnitude: number, zoom: number, maxMagnitude: number) {
	return magnitude <= starSymbolMagnitudeLimitAtZoom(zoom, maxMagnitude)
}

function deepSkyMagnitude(object: DeepSkyObject) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : DSO_DEFAULT_MAGNITUDE
}

function deepSkyObjectMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_SYMBOL_BASE_MAGNITUDE, DSO_SYMBOL_MAGNITUDE_PER_ZOOM, DSO_SYMBOL_MIN_MAGNITUDE, DSO_SYMBOL_MAX_MAGNITUDE)
}

function deepSkyLabelMagnitudeLimit(k: number) {
	return zoomMagnitudeLimit(k, DSO_LABEL_BASE_MAGNITUDE, DSO_LABEL_MAGNITUDE_PER_ZOOM, DSO_LABEL_MIN_MAGNITUDE, DSO_LABEL_MAX_MAGNITUDE)
}

function isDeepSkyObjectVisibleAtZoom(object: DeepSkyObject, zoom: number) {
	return deepSkyMagnitude(object) <= deepSkyObjectMagnitudeLimit(zoom)
}

function isDeepSkyObjectVisible(object: DeepSkyObject, state: RenderState) {
	return isDeepSkyObjectVisibleAtZoom(object, state.transform.k)
}

function isDeepSkyLabelVisible(object: DeepSkyObject, state: RenderState) {
	return deepSkyMagnitude(object) <= deepSkyLabelMagnitudeLimit(state.transform.k)
}

function movingBodyMagnitude(object: MovingBody) {
	return isFiniteNumber(object.magnitude) ? object.magnitude : 0
}

function isMovingBodyVisibleAtZoom(object: MovingBody, zoom: number) {
	return !isFiniteNumber(object.magnitude) || object.magnitude <= deepSkyObjectMagnitudeLimit(zoom)
}

function isMovingBodyVisible(object: MovingBody, state: RenderState) {
	return object.visible !== false && isMovingBodyVisibleAtZoom(object, state.transform.k)
}

function isMovingBodyLabelVisible(object: MovingBody, state: RenderState) {
	return !isFiniteNumber(object.magnitude) || object.magnitude <= deepSkyLabelMagnitudeLimit(state.transform.k)
}

function movingBodyColor(object: MovingBody, state: RenderState) {
	if (object.type === 'comet') return state.theme.movingBodies.cometColor
	if (object.type === 'asteroid') return state.theme.movingBodies.asteroidColor
	return state.theme.movingBodies.planetColor
}

function deepSkySymbolRadius(object: DeepSkyObject, state: RenderState) {
	const brightness = 1 - clamp((deepSkyMagnitude(object) - DSO_SYMBOL_MIN_MAGNITUDE) / (DSO_SYMBOL_MAX_MAGNITUDE - DSO_SYMBOL_MIN_MAGNITUDE), 0, 1)
	return clamp((3.2 + brightness * 1.8) * Math.sqrt(state.transform.k), 3.2, 7)
}

const CARDINAL_POINT_LABELS = [
	['N', 0],
	['E', PIOVERTWO],
	['S', PI],
	['W', PI + PIOVERTWO],
] as const

const LABEL_ALTITUDE = 3 * DEG2RAD
const CARDINAL_POINT = new Float32Array(2)

// Draws cardinal labels on the horizon.
function drawCardinalPoints(ctx: CanvasRenderingContext2D, state: RenderState) {
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

const ZENITH_LABEL_POINT = new Float32Array(2)

function drawZenithLabel(ctx: CanvasRenderingContext2D, state: RenderState) {
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

// Draws a DSO symbol by object type.
function drawDsoSymbol(ctx: CanvasRenderingContext2D, type: DeepSkyObject['type'], x: number, y: number, radius: number) {
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

function drawMovingBodySymbol(ctx: CanvasRenderingContext2D, type: MovingBodyType, x: number, y: number) {
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

	if (type !== 'asteroid') {
		ctx.beginPath()
		ctx.arc(x, y, 4.5, 0, TAU)
		ctx.fill()
		return
	}

	ctx.beginPath()
	ctx.rect(x - 2.5, y - 2.5, 5, 5)
	ctx.stroke()
}

const OBJECT_HIGLIGHT_POINT = new Float32Array(2)

// Draws hover/selection highlight for any pickable object.
function drawObjectHighlight(ctx: CanvasRenderingContext2D, state: RenderState, object: CelestialObject | null, color: string, radius: number) {
	if (!object) return

	const point = OBJECT_HIGLIGHT_POINT

	if (!projectObjectToScreen(object, state, point)) return

	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.arc(point[0], point[1], radius, 0, TAU)
	ctx.stroke()
}

// Projects a picked object to current screen coordinates.
function projectObjectToScreen(object: CelestialObject, state: RenderState, out: NumberArray): boolean {
	if (!isObjectLayerVisible(object, state)) {
		return false
	}

	switch (object.type) {
		case 'star': {
			const catalog = state.starCatalog
			if (!catalog || !catalog.visible[object.index]) return false
			if (!isStarVisibleAtZoom(catalog.mag[object.index], state.transform.k, state.stars.maxMagnitude)) return false
			applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, out)
			return true
		}
		case 'deepSky':
			if (!isDeepSkyObjectVisible(object.object, state)) return false
			return state.projectEquatorialToScreen(object.object.rightAscension, object.object.declination, out)
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

// Canvas layer manager.
class CanvasRenderer {
	private readonly root: HTMLDivElement
	private readonly records: LayerRecord[] = []
	private dpr = 1

	constructor(
		private readonly host: HTMLElement,
		width: number,
		height: number,
	) {
		this.root = document.createElement('div')
		this.root.style.position = 'relative'
		this.root.style.overflow = 'hidden'
		this.root.style.touchAction = 'none'
		this.host.append(this.root)
		this.resize(width, height)
	}

	// Adds a canvas-backed layer.
	addLayer(layer: InternalLayer) {
		const canvas = document.createElement('canvas')
		const ctx = canvas.getContext('2d', { alpha: true })

		if (!ctx) {
			throw new Error(`Unable to create 2D canvas context for layer ${layer.id}`)
		}

		canvas.style.position = 'absolute'
		canvas.style.inset = '0'
		canvas.style.zIndex = String(layer.zIndex)
		canvas.style.pointerEvents = 'none'
		this.root.append(canvas)
		this.records.push({ layer, canvas, ctx })
		this.records.sort((a, b) => a.layer.zIndex - b.layer.zIndex)
		this.resizeCanvas(canvas)
	}

	// Resizes all canvases with device-pixel awareness.
	resize(width: number, height: number) {
		this.dpr = Math.max(1, window.devicePixelRatio || 1)
		this.root.style.width = `${width}px`
		this.root.style.height = `${height}px`

		for (const record of this.records) {
			this.resizeCanvas(record.canvas)
			record.layer.markDirty()
		}
	}

	// Draws all dirty visible layers.
	render(state: RenderState) {
		for (const record of this.records) {
			const { layer, canvas, ctx } = record
			canvas.style.display = layer.visible ? 'block' : 'none'

			if (!layer.visible || !layer.dirty) {
				continue
			}

			ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
			ctx.clearRect(0, 0, state.width, state.height)

			if (layer.id !== 'background' && layer.id !== 'debug' && isFiniteDiskProjection(state.projection)) {
				ctx.save()
				clipProjectionDisk(ctx, state)
				layer.render(ctx, state)
				ctx.restore()
			} else {
				layer.render(ctx, state)
			}

			layer.markClean()
		}
	}

	// Marks every managed layer dirty.
	markAllDirty() {
		for (const record of this.records) {
			record.layer.markDirty()
		}
	}

	// Marks a single layer dirty.
	markDirty(id: string) {
		for (const record of this.records) {
			if (record.layer.id === id) {
				record.layer.markDirty()
			}
		}
	}

	// Gets a layer by id.
	getLayer(id: string) {
		for (const record of this.records) {
			if (record.layer.id === id) {
				return record.layer
			}
		}

		return null
	}

	// Removes all DOM nodes created by the renderer.
	destroy() {
		for (const record of this.records) {
			record.layer.destroy()
		}

		this.root.remove()
		this.records.length = 0
	}

	// Exposes the root element for interaction binding.
	get element(): HTMLElement {
		return this.root
	}

	// Exposes current device pixel ratio.
	get devicePixelRatio() {
		return this.dpr
	}

	// Updates one canvas backing store.
	private resizeCanvas(canvas: HTMLCanvasElement) {
		const width = Math.max(1, this.root.clientWidth || Number.parseInt(this.root.style.width, 10) || DEFAULT_WIDTH)
		const height = Math.max(1, this.root.clientHeight || Number.parseInt(this.root.style.height, 10) || DEFAULT_HEIGHT)
		canvas.width = Math.round(width * this.dpr)
		canvas.height = Math.round(height * this.dpr)
		canvas.style.width = `${width}px`
		canvas.style.height = `${height}px`
	}
}

// Main Celestial star-map library.
export class Celestial {
	private readonly host: HTMLElement
	private readonly renderer: CanvasRenderer
	// oxlint-disable-next-line unicorn/prefer-event-target
	private readonly emitter = new EventEmitter()
	private readonly picking = new FixedGridSpatialIndex()
	private readonly eqToHorizontal = new Float64Array(9)
	private readonly viewMatrix = new Float32Array(9)
	private readonly centerVector = new Float32Array(3)
	private readonly referenceUp = new Float32Array(3)
	private readonly tempProjection = new Float32Array(2)
	private readonly tempVector = new Float32Array(3)
	private readonly tempScreen = new Float32Array(2)
	private readonly layers: InternalLayer[] = []

	private readonly options: ResolvedCelestialOptions
	private starCatalog: StarCatalog | null = null
	private constellations: ConstellationData = {}
	private milkyWay: MilkyWayStep[] = []
	private dsos: DeepSkyObject[] = []
	private deepSkyLabelVisible = new Uint8Array(0)
	private readonly movingBodies = new Map<string, MovingBody>()
	private readonly movingBodyList: MovingBody[] = []
	private readonly shapes = new Map<string, CelestialShape>()
	private readonly shapeList: CelestialShape[] = []
	private readonly pickedShapes: CelestialShape[] = []
	private transform: ViewTransform = { x: 0, y: 0, k: 1 }
	private hoverObject: CelestialObject | null = null
	private selectedObject: CelestialObject | null = null
	private autoUpdateTimer: ReturnType<typeof setInterval> | null = null
	private autoUpdateOptions: Required<AutoUpdateOptions> | null = null
	private frameId = 0
	private updateQueued = false
	private pickingDirty = false
	private destroyed = false
	private pointerDown = false
	private pointerMoved = false
	private d3ZoomBound = false
	private d3ZoomBehavior: ZoomBehavior<HTMLElement, unknown> | null = null
	private pointerStartX = 0
	private pointerStartY = 0
	private transformStartX = 0
	private transformStartY = 0
	private lastPointerMove = 0

	// Creates a new interactive Canvas celestial map.
	constructor(container: HTMLElement | string, options: CelestialOptions = {}) {
		this.host = resolveContainer(container)
		this.options = resolveOptions(options)
		this.renderer = new CanvasRenderer(this.host, this.options.width, this.options.height)

		this.setupLayers()

		if (this.options.interactions.preferD3Zoom) {
			this.bindD3Zoom()
		} else {
			this.bindLocalInteractions()
		}

		this.resetViewCenter()
		writeEquatorialToHorizontalMatrix(this.options.time, this.options.observer, this.eqToHorizontal)

		// Should run after onReady callback to allow initial configuration before first render.
		// this.run()
	}

	// Sets the current observation time.
	setTime(date: CelestialTime) {
		const time = typeof date === 'number' ? date : date.getTime()

		if (time !== this.options.time) {
			this.options.time = time
			this.queueUpdate()
		}
	}

	// Sets the observer location.
	setObserver(observer: ObserverLocation) {
		observer = validateObserver(observer)

		if (observer.latitude !== this.options.observer.latitude || observer.longitude !== this.options.observer.longitude || observer.elevation !== this.options.observer.elevation) {
			this.options.observer = observer
			this.queueUpdate()
		}
	}

	// Changes the active map projection.
	setProjection(projection: ProjectionType) {
		projection = validateProjection(projection)

		if (projection !== this.options.projection) {
			this.options.projection = projection
			this.queueProjectionOnly()
		}
	}

	// Sets the star magnitude limit.
	setMagnitudeLimit(limit: number) {
		if (limit !== this.options.stars.maxMagnitude) {
			this.options.stars.maxMagnitude = limit
			this.queueProjectionOnly()
		}
	}

	// Toggles star labels without recomputing star projection.
	setStarLabelsVisible(visible: boolean) {
		if (this.options.stars.labels !== visible) {
			this.options.stars.labels = visible
			this.renderer.markDirty('stars')
			this.requestRender()
		}
	}

	setViewTransform(transform: ViewTransform) {
		const nextTransform = this.normalizeViewTransform(transform)

		if (this.d3ZoomBehavior) {
			this.syncD3ZoomTransform(nextTransform)
		}

		if (this.writeViewTransform(nextTransform)) {
			this.afterTransformChanged()
		}
	}

	// Sets the default auto-update interval in milliseconds.
	setUpdateInterval(ms: number) {
		if (!isFiniteNumber(ms) || ms <= 0) {
			this.emitError(new Error('Invalid update interval'))
			return
		}

		const interval = Math.floor(ms)

		if (interval !== this.options.updateInterval) {
			this.options.updateInterval = Math.floor(ms)

			if (this.autoUpdateOptions) {
				this.startAutoUpdate({ ...this.autoUpdateOptions, interval })
			}
		}
	}

	// Starts realtime or accelerated simulation updates.
	startAutoUpdate(options?: AutoUpdateOptions) {
		this.stopAutoUpdate()

		const mode = options?.mode ?? 'realtime'
		const interval = Math.max(1, Math.floor(options?.interval ?? this.options.updateInterval))
		const timeStep = Math.floor(options?.timeStep ?? options?.interval ?? this.options.updateInterval)

		this.autoUpdateOptions = { mode, interval, timeStep }
		let simulatedTime = this.options.time

		const tick = () => {
			if (mode === 'simulation') {
				simulatedTime += timeStep
				this.setTime(simulatedTime)
			} else {
				this.setTime(Date.now())
			}
		}

		if (mode === 'realtime') {
			tick()
		}

		this.autoUpdateTimer = setInterval(tick, interval)
	}

	// Stops any running auto-update timer.
	stopAutoUpdate() {
		if (this.autoUpdateTimer) {
			clearInterval(this.autoUpdateTimer)
			this.autoUpdateTimer = null
		}

		this.autoUpdateOptions = null
	}

	// Resizes the map without recreating the instance.
	resize(width: number, height: number) {
		const nextWidth = Math.max(1, Math.floor(width))
		const nextHeight = Math.max(1, Math.floor(height))

		if (nextWidth === this.options.width && nextHeight === this.options.height) {
			return
		}

		this.options.width = nextWidth
		this.options.height = nextHeight
		this.renderer.resize(this.options.width, this.options.height)
		this.projectStars()
		this.rebuildPickingIndex()
		this.renderer.markAllDirty()
		this.emitter.has('resize') && this.emitter.emit('resize', { width: this.options.width, height: this.options.height })
		this.requestRender()
	}

	// Schedules a coalesced render frame.
	render() {
		this.requestRender()
	}

	isLayerVisible(layerId: string) {
		return this.options.layers[layerId] !== false
	}

	// Destroys timers, listeners, canvases, and large references.
	destroy() {
		if (this.destroyed) return

		this.destroyed = true
		this.stopAutoUpdate()
		this.unbindD3Zoom()
		this.unbindLocalInteractions()

		if (this.frameId) {
			cancelAnimationFrame(this.frameId)
			this.frameId = 0
		}

		this.renderer.destroy()
		this.emitter.clear()
		this.starCatalog = null
		this.dsos.length = 0
		this.constellations = {}
		this.milkyWay.length = 0
		this.movingBodies.clear()
		this.movingBodyList.length = 0
		this.shapes.clear()
		this.shapeList.length = 0
	}

	// Loads stars from object arrays or typed arrays.
	loadStars(stars: readonly Star[] | StarCatalogInput) {
		try {
			this.starCatalog = new StarCatalog(stars)
			this.starCatalog.cacheStyleBuckets(this.options.stars, this.options.theme)
			this.queueUpdate()
		} catch (error) {
			console.error(error)
			this.emitError(normalizeError(error))
		}
	}

	// Loads constellation lines and labels.
	loadConstellations(data: ConstellationData) {
		this.constellations = {
			lines: data.lines ?? [],
			labels: data.labels ?? [],
			boundaries: data.boundaries ?? [],
		}

		this.renderer.markDirty('constellations')
		this.renderer.markDirty('constellationBoundaries')
		this.renderer.markDirty('constellationLabels')
		this.rebuildPickingIndex()
		this.requestRender()
	}

	loadMilkyWay(coordinates: MilkyWayCoordinates) {
		this.milkyWay = normalizeMilkyWayCoordinates(coordinates)
		this.renderer.markDirty('milkyWay')
		this.requestRender()
	}

	// Loads deep-sky objects.
	loadDeepSkyObjects(objects: readonly DeepSkyObject[]) {
		this.dsos = objects as never
		this.deepSkyLabelVisible = new Uint8Array(this.dsos.length)
		this.renderer.markDirty('deepSky')
		this.rebuildPickingIndex()
		this.requestRender()
	}

	// Adds or replaces a dynamic moving body and returns its id.
	addMovingBody(object: MovingBody) {
		const id = object.id
		const previous = this.movingBodies.get(id)
		this.movingBodies.set(id, object)

		if (previous) {
			const index = this.movingBodyList.indexOf(previous)

			if (index >= 0) {
				this.movingBodyList[index] = object
			} else {
				this.movingBodyList.push(object)
			}
		} else {
			this.movingBodyList.push(object)
		}

		return id
	}

	// Removes one dynamic moving body.
	removeMovingBody(id: string) {
		const object = this.movingBodies.get(id)
		const removed = object !== undefined

		if (removed) {
			this.movingBodies.delete(id)
			const index = this.movingBodyList.indexOf(object)

			if (index >= 0) {
				this.movingBodyList.splice(index, 1)
			}
		}

		if (removed) {
			if (this.selectedObject?.type === 'movingBody' && this.selectedObject.object.id === id) {
				this.selectedObject = null
				this.renderer.markDirty('overlay')
			}

			if (this.hoverObject?.type === 'movingBody' && this.hoverObject.object.id === id) {
				this.hoverObject = null
				this.renderer.markDirty('overlay')
			}
		}

		return removed
	}

	// Removes all dynamic moving bodies.
	clearMovingBodies() {
		if (this.movingBodies.size === 0) return

		this.movingBodies.clear()
		this.movingBodyList.length = 0

		if (this.selectedObject?.type === 'movingBody') {
			this.selectedObject = null
			this.renderer.markDirty('overlay')
		}

		if (this.hoverObject?.type === 'movingBody') {
			this.hoverObject = null
			this.renderer.markDirty('overlay')
		}
	}

	// Marks dynamic moving bodies as changed after external mutation or batched updates.
	markMovingBodyDirty(id?: string) {
		if (id !== undefined && !this.movingBodies.has(id)) {
			return false
		}

		this.syncSelectedMovingBodyObject()
		this.syncHoverMovingBodyObject()
		this.rebuildPickingIndex()
		this.renderer.markDirty('movingBodies')

		if (id === undefined || (this.selectedObject?.type === 'movingBody' && this.selectedObject.object.id === id) || (this.hoverObject?.type === 'movingBody' && this.hoverObject.object.id === id)) {
			this.renderer.markDirty('overlay')
		}

		this.requestRender()
		return true
	}

	// Adds or replaces a custom equatorial shape and returns its id.
	addShape(shape: CelestialShape) {
		const id = shape.id
		const previous = this.shapes.get(id)
		this.shapes.set(id, shape)

		if (previous) {
			const index = this.shapeList.indexOf(previous)

			if (index >= 0) {
				this.shapeList[index] = shape
			} else {
				this.shapeList.push(shape)
			}
		} else {
			this.shapeList.push(shape)
		}

		this.markShapeChanged(id)
		return id
	}

	// Removes one custom shape.
	removeShape(id: string) {
		const shape = this.shapes.get(id)
		const removed = shape !== undefined

		if (removed) {
			this.shapes.delete(id)
			const index = this.shapeList.indexOf(shape)

			if (index >= 0) {
				this.shapeList.splice(index, 1)
			}
		}

		if (removed) {
			if (this.selectedObject?.type === 'shape' && this.selectedObject.id === id) {
				this.selectedObject = null
				this.renderer.markDirty('overlay')
			}

			if (this.hoverObject?.type === 'shape' && this.hoverObject.id === id) {
				this.hoverObject = null
				this.renderer.markDirty('overlay')
			}

			this.markShapeChanged()
		}

		return removed
	}

	// Removes all custom shapes.
	clearShapes() {
		if (this.shapes.size === 0) return

		this.shapes.clear()
		this.shapeList.length = 0

		if (this.selectedObject?.type === 'shape') {
			this.selectedObject = null
			this.renderer.markDirty('overlay')
		}

		if (this.hoverObject?.type === 'shape') {
			this.hoverObject = null
			this.renderer.markDirty('overlay')
		}

		this.markShapeChanged()
	}

	// Marks custom shapes as changed after external mutation.
	markShapeChanged(id?: string) {
		if (id !== undefined && !this.shapes.has(id)) {
			return false
		}

		this.rebuildPickingIndex()
		this.renderer.markDirty('shapes')

		if (id === undefined || (this.selectedObject?.type === 'shape' && this.selectedObject.id === id) || (this.hoverObject?.type === 'shape' && this.hoverObject.id === id)) {
			this.renderer.markDirty('overlay')
		}

		this.requestRender()
		return true
	}

	// Toggles layer visibility by id.
	setLayerVisible(layerId: string, visible: boolean) {
		const layer = this.renderer.getLayer(layerId)

		if (!layer) {
			this.emitError(new Error(`Unknown layer: ${layerId}`))
			return
		}

		layer.visible = visible
		layer.markDirty()
		this.options.layers[layerId] = visible

		if (isPickableLayerId(layerId)) {
			if (!visible) {
				this.clearHiddenLayerObjects(layerId)
			}

			this.rebuildPickingIndex()
		}

		this.requestRender()
	}

	private clearHiddenLayerObjects(layerId: string) {
		if (this.selectedObject && objectLayerId(this.selectedObject) === layerId) {
			this.selectedObject = null
			this.renderer.markDirty('overlay')
		}

		if (this.hoverObject && objectLayerId(this.hoverObject) === layerId) {
			const object = this.hoverObject
			this.hoverObject = null
			this.renderer.markDirty('overlay')
			this.emitter.has('objectLeave') && this.emitter.emit('objectLeave', { object })
		}
	}

	// Centers the view on an equatorial coordinate.
	centerOnEquatorial(ra: number, dec: number) {
		writeRaDecUnitVector(normalizeAngle(ra), clamp(dec, -PIOVERTWO, PIOVERTWO), this.centerVector)
		this.referenceUp[0] = 0
		this.referenceUp[1] = 0
		this.referenceUp[2] = 1
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Centers the view on a horizontal coordinate.
	centerOnHorizontal(az: number, alt: number) {
		writeHorizontalUnitVector(normalizeAngle(az), clamp(alt, -PIOVERTWO, PIOVERTWO), this.centerVector)
		this.referenceUp[0] = 0
		this.referenceUp[1] = 1
		this.referenceUp[2] = 0
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Converts renderer-local screen coordinates into an equatorial coordinate.
	screenToEquatorial(x: number, y: number): EquatorialCoordinate | null {
		if (!Number.isFinite(x) || !Number.isFinite(y) || this.transform.k <= 0) {
			return null
		}

		const width = this.options.width
		const height = this.options.height
		const scale = projectionScale(width, height, this.options.projection)
		const baseX = width / 2 + (x - width / 2 - this.transform.x) / this.transform.k
		const baseY = height / 2 + (y - height / 2 - this.transform.y) / this.transform.k
		const projectionX = (width / 2 - baseX) / scale
		const projectionY = (height / 2 - baseY) / scale

		if (!unprojectViewVector(this.options.projection, projectionX, projectionY, this.tempVector)) {
			return null
		}

		const viewX = this.tempVector[0]
		const viewY = this.tempVector[1]
		const viewZ = this.tempVector[2]
		const matrix = this.viewMatrix
		let worldX = matrix[0] * viewX + matrix[3] * viewY + matrix[6] * viewZ
		let worldY = matrix[1] * viewX + matrix[4] * viewY + matrix[7] * viewZ
		let worldZ = matrix[2] * viewX + matrix[5] * viewY + matrix[8] * viewZ

		if (this.options.coordinateSystem === 'horizontal') {
			if (worldZ < -HORIZON_EPSILON) {
				return null
			}

			const horizontalX = worldX
			const horizontalY = worldY
			const horizontalZ = worldZ
			const eqMatrix = this.eqToHorizontal
			worldX = eqMatrix[0] * horizontalX + eqMatrix[3] * horizontalY + eqMatrix[6] * horizontalZ
			worldY = eqMatrix[1] * horizontalX + eqMatrix[4] * horizontalY + eqMatrix[7] * horizontalZ
			worldZ = eqMatrix[2] * horizontalX + eqMatrix[5] * horizontalY + eqMatrix[8] * horizontalZ
		}

		this.tempVector[0] = worldX
		this.tempVector[1] = worldY
		this.tempVector[2] = worldZ

		if (!normalizeVector(this.tempVector)) {
			return null
		}

		return {
			rightAscension: normalizeAngle(Math.atan2(this.tempVector[1], this.tempVector[0])),
			declination: Math.asin(clamp(this.tempVector[2], -1, 1)),
		}
	}

	// Registers an event callback and returns an unsubscribe function.
	on<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): () => void {
		return this.emitter.on(eventName, callback)
	}

	// Removes an event callback.
	off<K extends CelestialEventName>(eventName: K, callback: CelestialEventCallback<K>): void {
		this.emitter.off(eventName, callback)
	}

	// Creates and registers built-in layers.
	private setupLayers() {
		this.layers.push(
			new BackgroundLayer(),
			new HorizonLayer(),
			new MilkyWayLayer(),
			new GridLayer(),
			new ReferenceLineLayer(),
			new ConstellationLineLayer(),
			new ConstellationBoundaryLayer(),
			new DeepSkyObjectLayer(),
			new StarLayer(),
			new MovingBodyLayer(),
			new ConstellationLabelLayer(),
			new ShapeLayer(),
			new InteractionOverlayLayer(),
		)

		for (const layer of this.layers) {
			layer.visible = this.options.layers[layer.id] ?? true
			this.renderer.addLayer(layer)
		}
	}

	// Resets view center to a sensible coordinate-system default.
	private resetViewCenter() {
		if (this.options.coordinateSystem === 'horizontal') {
			this.centerVector[0] = 0
			this.centerVector[1] = 0
			this.centerVector[2] = 1
			this.referenceUp[0] = 0
			this.referenceUp[1] = 1
			this.referenceUp[2] = 0
		} else {
			this.centerVector[0] = 1
			this.centerVector[1] = 0
			this.centerVector[2] = 0
			this.referenceUp[0] = 0
			this.referenceUp[1] = 0
			this.referenceUp[2] = 1
		}

		this.writeCurrentViewMatrix()
	}

	// Refreshes the current view matrix.
	private writeCurrentViewMatrix() {
		writeViewMatrix(this.centerVector, this.referenceUp, this.viewMatrix)
	}

	// Queues a full astronomical update.
	private queueUpdate() {
		if (this.updateQueued || this.destroyed) return

		this.queueRun()
	}

	// Queues projection-only work after view/projection changes.
	private queueProjectionOnly() {
		if (this.destroyed) return

		this.projectStars()
		this.rebuildPickingIndex()
		this.renderer.markAllDirty()
		this.requestRender()
	}

	// Coalesces multiple synchronous update requests into a single frame.
	queueRun() {
		if (this.updateQueued) return

		this.updateQueued = true

		queueMicrotask(() => {
			this.updateQueued = false
			this.run()
		})
	}

	// Performs astronomical and projection updates.
	run() {
		if (this.destroyed) return

		const emitUpdateStart = this.emitter.has('updateStart')
		const emitUpdateEnd = this.emitter.has('updateEnd')
		const start = emitUpdateEnd ? performance.now() : 0
		emitUpdateStart && this.emitter.emit('updateStart', { time: this.options.time })
		writeEquatorialToHorizontalMatrix(this.options.time, this.options.observer, this.eqToHorizontal)

		if (this.starCatalog) {
			this.starCatalog.updateEquatorialVectors(julianEpochYear(this.options.time))
		}

		this.projectStars()
		this.rebuildPickingIndex()
		emitUpdateEnd && this.emitter.emit('updateEnd', { time: this.options.time, duration: performance.now() - start })
		this.markAstronomicalDirty()
		this.requestRender()
	}

	private syncSelectedMovingBodyObject() {
		if (this.selectedObject?.type !== 'movingBody') return

		this.selectedObject = this.currentMovingBodyObject(this.selectedObject)
	}

	private syncHoverMovingBodyObject() {
		if (this.hoverObject?.type !== 'movingBody') return

		this.hoverObject = this.currentMovingBodyObject(this.hoverObject)
	}

	private currentMovingBodyObject(object: Extract<CelestialObject, { type: 'movingBody' }>): CelestialObject | null {
		const indexed = this.movingBodyList[object.index]

		if (indexed?.id === object.object.id) {
			return { type: 'movingBody', index: object.index, object: indexed }
		}

		for (let i = 0; i < this.movingBodyList.length; i++) {
			const movingBody = this.movingBodyList[i]
			if (movingBody.id === object.object.id) return { type: 'movingBody', index: i, object: movingBody }
		}

		return null
	}

	private markAstronomicalDirty() {
		for (let i = 0; i < ASTRONOMICAL_DIRTY_LAYER_IDS.length; i++) {
			this.renderer.markDirty(ASTRONOMICAL_DIRTY_LAYER_IDS[i])
		}

		if (this.options.coordinateSystem === 'equatorial') {
			this.renderer.markDirty('horizon')
		}

		if (this.hoverObject || this.selectedObject) {
			this.renderer.markDirty('overlay')
		}
	}

	// Projects visible stars into base screen coordinates.
	private projectStars() {
		const catalog = this.starCatalog

		if (!catalog) return

		const width = this.options.width
		const height = this.options.height
		const scale = projectionScale(width, height, this.options.projection)
		const margin = Math.max(width, height)
		const maxMagnitude = this.options.stars.maxMagnitude
		const maxRenderStars = this.options.stars.maxRenderStars
		const temp = this.tempVector
		catalog.beginProjection()
		let projected = 0

		for (let i = 0; i < catalog.count; i++) {
			if (catalog.visibleCount >= maxRenderStars) {
				break
			}

			if (catalog.mag[i] > maxMagnitude) {
				continue
			}

			let x = catalog.eqX[i]
			let y = catalog.eqY[i]
			let z = catalog.eqZ[i]

			if (this.options.coordinateSystem === 'horizontal') {
				multiplyMatrixVector(this.eqToHorizontal, x, y, z, temp)
				x = temp[0]
				y = temp[1]
				z = temp[2]

				if (z < -HORIZON_EPSILON) {
					continue
				}
			}

			if (!this.projectWorldVectorToBaseScreen(x, y, z, scale, this.tempScreen)) {
				continue
			}

			const sx = this.tempScreen[0]
			const sy = this.tempScreen[1]

			if (sx < -margin || sy < -margin || sx > width + margin || sy > height + margin) {
				continue
			}

			catalog.recordVisible(i, sx, sy)
			projected++
		}

		catalog.finalizeProjectionBuckets()
		this.renderer.markDirty('stars')
	}

	// Projects a world vector to base screen coordinates without pan/zoom transform.
	private projectWorldVectorToBaseScreen(x: number, y: number, z: number, scale: number, out: NumberArray): boolean {
		const vx = this.viewMatrix[0] * x + this.viewMatrix[1] * y + this.viewMatrix[2] * z
		const vy = this.viewMatrix[3] * x + this.viewMatrix[4] * y + this.viewMatrix[5] * z
		const vz = this.viewMatrix[6] * x + this.viewMatrix[7] * y + this.viewMatrix[8] * z

		if (!projectViewVector(this.options.projection, vx, vy, vz, this.tempProjection)) {
			return false
		}

		out[0] = this.options.width / 2 - this.tempProjection[0] * scale
		out[1] = this.options.height / 2 - this.tempProjection[1] * scale
		return true
	}

	// Projects an equatorial coordinate to transformed screen coordinates.
	private readonly projectEquatorialToScreen = (ra: number, dec: number, out: NumberArray): boolean => {
		writeRaDecUnitVector(ra, dec, this.tempVector)

		let x = this.tempVector[0]
		let y = this.tempVector[1]
		let z = this.tempVector[2]

		if (this.options.coordinateSystem === 'horizontal') {
			multiplyMatrixVector(this.eqToHorizontal, x, y, z, this.tempVector)
			x = this.tempVector[0]
			y = this.tempVector[1]
			z = this.tempVector[2]

			if (z < -HORIZON_EPSILON) {
				return false
			}
		}

		if (!this.projectWorldVectorToBaseScreen(x, y, z, projectionScale(this.options.width, this.options.height, this.options.projection), out)) {
			return false
		}

		applyViewTransform(out[0], out[1], this.options.width, this.options.height, this.transform, out)

		return true
	}

	// Projects a coordinate-system vector to transformed screen coordinates.
	private readonly projectWorldVectorToScreen = (x: number, y: number, z: number, out: NumberArray): boolean => {
		if (!this.projectWorldVectorToBaseScreen(x, y, z, projectionScale(this.options.width, this.options.height, this.options.projection), out)) {
			return false
		}

		applyViewTransform(out[0], out[1], this.options.width, this.options.height, this.transform, out)

		return true
	}

	// Projects a local horizontal coordinate onto either horizontal or equatorial views.
	private readonly projectHorizontalToScreen = (az: number, alt: number, out: NumberArray): boolean => {
		writeHorizontalUnitVector(az, alt, this.tempVector)

		let x = this.tempVector[0]
		let y = this.tempVector[1]
		let z = this.tempVector[2]

		if (this.options.coordinateSystem === 'equatorial') {
			const matrix = this.eqToHorizontal
			const hx = x
			const hy = y
			const hz = z
			x = matrix[0] * hx + matrix[3] * hy + matrix[6] * hz
			y = matrix[1] * hx + matrix[4] * hy + matrix[7] * hz
			z = matrix[2] * hx + matrix[5] * hy + matrix[8] * hz
		}

		return this.projectWorldVectorToScreen(x, y, z, out)
	}

	private readonly equatorialVisibility = (ra: number, dec: number): number => {
		if (this.options.coordinateSystem !== 'horizontal') {
			return 1
		}

		writeRaDecUnitVector(ra, dec, this.tempVector)
		multiplyMatrixVector(this.eqToHorizontal, this.tempVector[0], this.tempVector[1], this.tempVector[2], this.tempVector)
		return this.tempVector[2]
	}

	private readonly horizontalVisibility = (az: number, alt: number): number => (this.options.coordinateSystem === 'horizontal' ? Math.sin(alt) : 1)

	// Rebuilds the picking index from projected visible objects.
	private rebuildPickingIndex() {
		this.pickingDirty = false
		const radius = this.options.interactions.pickRadius
		this.picking.reset(this.options.width, this.options.height, Math.max(16, radius * 3))
		this.pickedShapes.length = 0
		const catalog = this.starCatalog

		if (catalog && this.isLayerVisible('stars')) {
			const indices = catalog.getBucketedVisibleIndices()
			const maxMagnitude = starSymbolMagnitudeLimitAtZoom(this.transform.k, this.options.stars.maxMagnitude)

			for (let i = 0; i < catalog.visibleCount; i++) {
				const index = indices[i]

				if (catalog.mag[index] > maxMagnitude) {
					continue
				}

				applyViewTransform(catalog.screenX[index], catalog.screenY[index], this.options.width, this.options.height, this.transform, this.tempScreen)
				this.picking.add(PICK_TYPE_STAR, index, this.tempScreen[0], this.tempScreen[1], catalog.mag[index])
			}
		}

		if (this.isLayerVisible('deepSky')) {
			for (let i = 0; i < this.dsos.length; i++) {
				const object = this.dsos[i]

				if (!isDeepSkyObjectVisibleAtZoom(object, this.transform.k)) {
					continue
				}

				if (this.projectEquatorialToScreen(object.rightAscension, object.declination, this.tempScreen) && isPointInsideViewportMargin(this.tempScreen[0], this.tempScreen[1], this.options.width, this.options.height, DSO_VIEWPORT_MARGIN)) {
					this.picking.add(PICK_TYPE_DSO, i, this.tempScreen[0], this.tempScreen[1], deepSkyMagnitude(object))
				}
			}
		}

		if (this.isLayerVisible('movingBodies')) {
			for (let i = 0; i < this.movingBodyList.length; i++) {
				const object = this.movingBodyList[i]

				if (object.visible === false || object.selectable === false || !isMovingBodyVisibleAtZoom(object, this.transform.k)) {
					continue
				}

				if (this.projectEquatorialToScreen(object.position.rightAscension, object.position.declination, this.tempScreen)) {
					this.picking.add(PICK_TYPE_MOVING_BODY, i, this.tempScreen[0], this.tempScreen[1], movingBodyMagnitude(object))
				}
			}
		}

		const labels = this.constellations.labels ?? []

		if (this.isLayerVisible('constellationLabels') && this.transform.k >= 0.75) {
			for (let i = 0; i < labels.length; i++) {
				const label = labels[i]

				if (this.projectEquatorialToScreen(label.rightAscension, label.declination, this.tempScreen)) {
					this.picking.add(PICK_TYPE_CONSTELLATION_LABEL, i, this.tempScreen[0], this.tempScreen[1], 3)
				}
			}
		}

		if (this.isLayerVisible('shapes')) {
			for (let i = 0; i < this.shapeList.length; i++) {
				const shape = this.shapeList[i]

				if (shape.visible === false || shape.selectable === false) {
					continue
				}

				if (this.projectEquatorialToScreen(shape.coordinate.rightAscension, shape.coordinate.declination, this.tempScreen)) {
					const index = this.pickedShapes.length
					this.pickedShapes.push(shape)
					this.picking.add(PICK_TYPE_SHAPE, index, this.tempScreen[0], this.tempScreen[1], -8)
				}
			}
		}
	}

	private ensurePickingIndex() {
		if (!this.pickingDirty) return

		this.rebuildPickingIndex()
	}

	// Schedules one animation-frame render.
	private requestRender() {
		if (this.frameId || this.destroyed) return

		this.frameId = requestAnimationFrame(() => {
			this.frameId = 0
			this.flushRender()
		})
	}

	// Flushes dirty layers.
	private flushRender() {
		const emitRenderStart = this.emitter.has('renderStart')
		const emitRenderEnd = this.emitter.has('renderEnd')
		const start = emitRenderEnd ? performance.now() : 0
		emitRenderStart && this.emitter.emit('renderStart', { time: this.options.time })
		this.renderer.render(this.createRenderState())

		if (emitRenderEnd) {
			const duration = performance.now() - start
			const fps = duration > 0 ? 1000 / duration : 0
			this.emitter.emit('renderEnd', { time: this.options.time, duration, fps })
		}
	}

	// Creates the render state passed to layers.
	private createRenderState(): RenderState {
		return {
			celestial: this,
			width: this.options.width,
			height: this.options.height,
			dpr: this.renderer.devicePixelRatio,
			time: this.options.time,
			observer: this.options.observer,
			projection: this.options.projection,
			coordinateSystem: this.options.coordinateSystem,
			transform: this.transform,
			projectionRadius: projectionScale(this.options.width, this.options.height, this.options.projection),
			referenceLines: this.options.referenceLines,
			stars: this.options.stars,
			theme: this.options.theme,
			starCatalog: this.starCatalog,
			constellations: this.constellations,
			milkyWay: this.milkyWay,
			dsos: this.dsos,
			deepSkyLabelVisible: this.deepSkyLabelVisible,
			movingBodies: this.movingBodyList,
			shapes: this.shapeList,
			hoverObject: this.hoverObject,
			selectedObject: this.selectedObject,
			projectEquatorialToScreen: this.projectEquatorialToScreen,
			projectHorizontalToScreen: this.projectHorizontalToScreen,
			equatorialVisibility: this.equatorialVisibility,
			horizontalVisibility: this.horizontalVisibility,
			// __projectWorldVector: this.projectWorldVectorToScreen,
		}
	}

	// Resolves a pick index into a public object payload.
	private resolvePick(index: PickIndex | null): CelestialObject | null {
		if (!index) return null

		switch (index.type) {
			case PICK_TYPE_STAR:
				return this.starCatalog?.getObject(index.index) ?? null
			case PICK_TYPE_DSO:
				return this.dsos[index.index] ? { type: 'deepSky', index: index.index, object: this.dsos[index.index] } : null
			case PICK_TYPE_MOVING_BODY:
				return this.movingBodyList[index.index] ? { type: 'movingBody', index: index.index, object: this.movingBodyList[index.index] } : null
			case PICK_TYPE_CONSTELLATION_LABEL: {
				const label = this.constellations.labels?.[index.index]
				return label ? { type: 'constellationLabel', index: index.index, label } : null
			}
			case PICK_TYPE_SHAPE: {
				const shape = this.pickedShapes[index.index]
				return shape ? { type: 'shape', id: shape.id, shape } : null
			}
			default:
				return null
		}
	}

	private resolvePointerPick(index: PickIndex | null): CelestialObject | null {
		if (pickMatchesObject(index, this.hoverObject)) {
			return this.hoverObject
		}

		return this.resolvePick(index)
	}

	// Emits an error event without throwing inside render/update loops.
	private emitError(error: Error) {
		this.emitter.emit('error', error)
	}

	// Binds local pointer interactions used as fallback and baseline.
	private bindLocalInteractions() {
		if (!this.options.interactions.enabled) return

		const element = this.renderer.element
		element.addEventListener('pointerdown', this.handlePointerDown)
		element.addEventListener('pointermove', this.handlePointerMove)
		element.addEventListener('click', this.handleClick)
		element.addEventListener('wheel', this.handleWheel, { passive: false })
		document.addEventListener('pointerup', this.handlePointerUp)
		document.addEventListener('pointercancel', this.handlePointerUp)
	}

	// Removes local pointer interactions.
	private unbindLocalInteractions() {
		const element = this.renderer.element
		element.removeEventListener('pointerdown', this.handlePointerDown)
		element.removeEventListener('pointermove', this.handlePointerMove)
		element.removeEventListener('click', this.handleClick)
		element.removeEventListener('wheel', this.handleWheel)
		document.removeEventListener('pointerup', this.handlePointerUp)
		document.removeEventListener('pointercancel', this.handlePointerUp)
	}

	// Binds D3 zoom for pan/zoom and local listeners for picking.
	private bindD3Zoom() {
		if (!this.options.interactions.enabled || this.d3ZoomBound) return

		const behavior = zoom<HTMLElement, unknown>()
			.scaleExtent([this.options.interactions.minZoom, this.options.interactions.maxZoom])
			.wheelDelta((event: WheelEvent) => -(normalizedWheelDeltaY(event) * this.options.interactions.wheelZoomSpeed) / Math.LN2)
			.on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
				const k = event.transform.k
				const transform = this.normalizeViewTransform({ x: event.transform.x - (this.options.width / 2) * (1 - k), y: event.transform.y - (this.options.height / 2) * (1 - k), k })

				if (this.writeViewTransform(transform)) {
					this.afterTransformChanged()
				}
			})

		const element = this.renderer.element
		element.addEventListener('pointermove', this.handlePointerMove)
		element.addEventListener('click', this.handleClick)
		select(element).call(behavior)
		this.d3ZoomBehavior = behavior
		this.d3ZoomBound = true
	}

	// Unbinds D3 zoom listeners.
	private unbindD3Zoom() {
		if (!this.d3ZoomBound) return

		select(this.renderer.element).on('.zoom', null)
		this.d3ZoomBehavior = null
		this.d3ZoomBound = false
	}

	// Handles pointer down for local panning.
	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) return

		this.pointerDown = true
		this.pointerMoved = false
		this.pointerStartX = event.clientX
		this.pointerStartY = event.clientY
		this.transformStartX = this.transform.x
		this.transformStartY = this.transform.y
		this.renderer.element.setPointerCapture?.(event.pointerId)
	}

	// Handles pointer movement for panning and hover picking.
	private readonly handlePointerMove = (event: PointerEvent): void => {
		const now = performance.now()

		if (this.pointerDown) {
			const dx = event.clientX - this.pointerStartX
			const dy = event.clientY - this.pointerStartY
			this.pointerMoved ||= Math.abs(dx) + Math.abs(dy) > 3
			this.transform.x = this.transformStartX + dx
			this.transform.y = this.transformStartY + dy
			this.afterTransformChanged()
			return
		}

		if (now - this.lastPointerMove < this.options.interactions.pointerMoveThrottleMs) return

		this.lastPointerMove = now
		const point = this.eventPoint(event)
		const x = point[0]
		const y = point[1]

		this.ensurePickingIndex()
		const object = this.resolvePointerPick(this.picking.findNearest(x, y, this.options.interactions.pickRadius))

		if (this.emitter.has('hover')) {
			const coordinate = this.screenToEquatorial(x, y)

			if (coordinate) {
				this.emitter.emit('hover', { x, y, coordinate, object })
			}
		}

		this.updateHover(object)
	}

	// Handles pointer up.
	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (!this.pointerDown) return

		this.pointerDown = false
		this.renderer.element.releasePointerCapture?.(event.pointerId)
	}

	// Handles click selection.
	private readonly handleClick = (event: MouseEvent): void => {
		if (this.pointerMoved) return

		const point = this.eventPoint(event)
		const x = point[0]
		const y = point[1]

		this.ensurePickingIndex()
		const object = this.resolvePick(this.picking.findNearest(x, y, this.options.interactions.pickRadius))

		if (this.emitter.has('click')) {
			const coordinate = this.screenToEquatorial(x, y)

			if (coordinate) {
				this.emitter.emit('click', { x, y, coordinate, object })
			}
		}

		if (!object) return

		this.selectedObject = object
		this.renderer.markDirty('overlay')
		this.emitter.has('selectionChange') && this.emitter.emit('selectionChange', { object })
		this.requestRender()
	}

	// Handles wheel zoom centered on the pointer.
	private readonly handleWheel = (event: WheelEvent): void => {
		event.preventDefault()

		const point = this.eventPoint(event)
		const previousK = this.transform.k
		const nextK = clamp(previousK * Math.exp(-normalizedWheelDeltaY(event) * this.options.interactions.wheelZoomSpeed), this.options.interactions.minZoom, this.options.interactions.maxZoom)

		if (nextK === previousK) return

		const cx = this.options.width / 2
		const cy = this.options.height / 2
		const worldX = (point[0] - cx - this.transform.x) / previousK
		const worldY = (point[1] - cy - this.transform.y) / previousK
		this.transform.k = nextK
		this.transform.x = point[0] - cx - worldX * nextK
		this.transform.y = point[1] - cy - worldY * nextK
		this.afterTransformChanged()
	}

	private normalizeViewTransform(transform: ViewTransform): ViewTransform {
		return {
			x: isFiniteNumber(transform.x) ? transform.x : 0,
			y: isFiniteNumber(transform.y) ? transform.y : 0,
			k: clamp(isFiniteNumber(transform.k) ? transform.k : 1, this.options.interactions.minZoom, this.options.interactions.maxZoom),
		}
	}

	private writeViewTransform(transform: ViewTransform) {
		if (transform.x === this.transform.x && transform.y === this.transform.y && transform.k === this.transform.k) return false
		this.transform = transform
		return true
	}

	private syncD3ZoomTransform(transform: ViewTransform) {
		if (!this.d3ZoomBehavior) return

		const d3Transform = zoomIdentity.translate(transform.x + (this.options.width / 2) * (1 - transform.k), transform.y + (this.options.height / 2) * (1 - transform.k)).scale(transform.k)

		select(this.renderer.element).property('__zoom', d3Transform)
	}

	// Updates rendering and picking after pan/zoom transform changes.
	private afterTransformChanged() {
		this.pickingDirty = true
		this.renderer.markAllDirty()
		this.emitter.has('viewTransformChange') && this.emitter.emit('viewTransformChange', { transform: this.transform })
		this.requestRender()
	}

	// Updates hover state and events.
	private updateHover(object: CelestialObject | null) {
		if (sameObject(this.hoverObject, object)) return

		if (this.hoverObject && this.emitter.has('objectLeave')) {
			this.emitter.emit('objectLeave', { object: this.hoverObject })
		}

		this.hoverObject = object

		if (object && this.emitter.has('objectHover')) {
			this.emitter.emit('objectHover', { object })
		}

		this.renderer.markDirty('overlay')
		this.requestRender()
	}

	// Converts pointer event coordinates into renderer-local coordinates.
	private eventPoint(event: MouseEvent | PointerEvent | WheelEvent) {
		const rect = this.renderer.element.getBoundingClientRect()
		this.tempScreen[0] = event.clientX - rect.left
		this.tempScreen[1] = event.clientY - rect.top
		return this.tempScreen
	}
}

// Checks whether the internal pick still points at the current hover object.
function pickMatchesObject(index: PickIndex | null, object: CelestialObject | null) {
	if (!index || !object) {
		return index === null && object === null
	}

	switch (index.type) {
		case PICK_TYPE_STAR:
			return object.type === 'star' && object.index === index.index
		case PICK_TYPE_DSO:
			return object.type === 'deepSky' && object.index === index.index
		case PICK_TYPE_MOVING_BODY:
			return object.type === 'movingBody' && object.index === index.index
		case PICK_TYPE_CONSTELLATION_LABEL:
			return object.type === 'constellationLabel' && object.index === index.index
		case PICK_TYPE_SHAPE:
			return false
		default:
			return false
	}
}

function isPickableLayerId(layerId: string) {
	switch (layerId) {
		case 'stars':
		case 'deepSky':
		case 'movingBodies':
		case 'constellationLabels':
		case 'shapes':
			return true
		default:
			return false
	}
}

function objectLayerId(object: CelestialObject) {
	switch (object.type) {
		case 'star':
			return 'stars'
		case 'deepSky':
			return 'deepSky'
		case 'movingBody':
			return 'movingBodies'
		case 'constellationLabel':
			return 'constellationLabels'
		case 'shape':
			return 'shapes'
	}
}

// Compares nullable object identity by semantic type/index.
function sameObject(a: CelestialObject | null, b: CelestialObject | null) {
	if (a === b) {
		return true
	}

	if (!a || !b || a.type !== b.type) return false

	if (a.type === 'shape' && b.type === 'shape') {
		return a.id === b.id
	}

	if (a.type === 'movingBody' && b.type === 'movingBody') {
		return a.object.id === b.object.id
	}

	return 'index' in a && 'index' in b && a.index === b.index
}

// Normalizes thrown values to Error instances.
function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}
