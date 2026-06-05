import { select } from 'd3-selection'
import { type D3ZoomEvent, zoom } from 'd3-zoom'
import { deg, normalizeAngle, type Angle } from 'nebulosa/src/angle'
import { DEG2RAD, PI, PIOVERTWO, TAU } from 'nebulosa/src/constants'
import type { EquatorialCoordinate } from 'nebulosa/src/coordinate'
import { clamp, type NumberArray } from 'nebulosa/src/math'

// Public coordinate/projection options.
export type ProjectionType = 'azimuthalEquidistant' | 'azimuthalEqualArea' | 'orthographic' | 'stereographic' | 'gnomonic'

// Public coordinate-system options.
export type CoordinateSystem = 'horizontal' | 'equatorial'

// Supported event names emitted by Celestial.
export type CelestialEventName = 'hover' | 'click' | 'objectHover' | 'objectLeave' | 'selectionChange' | 'renderStart' | 'renderEnd' | 'updateStart' | 'updateEnd' | 'resize' | 'error'

export type CelestialTime = Date | number

// Observer location in geodetic degrees/meters.
export interface ObserverLocation {
	latitude: number
	longitude: number
	elevation?: number
}

// Star object input for convenient object-array loading.
export interface Star extends EquatorialCoordinate {
	id?: string
	name?: string
	mag?: number
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
	pmRa?: NumberArray
	pmDec?: NumberArray
	flags?: NumberArray
	names?: string[]
	ids?: string[]
	epoch?: number
	count?: number
}

// Constellation line segment.
export interface ConstellationLine {
	from: EquatorialCoordinate
	to: EquatorialCoordinate
	constellation?: string
}

// Constellation label entry.
export interface ConstellationLabel extends EquatorialCoordinate {
	id?: string
	name: string
}

// Constellation data consumed by line/label layers.
export interface ConstellationData {
	lines?: ConstellationLine[]
	labels?: ConstellationLabel[]
	boundaries?: ConstellationLine[]
}

// Deep-sky object shape.
export interface DeepSkyObject extends EquatorialCoordinate {
	id?: string
	name?: string
	type: 'galaxy' | 'nebula' | 'openCluster' | 'globularCluster' | 'planetaryNebula' | 'other'
	mag?: number
	sizeArcMin?: number
}

// Solar-system body ids are intentionally open for custom providers.
export type SolarSystemBody = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | (string & {})

// Ephemeris providers can be replaced by accurate implementations later.
export interface EphemerisProvider {
	readonly positionAt: (body: SolarSystemBody, time: number) => EquatorialCoordinate
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
	constellations: {
		color: string
		opacity: number
		labelColor: string
		labelFont: string
	}
	deepSky: {
		color: string
		labelColor: string
	}
	planets: {
		color: string
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
	ephemerisProvider?: EphemerisProvider
	solarSystemBodies?: SolarSystemBody[]
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
	readonly deepSkyObjects: readonly Readonly<DeepSkyObject>[]
	readonly planets: readonly Readonly<PlanetRenderObject>[]
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

export interface CelestialShape {
	readonly id: string
	readonly coordinate: EquatorialCoordinate
	readonly visible?: boolean
	readonly selectable?: boolean
	readonly render: (celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) => void
}

// Public object shape used by picking/events.
export type CelestialObject =
	| { type: 'star'; index: number; id?: string; name?: string; mag?: number; ra: number; dec: number }
	| { type: 'deepSky'; index: number; object: DeepSkyObject }
	| { type: 'planet'; index: number; body: SolarSystemBody; position: EquatorialCoordinate }
	| { type: 'constellationLabel'; index: number; label: ConstellationLabel }
	| { type: 'shape'; id: string; shape: CelestialShape }

export type CelestialEventMap = {
	readonly hover: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null }>
	readonly click: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null }>
	readonly objectHover: Readonly<{ object: CelestialObject }>
	readonly objectLeave: Readonly<{ object: CelestialObject }>
	readonly selectionChange: Readonly<{ object: CelestialObject }>
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

type PlanetRenderObject = {
	readonly body: SolarSystemBody
	readonly position: EquatorialCoordinate
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
	readonly ephemerisProvider?: EphemerisProvider
	readonly solarSystemBodies: SolarSystemBody[]
}

const J2000_EPOCH = 2000
const J2000_UNIX_MS = 946728000000
const JULIAN_EPOCH = 2440587.5
const DAY_MS = 86400000
const YEAR_MS = 365.25 * DAY_MS
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 800
const DEFAULT_UPDATE_INTERVAL = 10000
const HORIZON_EPSILON = 1e-7
const POLE_EPSILON = 1e-10
const PROJECTION_PADDING = 10
const STAR_RADIUS_BUCKETS = 6
const STAR_COLOR_BUCKETS = 16
const STAR_STYLE_BUCKETS = STAR_RADIUS_BUCKETS * STAR_COLOR_BUCKETS
const VECTOR_STAR_ZOOM_THRESHOLD = 2.25
const VECTOR_STAR_MAX_COUNT = 20000
const VECTOR_STAR_MAX_RADIUS_SCALE = 3
const STAR_LABEL_MAX_COUNT = 96
const STAR_LABEL_BASE_MAGNITUDE = 1.5
const STAR_LABEL_MAGNITUDE_PER_ZOOM = 1.8
const STAR_LABEL_MIN_SPACING = 36
const STAR_LABEL_OFFSET_X = 7
const STAR_LABEL_OFFSET_Y = -7
const PICK_TYPE_STAR = 1
const PICK_TYPE_DSO = 2
const PICK_TYPE_PLANET = 3
const PICK_TYPE_CONSTELLATION_LABEL = 4
const PICK_TYPE_SHAPE = 5

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
	constellations: {
		color: '#b8bcc4',
		opacity: 0.72,
		labelColor: '#b9c1b6',
		labelFont: '10px system-ui, sans-serif',
	},
	deepSky: {
		color: '#ff9d00',
		labelColor: '#ffb000',
	},
	planets: {
		color: '#ffb000',
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
	constellations: true,
	constellationLabels: true,
	referenceLines: true,
	grid: true,
	horizon: true,
	deepSky: true,
	planets: false,
	shapes: true,
	overlay: true,
}

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
	maxZoom: 24,
	pickRadius: 7,
	pointerMoveThrottleMs: 32,
	preferD3Zoom: true,
}

const DEFAULT_SOLAR_SYSTEM_BODIES: SolarSystemBody[] = ['sun', 'moon', 'mercury', 'venus', 'mars', 'jupiter', 'saturn']

// Returns true for finite numbers only.
function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
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
	const lat = deg(observer.latitude)
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

	if (length <= 1e-12) {
		return false
	}

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
	if (!Number.isFinite(x) || !Number.isFinite(y)) {
		return false
	}

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

// Deep-merges theme options without mutating defaults.
function mergeTheme(theme?: PartialThemeOptions): ThemeOptions {
	return {
		background: theme?.background ?? DEFAULT_THEME.background,
		stars: { ...DEFAULT_THEME.stars, ...theme?.stars },
		grid: { ...DEFAULT_THEME.grid, ...theme?.grid },
		horizon: { ...DEFAULT_THEME.horizon, ...theme?.horizon },
		constellations: { ...DEFAULT_THEME.constellations, ...theme?.constellations },
		deepSky: { ...DEFAULT_THEME.deepSky, ...theme?.deepSky },
		planets: { ...DEFAULT_THEME.planets, ...theme?.planets },
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
		interactions: { ...DEFAULT_INTERACTION_OPTIONS, ...options.interactions },
		ephemerisProvider: options.ephemerisProvider,
		solarSystemBodies: options.solarSystemBodies ?? DEFAULT_SOLAR_SYSTEM_BODIES,
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
	readonly flags?: NumberArray
	readonly names?: string[]
	readonly ids?: string[]
	readonly namedIndices?: Int32Array
	readonly count: number

	private readonly pmRA?: NumberArray
	private readonly pmDEC?: NumberArray
	private readonly epochs?: NumberArray
	private readonly styleBucket: Uint16Array
	private readonly visibleIndices: NumberArray
	private readonly bucketedVisibleIndices: NumberArray
	private readonly bucketCounts = new Int32Array(STAR_STYLE_BUCKETS)
	private readonly bucketStarts = new Int32Array(STAR_STYLE_BUCKETS + 1)
	private preparedEpoch = Number.NaN
	visibleCount = 0

	constructor(input: Star[] | StarCatalogInput) {
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
		this.pmRA = data.pmRa
		this.pmDEC = data.pmDec
		this.epochs = data.epochs
		this.eqX = new Float32Array(this.count)
		this.eqY = new Float32Array(this.count)
		this.eqZ = new Float32Array(this.count)
		this.screenX = new Float32Array(this.count)
		this.screenY = new Float32Array(this.count)
		this.visible = new Uint8Array(this.count)
		this.styleBucket = new Uint16Array(this.count)
		this.visibleIndices = new Int32Array(this.count)
		this.bucketedVisibleIndices = new Int32Array(this.count)
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

	// Builds contiguous style buckets for renderer state locality.
	finalizeProjectionBuckets() {
		let cursor = 0

		for (let bucket = 0; bucket < STAR_STYLE_BUCKETS; bucket++) {
			this.bucketStarts[bucket] = cursor
			cursor += this.bucketCounts[bucket]
		}

		this.bucketStarts[STAR_STYLE_BUCKETS] = cursor

		const writeOffsets = new Int32Array(this.bucketStarts)

		for (let i = 0; i < this.visibleCount; i++) {
			const index = this.visibleIndices[i]
			const bucket = this.styleBucket[index]
			this.bucketedVisibleIndices[writeOffsets[bucket]++] = index
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
}

// Normalizes object-array and typed-array star inputs into typed arrays.
function normalizeStarInput(input: Star[] | StarCatalogInput) {
	if (Array.isArray(input)) {
		const count = input.length
		const ra = new Float32Array(count)
		const dec = new Float32Array(count)
		const mag = new Float32Array(count)
		const bv = new Float32Array(count)
		const pmRa = new Float32Array(count)
		const pmDec = new Float32Array(count)
		const flags = new Uint8ClampedArray(count)
		const epochs = new Float32Array(count)
		const names: string[] = []
		const ids: string[] = []
		let hasBv = false
		let hasPm = false
		let hasFlags = false
		let hasNames = false
		let hasIds = false

		for (let i = 0; i < count; i++) {
			const star = input[i]

			ra[i] = normalizeAngle(isFiniteNumber(star.rightAscension) ? star.rightAscension : 0)
			dec[i] = clamp(isFiniteNumber(star.declination) ? star.declination : 0, -PIOVERTWO, PIOVERTWO)
			mag[i] = isFiniteNumber(star.mag) ? star.mag : 99

			if (isFiniteNumber(star.bv)) {
				bv[i] = star.bv
				hasBv = true
			}

			if (isFiniteNumber(star.pmRA) || isFiniteNumber(star.pmDEC)) {
				pmRa[i] = star.pmRA ?? 0
				pmDec[i] = star.pmDEC ?? 0
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
			pmRa: hasPm ? pmRa : undefined,
			pmDec: hasPm ? pmDec : undefined,
			flags: hasFlags ? flags : undefined,
			epochs,
			names: hasNames ? names : undefined,
			ids: hasIds ? ids : undefined,
		} as const
	}

	const count = Math.min(input.count ?? input.ra.length, input.ra.length, input.dec.length)
	const ra = copyFloat32(input.ra, count, 0, normalizeAngle)
	const dec = copyFloat32(input.dec, count, 0, (value) => clamp(value, -PIOVERTWO, PIOVERTWO))
	const mag = input.mag ? copyFloat32(input.mag, count, 99) : fillFloat32(count, 99)
	const bv = input.bv ? copyFloat32(input.bv, count, 0.65) : undefined
	const pmRa = input.pmRa ? copyFloat32(input.pmRa, count, 0) : undefined
	const pmDec = input.pmDec ? copyFloat32(input.pmDec, count, 0) : undefined
	const flags = input.flags ? copyUint8(input.flags, count) : undefined
	const epochs = fillFloat32(count, input.epoch ?? J2000_EPOCH)

	return { count, ra, dec, mag, bv, pmRa, pmDec, flags, epochs, names: input.names, ids: input.ids } as const
}

// Builds a compact index of labelable stars so render scans avoid unnamed catalog rows.
function collectNamedIndices(names: string[], count: number) {
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

		return bestEntry >= 0 ? { type: this.type[bestEntry], index: this.index[bestEntry] } : null
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
	if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) {
		return false
	}

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

interface GridBoundaryLabelPoint {
	readonly x: number
	readonly y: number
	readonly edge: GridBoundaryEdge
}

interface GridBoundaryLabelRect {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

const GRID_BOUNDARY_LABEL_INSET = 8
const GRID_BOUNDARY_LABEL_PADDING_X = 3
const GRID_BOUNDARY_LABEL_PADDING_Y = 1
const GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ = 14 * 14

function projectionBoundaryFullyVisibleInViewport(state: RenderState) {
	if (!isFiniteDiskProjection(state.projection)) {
		return false
	}

	const cx = projectionCenterX(state)
	const cy = projectionCenterY(state)
	const radius = transformedProjectionRadius(state)

	if (radius <= 0) {
		return false
	}

	return cx - radius >= 0 && cx + radius <= state.width && cy - radius >= 0 && cy + radius <= state.height
}

function appendUniqueGridBoundaryLabelPoint(points: GridBoundaryLabelPoint[], point: GridBoundaryLabelPoint) {
	for (let i = 0; i < points.length; i++) {
		const dx = points[i].x - point.x
		const dy = points[i].y - point.y

		if (dx * dx + dy * dy <= GRID_BOUNDARY_LABEL_DEDUPE_DISTANCE_SQ) {
			return
		}
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
		if (t < -epsilon || t > 1 + epsilon) {
			return
		}

		const x = x0 + dx * t
		const y = y0 + dy * t

		if (x < -epsilon || x > state.width + epsilon || y < -epsilon || y > state.height + epsilon) {
			return
		}

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

function drawGridBoundaryLabel(ctx: CanvasRenderingContext2D, state: RenderState, label: string, point: GridBoundaryLabelPoint, occupied: GridBoundaryLabelRect[]) {
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

	const rect = {
		x: x - width / 2,
		y: y - height / 2,
		width,
		height,
	}

	for (let i = 0; i < occupied.length; i++) {
		if (gridBoundaryLabelRectIntersects(rect, occupied[i])) {
			return
		}
	}

	occupied.push(rect)
	ctx.fillStyle = 'rgba(0, 0, 0, 0.68)'
	ctx.fillRect(rect.x, rect.y, rect.width, rect.height)
	ctx.fillStyle = state.theme.grid.color
	ctx.fillText(label, x, y)
}

// Grid layer draws coarse equatorial or horizontal reference lines.
class GridLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)
	private readonly labelPoints: GridBoundaryLabelPoint[] = []
	private readonly labelRects: GridBoundaryLabelRect[] = []

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

	private raProjectedSampler(t: number, dec: Angle, out: NumberArray, state: RenderState): number {
		const ra = t * TAU
		return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
	}

	private decProjectedSampler(t: number, ra: Angle, out: NumberArray, state: RenderState): number {
		const dec = -PIOVERTWO + t * PI
		return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
	}

	// Draws RA/Dec grid lines.
	private renderEquatorialGrid(ctx: CanvasRenderingContext2D, state: RenderState) {
		for (let decDeg = -85; decDeg <= 85; decDeg += 10) {
			const dec = deg(decDeg)

			ctx.beginPath()
			drawClippedPolyline(ctx, state, 360, this.point, this.previous, (t, out) => this.raProjectedSampler(t, dec, out, state))
			ctx.stroke()
		}

		for (let raHour = 0; raHour < 24; raHour += 1) {
			const ra = (raHour / 24) * TAU

			ctx.beginPath()
			drawClippedPolyline(ctx, state, 240, this.point, this.previous, (t, out) => this.decProjectedSampler(t, ra, out, state))
			ctx.stroke()
		}

		this.renderEquatorialGridLabels(ctx, state)
	}

	private renderEquatorialGridLabels(ctx: CanvasRenderingContext2D, state: RenderState) {
		const useViewportBoundary = !projectionBoundaryFullyVisibleInViewport(state)
		this.labelRects.length = 0

		ctx.save()
		ctx.globalAlpha = Math.min(0.95, Math.max(0.58, state.theme.grid.opacity + 0.28))
		ctx.font = skyLabelFont(state, 9)
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'

		for (let decDeg = -85; decDeg <= 85; decDeg += 10) {
			const dec = deg(decDeg)

			findGridBoundaryLabelPoints(state, 360, this.point, (t, out) => this.raProjectedSampler(t, dec, out, state), useViewportBoundary, this.labelPoints)

			for (let i = 0; i < this.labelPoints.length; i++) {
				drawGridBoundaryLabel(ctx, state, decDeg.toFixed(0), this.labelPoints[i], this.labelRects)
			}
		}

		for (let raHour = 0; raHour < 24; raHour += 1) {
			const ra = (raHour / 24) * TAU

			findGridBoundaryLabelPoints(state, 240, this.point, (t, out) => this.decProjectedSampler(t, ra, out, state), useViewportBoundary, this.labelPoints)

			for (let i = 0; i < this.labelPoints.length; i++) {
				drawGridBoundaryLabel(ctx, state, `${raHour}h`, this.labelPoints[i], this.labelRects)
			}
		}

		ctx.restore()
	}
}

// Reference-line renderer for local meridian, celestial equator, and ecliptic of date.
class ReferenceLineLayer extends InternalLayer {
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)

	constructor() {
		super('referenceLines', 25)
	}

	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.save()
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

		drawClippedPolyline(ctx, state, 120, this.point, this.previous, (t, out) => {
			const alt = t * PIOVERTWO
			return writeProjectedSample(out, state.horizontalVisibility(0, alt), state.projectHorizontalToScreen(0, alt, out))
		})

		drawClippedPolyline(ctx, state, 120, this.point, this.previous, (t, out) => {
			const alt = (1 - t) * PIOVERTWO
			return writeProjectedSample(out, state.horizontalVisibility(PI, alt), state.projectHorizontalToScreen(PI, alt, out))
		})

		ctx.stroke()
	}

	private drawCelestialEquator(ctx: CanvasRenderingContext2D, state: RenderState) {
		const style = state.referenceLines.celestialEquator

		if (!style.enabled) return

		this.applyStyle(ctx, style)

		ctx.beginPath()

		drawClippedPolyline(ctx, state, 360, this.point, this.previous, (t, out) => {
			const ra = t * TAU
			return writeProjectedSample(out, state.equatorialVisibility(ra, 0), state.projectEquatorialToScreen(ra, 0, out))
		})

		ctx.stroke()
	}

	private drawEcliptic(ctx: CanvasRenderingContext2D, state: RenderState) {
		const style = state.referenceLines.ecliptic

		if (!style.enabled) return

		const obliquity = meanObliquity(state.time)
		const cosObliquity = Math.cos(obliquity)
		const sinObliquity = Math.sin(obliquity)
		this.applyStyle(ctx, style)
		ctx.beginPath()

		drawClippedPolyline(ctx, state, 360, this.point, this.previous, (t, out) => {
			const lambda = t * TAU
			const sinLambda = Math.sin(lambda)
			const ra = normalizeAngle(Math.atan2(sinLambda * cosObliquity, Math.cos(lambda)))
			const dec = Math.asin(clamp(sinLambda * sinObliquity, -1, 1))
			return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
		})

		ctx.stroke()
	}

	private applyStyle(ctx: CanvasRenderingContext2D, style: ResolvedReferenceLineOptions) {
		ctx.strokeStyle = style.color
		ctx.lineWidth = style.lineWidth
	}
}

// Constellation line renderer.
class ConstellationLineLayer extends InternalLayer {
	private readonly fromVector = new Float32Array(3)
	private readonly toVector = new Float32Array(3)
	private readonly sampleVector = new Float32Array(3)
	private readonly point = new Float32Array(2)
	private readonly previous = new Float32Array(2)

	constructor() {
		super('constellations', 30)
	}

	// Draws supplied constellation line segments.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		this.drawSegments(ctx, state, state.constellations.boundaries ?? [], state.theme.constellations.opacity * 0.38, 0.55)
		this.drawSegments(ctx, state, state.constellations.lines ?? [], state.theme.constellations.opacity, 0.9)
	}

	private drawSegments(ctx: CanvasRenderingContext2D, state: RenderState, lines: ConstellationLine[], alpha: number, lineWidth: number) {
		ctx.strokeStyle = state.theme.constellations.color
		ctx.globalAlpha = alpha
		ctx.lineWidth = lineWidth
		ctx.beginPath()

		for (let i = 0; i < lines.length; i++) {
			this.drawSegment(ctx, state, lines[i])
		}

		ctx.stroke()
		ctx.globalAlpha = 1
	}

	private drawSegment(ctx: CanvasRenderingContext2D, state: RenderState, line: ConstellationLine) {
		writeRaDecUnitVector(line.from.rightAscension, line.from.declination, this.fromVector)
		writeRaDecUnitVector(line.to.rightAscension, line.to.declination, this.toVector)

		const distance = angularDistance(this.fromVector[0], this.fromVector[1], this.fromVector[2], this.toVector[0], this.toVector[1], this.toVector[2])
		const steps = Math.max(8, Math.min(180, Math.ceil(distance / deg(1))))

		drawClippedPolyline(ctx, state, steps, this.point, this.previous, (t, out) => {
			const u = 1 - t

			this.sampleVector[0] = this.fromVector[0] * u + this.toVector[0] * t
			this.sampleVector[1] = this.fromVector[1] * u + this.toVector[1] * t
			this.sampleVector[2] = this.fromVector[2] * u + this.toVector[2] * t

			if (!normalizeVector(this.sampleVector)) {
				return writeProjectedSample(out, Number.NaN, false)
			}

			const ra = normalizeAngle(Math.atan2(this.sampleVector[1], this.sampleVector[0]))
			const dec = Math.asin(clamp(this.sampleVector[2], -1, 1))
			return writeProjectedSample(out, state.equatorialVisibility(ra, dec), state.projectEquatorialToScreen(ra, dec, out))
		})
	}
}

// Deep-sky object renderer.
class DeepSkyObjectLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	constructor() {
		super('deepSky', 40)
	}

	// Draws simple predictable DSO symbols.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.strokeStyle = state.theme.deepSky.color
		ctx.fillStyle = state.theme.deepSky.color
		ctx.lineWidth = 1
		ctx.font = state.theme.constellations.labelFont
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		for (let i = 0; i < state.deepSkyObjects.length; i++) {
			const object = state.deepSkyObjects[i]

			if (isFiniteNumber(object.mag) && object.mag > 14) {
				continue
			}

			if (!state.projectEquatorialToScreen(object.rightAscension, object.declination, this.point)) {
				continue
			}

			const radius = clamp((object.sizeArcMin ?? 4) / 5, 3, 12) * Math.sqrt(state.transform.k)
			drawDsoSymbol(ctx, object.type, this.point[0], this.point[1], radius)

			if (object.name && (state.transform.k >= 0.75 || (object.mag ?? 99) <= 8)) {
				ctx.fillStyle = state.theme.deepSky.labelColor
				ctx.fillText(object.name, this.point[0] + radius + 4, this.point[1] - radius * 0.35)
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
	private readonly labelIndices = new Int32Array(STAR_LABEL_MAX_COUNT)
	private readonly labelMagnitudes = new Float32Array(STAR_LABEL_MAX_COUNT)
	private readonly labelX = new Float32Array(STAR_LABEL_MAX_COUNT)
	private readonly labelY = new Float32Array(STAR_LABEL_MAX_COUNT)

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

		ctx.save()
		ctx.translate(width / 2 + transform.x, height / 2 + transform.y)
		ctx.scale(transform.k, transform.k)
		ctx.translate(-width / 2, -height / 2)

		catalog.forEachBucket((bucket, indices, start, end) => {
			const style = this.styles[bucket]

			if (style.radius <= 0.8) {
				ctx.fillStyle = style.color

				for (let i = start; i < end; i++) {
					const index = indices[i]
					ctx.fillRect(catalog.screenX[index], catalog.screenY[index], 1, 1)
				}
			} else {
				const sprite = style.sprite
				const halfSize = style.halfSize

				for (let i = start; i < end; i++) {
					const index = indices[i]
					ctx.drawImage(sprite, catalog.screenX[index] - halfSize, catalog.screenY[index] - halfSize)
				}
			}
		})

		ctx.restore()
	}

	private renderVectorStars(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		const transform = state.transform
		const width = state.width
		const height = state.height
		const radiusScale = Math.min(Math.sqrt(transform.k), VECTOR_STAR_MAX_RADIUS_SCALE)
		const margin = state.theme.stars.maxRadius * VECTOR_STAR_MAX_RADIUS_SCALE + 2

		catalog.forEachBucket((bucket, indices, start, end) => {
			const style = this.styles[bucket]
			const radius = Math.max(0.75, style.radius * radiusScale)
			ctx.fillStyle = style.color
			ctx.beginPath()

			for (let i = start; i < end; i++) {
				const index = indices[i]

				applyViewTransform(catalog.screenX[index], catalog.screenY[index], width, height, transform, this.point)

				if (this.point[0] < -margin || this.point[0] > width + margin || this.point[1] < -margin || this.point[1] > height + margin) {
					continue
				}

				ctx.moveTo(this.point[0] + radius, this.point[1])
				ctx.arc(this.point[0], this.point[1], radius, 0, TAU)
			}

			ctx.fill()
		})
	}

	private renderStarLabels(ctx: CanvasRenderingContext2D, state: RenderState, catalog: StarCatalog) {
		if (!state.stars.labels || !catalog.names || !catalog.namedIndices || catalog.namedIndices.length === 0) return

		const maxMagnitude = starLabelMagnitudeLimit(state)
		let labelCount = 0
		let worstLabelSlot = -1
		let worstMagnitude = Number.NEGATIVE_INFINITY

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

			if (labelCount < STAR_LABEL_MAX_COUNT) {
				this.labelIndices[labelCount] = index
				this.labelMagnitudes[labelCount] = magnitude
				this.labelX[labelCount] = this.point[0]
				this.labelY[labelCount] = this.point[1]

				if (magnitude > worstMagnitude) {
					worstMagnitude = magnitude
					worstLabelSlot = labelCount
				}

				labelCount++
			} else if (magnitude < worstMagnitude) {
				this.labelIndices[worstLabelSlot] = index
				this.labelMagnitudes[worstLabelSlot] = magnitude
				this.labelX[worstLabelSlot] = this.point[0]
				this.labelY[worstLabelSlot] = this.point[1]
				worstMagnitude = magnitude

				for (let j = 0; j < labelCount; j++) {
					if (this.labelMagnitudes[j] > worstMagnitude) {
						worstMagnitude = this.labelMagnitudes[j]
						worstLabelSlot = j
					}
				}
			}
		}

		if (labelCount === 0) return

		this.sortLabelsByMagnitude(labelCount)
		ctx.fillStyle = state.theme.stars.labelColor
		ctx.font = state.theme.stars.labelFont
		ctx.textAlign = 'left'
		ctx.textBaseline = 'middle'

		let drawn = 0

		for (let i = 0; i < labelCount; i++) {
			const name = catalog.names[this.labelIndices[i]]

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
		}
	}

	private positionStarLabel(ctx: CanvasRenderingContext2D, state: RenderState, name: string, starX: number, starY: number, out: Float32Array) {
		const width = ctx.measureText(name).width
		const horizontalInset = 2
		const verticalInset = 6
		let minX = horizontalInset
		let maxX = state.width - width - horizontalInset
		let y = clamp(starY + STAR_LABEL_OFFSET_Y, verticalInset, state.height - verticalInset)

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

		const rightX = starX + STAR_LABEL_OFFSET_X
		const leftX = starX - STAR_LABEL_OFFSET_X - width
		let x: number

		if (rightX >= minX && rightX <= maxX) {
			x = rightX
		} else if (leftX >= minX && leftX <= maxX) {
			x = leftX
		} else {
			const preferredX = starX > projectionCenterX(state) ? leftX : rightX
			x = clamp(preferredX, minX, maxX)
		}

		out[0] = x
		out[1] = y
		return true
	}

	private sortLabelsByMagnitude(count: number) {
		for (let i = 1; i < count; i++) {
			const index = this.labelIndices[i]
			const magnitude = this.labelMagnitudes[i]
			const x = this.labelX[i]
			const y = this.labelY[i]
			let j = i - 1

			while (j >= 0 && this.labelMagnitudes[j] > magnitude) {
				this.labelIndices[j + 1] = this.labelIndices[j]
				this.labelMagnitudes[j + 1] = this.labelMagnitudes[j]
				this.labelX[j + 1] = this.labelX[j]
				this.labelY[j + 1] = this.labelY[j]
				j--
			}

			this.labelIndices[j + 1] = index
			this.labelMagnitudes[j + 1] = magnitude
			this.labelX[j + 1] = x
			this.labelY[j + 1] = y
		}
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
		const signature = `${state.theme.stars.baseColor}|${state.theme.stars.minRadius}|${state.theme.stars.maxRadius}`

		if (signature === this.styleSignature) return

		this.styles = buildStarStyles(state.theme, DEFAULT_STAR_OPTIONS)
		this.styleSignature = signature
	}
}

// Planet renderer using the configured provider.
class PlanetLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	constructor() {
		super('planets', 60)
	}

	// Draws simple planet dots and labels.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.fillStyle = state.theme.planets.color
		ctx.strokeStyle = state.theme.planets.color
		ctx.font = state.theme.constellations.labelFont

		for (let i = 0; i < state.planets.length; i++) {
			const planet = state.planets[i]

			if (!state.projectEquatorialToScreen(planet.position.rightAscension, planet.position.declination, this.point)) {
				continue
			}

			ctx.beginPath()
			ctx.arc(this.point[0], this.point[1], 4.5, 0, TAU)
			ctx.fill()
			ctx.fillStyle = state.theme.planets.labelColor
			ctx.fillText(planet.body, this.point[0] + 7, this.point[1] - 7)
			ctx.fillStyle = state.theme.planets.color
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

		const labels = state.constellations.labels ?? []
		ctx.fillStyle = state.theme.constellations.labelColor
		ctx.font = state.theme.constellations.labelFont
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'

		for (let i = 0; i < labels.length; i++) {
			const label = labels[i]
			if (state.projectEquatorialToScreen(label.rightAscension, label.declination, this.point)) {
				ctx.fillText(label.name, this.point[0], this.point[1])
			}
		}
	}
}

// Custom equatorial shape renderer.
class ShapeLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

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
			shape.render(state.celestial, ctx, { id: shape.id, x: this.point[0], y: this.point[1], coordinate: shape.coordinate, shape, state })
			ctx.restore()
		}
	}
}

// Interaction overlay draws hover and selection rings.
class InteractionOverlayLayer extends InternalLayer {
	constructor() {
		super('overlay', 80)
	}

	// Draws selected and hovered object highlights.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		drawObjectHighlight(ctx, state, state.selectedObject, state.theme.selectedObject.color, 8)
		drawObjectHighlight(ctx, state, state.hoverObject, state.theme.hoverHighlight.color, 6)
	}
}

// Bright stars can be labeled at base zoom; fainter names appear progressively while zooming in.
function starLabelMagnitudeLimit(state: RenderState) {
	const zoomGain = Math.max(0, Math.log2(state.transform.k)) * STAR_LABEL_MAGNITUDE_PER_ZOOM
	return Math.min(state.stars.maxMagnitude, STAR_LABEL_BASE_MAGNITUDE + zoomGain)
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
		case 'galaxy':
			ctx.beginPath()
			ctx.ellipse(x, y, radius * 1.4, radius * 0.7, 0, 0, TAU)
			ctx.stroke()
			break
		case 'openCluster':
		case 'globularCluster':
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
			ctx.strokeRect(x - radius, y - radius, radius * 2, radius * 2)
			break
	}
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
	switch (object.type) {
		case 'star': {
			const catalog = state.starCatalog
			if (!catalog || !catalog.visible[object.index]) return false
			applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, out)
			return true
		}
		case 'deepSky':
			return state.projectEquatorialToScreen(object.object.rightAscension, object.object.declination, out)
		case 'planet':
			return state.projectEquatorialToScreen(object.position.rightAscension, object.position.declination, out)
		case 'constellationLabel':
			return state.projectEquatorialToScreen(object.label.rightAscension, object.label.declination, out)
		case 'shape':
			return object.shape.visible !== false && object.shape.selectable !== false && state.projectEquatorialToScreen(object.shape.coordinate.rightAscension, object.shape.coordinate.declination, out)
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
	private deepSkyObjects: DeepSkyObject[] = []
	private readonly planets: PlanetRenderObject[] = []
	private readonly shapes = new Map<string, CelestialShape>()
	private readonly pickedShapes: CelestialShape[] = []
	private transform: ViewTransform = { x: 0, y: 0, k: 1 }
	private hoverObject: CelestialObject | null = null
	private selectedObject: CelestialObject | null = null
	private autoUpdateTimer: ReturnType<typeof setInterval> | null = null
	private autoUpdateOptions: Required<AutoUpdateOptions> | null = null
	private frameId = 0
	private updateQueued = false
	private destroyed = false
	private pointerDown = false
	private pointerMoved = false
	private d3ZoomBound = false
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
		this.options.width = Math.max(1, Math.floor(width))
		this.options.height = Math.max(1, Math.floor(height))
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
		this.deepSkyObjects.length = 0
		this.constellations = {}
		this.planets.length = 0
		this.shapes.clear()
	}

	// Loads stars from object arrays or typed arrays.
	loadStars(stars: Star[] | StarCatalogInput) {
		try {
			this.starCatalog = new StarCatalog(stars)
			this.starCatalog.cacheStyleBuckets(this.options.stars, this.options.theme)
			this.queueUpdate()
		} catch (error) {
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
		this.renderer.markDirty('constellationLabels')
		this.rebuildPickingIndex()
		this.requestRender()
	}

	// Loads deep-sky objects.
	loadDeepSkyObjects(objects: DeepSkyObject[]) {
		this.deepSkyObjects = objects.slice()
		this.renderer.markDirty('deepSky')
		this.rebuildPickingIndex()
		this.requestRender()
	}

	// Adds or replaces a custom equatorial shape and returns its id.
	addShape(shape: CelestialShape) {
		const id = shape.id
		this.shapes.set(id, shape)
		this.markShapeChanged(id)
		return id
	}

	// Removes one custom shape.
	removeShape(id: string) {
		const removed = this.shapes.delete(id)

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
		this.requestRender()
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
		this.layers.push(new BackgroundLayer(), new HorizonLayer(), new GridLayer(), new ReferenceLineLayer(), new ConstellationLineLayer(), new DeepSkyObjectLayer(), new StarLayer(), new PlanetLayer(), new ConstellationLabelLayer(), new ShapeLayer(), new InteractionOverlayLayer())

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

		const start = performance.now()
		this.emitter.has('updateStart') && this.emitter.emit('updateStart', { time: this.options.time })
		writeEquatorialToHorizontalMatrix(this.options.time, this.options.observer, this.eqToHorizontal)
		this.updatePlanets()

		if (this.starCatalog) {
			this.starCatalog.updateEquatorialVectors(julianEpochYear(this.options.time))
			this.starCatalog.cacheStyleBuckets(this.options.stars, this.options.theme)
		}

		this.projectStars()
		this.rebuildPickingIndex()
		const duration = performance.now() - start
		this.emitter.has('updateEnd') && this.emitter.emit('updateEnd', { time: this.options.time, duration })
		this.renderer.markAllDirty()
		this.requestRender()
	}

	// Refreshes mock/provider planet positions.
	private updatePlanets() {
		this.planets.length = 0

		if (!this.options.layers.planets || !this.options.ephemerisProvider) return

		for (let i = 0; i < this.options.solarSystemBodies.length; i++) {
			const body = this.options.solarSystemBodies[i]

			try {
				this.planets.push({ body, position: this.options.ephemerisProvider.positionAt(body, this.options.time) })
			} catch (error) {
				this.emitError(normalizeError(error))
			}
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
			if (catalog.mag[i] > maxMagnitude || catalog.visibleCount >= maxRenderStars) {
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
		const radius = this.options.interactions.pickRadius
		this.picking.reset(this.options.width, this.options.height, Math.max(16, radius * 3))
		this.pickedShapes.length = 0
		const catalog = this.starCatalog

		if (catalog) {
			const indices = catalog.getBucketedVisibleIndices()

			for (let i = 0; i < catalog.visibleCount; i++) {
				const index = indices[i]
				applyViewTransform(catalog.screenX[index], catalog.screenY[index], this.options.width, this.options.height, this.transform, this.tempScreen)
				this.picking.add(PICK_TYPE_STAR, index, this.tempScreen[0], this.tempScreen[1], catalog.mag[index])
			}
		}

		for (let i = 0; i < this.deepSkyObjects.length; i++) {
			const object = this.deepSkyObjects[i]

			if (this.projectEquatorialToScreen(object.rightAscension, object.declination, this.tempScreen)) {
				this.picking.add(PICK_TYPE_DSO, i, this.tempScreen[0], this.tempScreen[1], object.mag ?? 10)
			}
		}

		for (let i = 0; i < this.planets.length; i++) {
			const planet = this.planets[i]

			if (this.projectEquatorialToScreen(planet.position.rightAscension, planet.position.declination, this.tempScreen)) {
				this.picking.add(PICK_TYPE_PLANET, i, this.tempScreen[0], this.tempScreen[1], -5)
			}
		}

		const labels = this.constellations.labels ?? []

		if (this.transform.k >= 0.75) {
			for (let i = 0; i < labels.length; i++) {
				const label = labels[i]

				if (this.projectEquatorialToScreen(label.rightAscension, label.declination, this.tempScreen)) {
					this.picking.add(PICK_TYPE_CONSTELLATION_LABEL, i, this.tempScreen[0], this.tempScreen[1], 3)
				}
			}
		}

		for (const shape of this.shapes.values()) {
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
		const start = performance.now()
		this.emitter.has('renderStart') && this.emitter.emit('renderStart', { time: this.options.time })
		this.renderer.render(this.createRenderState())
		const duration = performance.now() - start
		const fps = duration > 0 ? 1000 / duration : 0
		this.emitter.has('renderEnd') && this.emitter.emit('renderEnd', { time: this.options.time, duration, fps })
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
			deepSkyObjects: this.deepSkyObjects,
			planets: this.planets,
			shapes: [...this.shapes.values()],
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
				return this.deepSkyObjects[index.index] ? { type: 'deepSky', index: index.index, object: this.deepSkyObjects[index.index] } : null
			case PICK_TYPE_PLANET:
				return this.planets[index.index] ? { type: 'planet', index: index.index, body: this.planets[index.index].body, position: this.planets[index.index].position } : null
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
			.on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
				const k = event.transform.k
				this.transform = { x: event.transform.x - (this.options.width / 2) * (1 - k), y: event.transform.y - (this.options.height / 2) * (1 - k), k }
				this.afterTransformChanged()
			})

		const element = this.renderer.element
		element.addEventListener('pointermove', this.handlePointerMove)
		element.addEventListener('click', this.handleClick)
		select(element).call(behavior)
		this.d3ZoomBound = true
	}

	// Unbinds D3 zoom listeners.
	private unbindD3Zoom() {
		if (!this.d3ZoomBound) return

		select(this.renderer.element).on('.zoom', null)
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

		const object = this.resolvePick(this.picking.findNearest(x, y, this.options.interactions.pickRadius))

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
		const nextK = clamp(previousK * Math.exp(-event.deltaY * 0.001), this.options.interactions.minZoom, this.options.interactions.maxZoom)

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

	// Updates rendering and picking after pan/zoom transform changes.
	private afterTransformChanged() {
		this.rebuildPickingIndex()
		this.renderer.markAllDirty()
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

// Compares nullable object identity by semantic type/index.
function sameObject(a: CelestialObject | null, b: CelestialObject | null) {
	if (a === b) {
		return true
	}

	if (!a || !b || a.type !== b.type) {
		return false
	}

	if (a.type === 'shape' && b.type === 'shape') {
		return a.id === b.id
	}

	return 'index' in a && 'index' in b && a.index === b.index
}

// Normalizes thrown values to Error instances.
function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}
