import { select } from 'd3-selection'
import { type D3ZoomEvent, zoom } from 'd3-zoom'

// Public coordinate/projection options.
export type ProjectionType = 'azimuthalEquidistant' | 'azimuthalEqualArea' | 'orthographic' | 'stereographic' | 'gnomonic'

// Public coordinate-system options.
export type CoordinateSystem = 'horizontal' | 'equatorial'

// Supported event names emitted by Celestial.
export type CelestialEventName = 'objectClick' | 'objectHover' | 'objectLeave' | 'selectionChange' | 'renderStart' | 'renderEnd' | 'updateStart' | 'updateEnd' | 'resize' | 'error'

// Observer location in geodetic degrees/meters.
export interface ObserverLocation {
	latitude: number
	longitude: number
	elevation?: number
}

// Equatorial coordinates use radians.
export interface EquatorialCoord {
	ra: number
	dec: number
}

// Horizontal coordinates use radians.
export interface HorizontalCoord {
	az: number
	alt: number
}

// Star object input for convenient object-array loading.
export interface Star extends EquatorialCoord {
	id?: string
	name?: string
	mag?: number
	bv?: number
	pmRa?: number
	pmDec?: number
	epoch?: number
	flags?: number
}

// Typed-array catalog input for large catalogs.
export interface StarCatalogInput {
	ra: ArrayLike<number>
	dec: ArrayLike<number>
	mag?: ArrayLike<number>
	bv?: ArrayLike<number>
	pmRa?: ArrayLike<number>
	pmDec?: ArrayLike<number>
	flags?: ArrayLike<number>
	names?: string[]
	ids?: string[]
	epoch?: number
	count?: number
}

// Constellation line segment.
export interface ConstellationLine {
	from: EquatorialCoord
	to: EquatorialCoord
	constellation?: string
}

// Constellation label entry.
export interface ConstellationLabel extends EquatorialCoord {
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
export interface DeepSkyObject extends EquatorialCoord {
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
	getPosition(body: SolarSystemBody, time: Date): EquatorialCoord
}

// Theme configuration used by Canvas renderers.
export interface ThemeOptions {
	background: string
	stars: {
		baseColor: string
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
	debug: {
		color: string
		background: string
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
	observer?: ObserverLocation
	time?: Date
	updateInterval?: number
	stars?: StarLayerOptions
	layers?: Partial<Record<string, boolean>>
	theme?: PartialThemeOptions
	interactions?: InteractionOptions
	ephemerisProvider?: EphemerisProvider
	solarSystemBodies?: SolarSystemBody[]
	debug?: boolean
}

// Public render state passed to custom layers.
export interface RenderState {
	width: number
	height: number
	dpr: number
	time: Date
	observer: ObserverLocation
	projection: ProjectionType
	coordinateSystem: CoordinateSystem
	transform: ViewTransform
	theme: ThemeOptions
	starCatalog: StarCatalog | null
	constellations: ConstellationData
	deepSkyObjects: DeepSkyObject[]
	planets: PlanetRenderObject[]
	hoverObject: CelestialObject | null
	selectedObject: CelestialObject | null
	debug: DebugMetrics
	projectEquatorialToScreen: (ra: number, dec: number, out: Float32Array) => boolean
}

// Public update state passed to custom layers.
export interface UpdateState {
	time: Date
	observer: ObserverLocation
	projection: ProjectionType
	coordinateSystem: CoordinateSystem
	starCatalog: StarCatalog | null
}

// Public layer contract for extension.
export interface Layer {
	id: string
	visible: boolean
	zIndex: number
	render(ctx: CanvasRenderingContext2D, state: RenderState): void
	update?(state: UpdateState): void
	destroy?(): void
}

// Public object shape used by picking/events.
export type CelestialObject =
	| { type: 'star'; index: number; id?: string; name?: string; mag?: number; ra: number; dec: number }
	| { type: 'deepSky'; index: number; object: DeepSkyObject }
	| { type: 'planet'; index: number; body: SolarSystemBody; position: EquatorialCoord }
	| { type: 'constellationLabel'; index: number; label: ConstellationLabel }

// Event callback payload is event-specific but remains ergonomic for consumers.
export type CelestialEventCallback = (payload: unknown, eventName: CelestialEventName) => void

// View transform matches d3-zoom's x/y/k shape.
export interface ViewTransform {
	x: number
	y: number
	k: number
}

// Debug metrics are updated during render/update.
export interface DebugMetrics {
	visibleStars: number
	projectedStars: number
	renderMs: number
	updateMs: number
	fps: number
	pickingObjects: number
}

type PartialThemeOptions = {
	[K in keyof ThemeOptions]?: ThemeOptions[K] extends Record<string, unknown> ? Partial<ThemeOptions[K]> : ThemeOptions[K]
}

type CanvasImage = HTMLCanvasElement | OffscreenCanvas

type LayerRecord = {
	layer: InternalLayer
	canvas: HTMLCanvasElement
	ctx: CanvasRenderingContext2D
}

type ProjectionResult = {
	x: number
	y: number
}

type PlanetRenderObject = {
	body: SolarSystemBody
	position: EquatorialCoord
}

type ResolvedCelestialOptions = {
	width: number
	height: number
	projection: ProjectionType
	coordinateSystem: CoordinateSystem
	observer: ObserverLocation
	time: Date
	updateInterval: number
	stars: Required<StarLayerOptions>
	layers: Record<string, boolean>
	theme: ThemeOptions
	interactions: Required<InteractionOptions>
	ephemerisProvider: EphemerisProvider
	solarSystemBodies: SolarSystemBody[]
	debug: boolean
}

const TAU = Math.PI * 2
const HALF_PI = Math.PI / 2
const DEG_TO_RAD = Math.PI / 180
const RAD_TO_DEG = 180 / Math.PI
const J2000_EPOCH = 2000
const JULIAN_UNIX_EPOCH = 2440587.5
const DAY_MS = 86400000
const YEAR_MS = 365.25 * DAY_MS
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 800
const DEFAULT_UPDATE_INTERVAL = 10000
const STAR_RADIUS_BUCKETS = 6
const STAR_COLOR_BUCKETS = 16
const STAR_STYLE_BUCKETS = STAR_RADIUS_BUCKETS * STAR_COLOR_BUCKETS
const PICK_TYPE_STAR = 1
const PICK_TYPE_DSO = 2
const PICK_TYPE_PLANET = 3
const PICK_TYPE_CONSTELLATION_LABEL = 4

const DEFAULT_THEME: ThemeOptions = {
	background: '#02040a',
	stars: {
		baseColor: '#f8fbff',
		magnitudeScale: [-1.5, 9],
		minRadius: 0.6,
		maxRadius: 2.8,
	},
	grid: {
		color: '#47607f',
		opacity: 0.35,
	},
	horizon: {
		color: '#6fa68a',
		fillBelowHorizon: 'rgba(23, 34, 25, 0.35)',
	},
	constellations: {
		color: '#6f86b8',
		opacity: 0.55,
		labelColor: '#9fb3d8',
		labelFont: '12px system-ui, sans-serif',
	},
	deepSky: {
		color: '#77d4e8',
		labelColor: '#9be7f6',
	},
	planets: {
		color: '#f0c66a',
		labelColor: '#ffe0a0',
	},
	selectedObject: {
		color: '#ffdf6e',
	},
	hoverHighlight: {
		color: '#8ae6ff',
	},
	debug: {
		color: '#d8ecff',
		background: 'rgba(0, 0, 0, 0.55)',
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
	grid: true,
	horizon: true,
	deepSky: true,
	planets: false,
	overlay: true,
	debug: false,
}

const DEFAULT_STAR_OPTIONS: Required<StarLayerOptions> = {
	maxMagnitude: 9,
	colorByBV: true,
	sizeByMagnitude: true,
	maxRenderStars: Number.POSITIVE_INFINITY,
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

// Converts degrees to radians.
function toRad(value: number): number {
	return value * DEG_TO_RAD
}

// Converts radians to degrees.
function toDeg(value: number): number {
	return value * RAD_TO_DEG
}

// Wraps radians into [0, 2pi).
function wrapTau(value: number): number {
	value %= TAU
	return value < 0 ? value + TAU : value
}

// Clamps a value into a closed interval.
function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), max)
}

// Returns true for finite numbers only.
function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

// Converts a Date into a Julian date.
function julianDate(date: Date): number {
	return date.getTime() / DAY_MS + JULIAN_UNIX_EPOCH
}

// Converts a Date into a Julian epoch year.
function julianEpochYear(date: Date): number {
	return J2000_EPOCH + (date.getTime() - Date.UTC(2000, 0, 1, 12)) / YEAR_MS
}

// Computes Greenwich mean sidereal time in radians.
function greenwichMeanSiderealTime(date: Date): number {
	const jd = julianDate(date)
	const t = (jd - 2451545) / 36525
	const degrees = 280.46061837 + 360.98564736629 * (jd - 2451545) + 0.000387933 * t * t - (t * t * t) / 38710000
	return wrapTau(toRad(degrees))
}

// Computes local sidereal time in radians.
function localSiderealTime(date: Date, longitudeDegrees: number): number {
	return wrapTau(greenwichMeanSiderealTime(date) + toRad(longitudeDegrees))
}

// Writes an RA/Dec unit vector.
function writeRaDecUnitVector(ra: number, dec: number, out: Float32Array, offset = 0) {
	const cosDec = Math.cos(dec)
	out[offset] = cosDec * Math.cos(ra)
	out[offset + 1] = cosDec * Math.sin(ra)
	out[offset + 2] = Math.sin(dec)
}

// Writes a horizontal unit vector from azimuth/altitude.
function writeHorizontalUnitVector(az: number, alt: number, out: Float32Array, offset = 0) {
	const cosAlt = Math.cos(alt)
	out[offset] = cosAlt * Math.sin(az)
	out[offset + 1] = cosAlt * Math.cos(az)
	out[offset + 2] = Math.sin(alt)
}

// Computes a global equatorial-to-horizontal matrix.
function writeEquatorialToHorizontalMatrix(time: Date, observer: ObserverLocation, out: Float64Array) {
	const lst = localSiderealTime(time, observer.longitude)
	const lat = toRad(observer.latitude)
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
function multiplyMatrixVector(matrix: Float64Array, x: number, y: number, z: number, out: Float32Array, offset = 0) {
	out[offset] = matrix[0] * x + matrix[1] * y + matrix[2] * z
	out[offset + 1] = matrix[3] * x + matrix[4] * y + matrix[5] * z
	out[offset + 2] = matrix[6] * x + matrix[7] * y + matrix[8] * z
}

// Computes a direct Alt/Az conversion for small layers and picking helpers.
function equatorialToHorizontal(ra: number, dec: number, time: Date, observer: ObserverLocation): HorizontalCoord {
	const lst = localSiderealTime(time, observer.longitude)
	const lat = toRad(observer.latitude)
	const hourAngle = wrapTau(lst - ra)
	const sinDec = Math.sin(dec)
	const cosDec = Math.cos(dec)
	const sinLat = Math.sin(lat)
	const cosLat = Math.cos(lat)
	const sinAlt = sinDec * sinLat + cosDec * cosLat * Math.cos(hourAngle)
	const alt = Math.asin(clamp(sinAlt, -1, 1))
	const az = Math.atan2(-cosDec * Math.sin(hourAngle), sinDec * cosLat - cosDec * sinLat * Math.cos(hourAngle))
	return { az: wrapTau(az), alt }
}

// Normalizes a 3D vector in place.
function normalizeVector(out: Float32Array, offset = 0): boolean {
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
function writeCross(ax: number, ay: number, az: number, bx: number, by: number, bz: number, out: Float32Array, offset = 0) {
	out[offset] = ay * bz - az * by
	out[offset + 1] = az * bx - ax * bz
	out[offset + 2] = ax * by - ay * bx
}

// Computes angular distance between two unit vectors.
function angularDistance(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
	return Math.acos(clamp(ax * bx + ay * by + az * bz, -1, 1))
}

// Writes a view matrix from a center vector and a stable reference up vector.
function writeViewMatrix(center: Float32Array, referenceUp: Float32Array, out: Float32Array) {
	const work = new Float32Array(6)
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
function projectViewVector(type: ProjectionType, x: number, y: number, z: number, out: ProjectionResult) {
	switch (type) {
		case 'azimuthalEquidistant': {
			const theta = Math.acos(clamp(z, -1, 1))
			if (theta <= 1e-9) {
				out.x = 0
				out.y = 0
				return true
			}
			const sinTheta = Math.sin(theta)
			if (Math.abs(sinTheta) <= 1e-9) {
				return false
			}
			const k = theta / (Math.PI * sinTheta)
			out.x = x * k
			out.y = y * k
			return true
		}
		case 'azimuthalEqualArea': {
			if (z <= -0.999999) {
				return false
			}
			const k = Math.sqrt(2 / (1 + z)) / 2
			out.x = x * k
			out.y = y * k
			return true
		}
		case 'orthographic': {
			if (z < 0) {
				return false
			}
			out.x = x
			out.y = y
			return true
		}
		case 'stereographic': {
			const d = 1 + z
			if (d <= 0.025) {
				return false
			}
			const k = 0.5 / d
			out.x = x * k
			out.y = y * k
			return true
		}
		case 'gnomonic': {
			if (z <= 0.02) {
				return false
			}
			out.x = x / z
			out.y = y / z
			return Math.abs(out.x) < 8 && Math.abs(out.y) < 8
		}
	}
}

// Applies the current screen transform to a base screen coordinate.
function applyViewTransform(x: number, y: number, width: number, height: number, transform: ViewTransform, out: Float32Array) {
	out[0] = width / 2 + transform.x + (x - width / 2) * transform.k
	out[1] = height / 2 + transform.y + (y - height / 2) * transform.k
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
		debug: { ...DEFAULT_THEME.debug, ...theme?.debug },
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
	if (options.debug === true) {
		layers.debug = true
	}

	return {
		width: Math.max(1, Math.floor(options.width ?? DEFAULT_WIDTH)),
		height: Math.max(1, Math.floor(options.height ?? DEFAULT_HEIGHT)),
		projection: validateProjection(options.projection ?? 'azimuthalEquidistant'),
		coordinateSystem: options.coordinateSystem ?? 'horizontal',
		observer: validateObserver(options.observer ?? DEFAULT_OBSERVER),
		time: options.time instanceof Date ? new Date(options.time.getTime()) : new Date(),
		updateInterval: Math.max(1, Math.floor(options.updateInterval ?? DEFAULT_UPDATE_INTERVAL)),
		stars: { ...DEFAULT_STAR_OPTIONS, ...options.stars },
		layers,
		theme: mergeTheme(options.theme),
		interactions: { ...DEFAULT_INTERACTION_OPTIONS, ...options.interactions },
		ephemerisProvider: options.ephemerisProvider ?? new MockEphemerisProvider(),
		solarSystemBodies: options.solarSystemBodies ?? DEFAULT_SOLAR_SYSTEM_BODIES,
		debug: options.debug ?? false,
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
function bvToColor(bv: number): string {
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
	color: string
	radius: number
	sprite: CanvasImage
	halfSize: number
}

// High-performance star catalog storage.
export class StarCatalog {
	ra: Float32Array
	dec: Float32Array
	mag: Float32Array
	bv?: Float32Array
	eqX: Float32Array
	eqY: Float32Array
	eqZ: Float32Array
	screenX: Float32Array
	screenY: Float32Array
	visible: Uint8Array
	flags?: Uint8Array
	names?: string[]
	ids?: string[]
	count: number

	private readonly pmRa?: Float32Array
	private readonly pmDec?: Float32Array
	private readonly epochs?: Float32Array
	private readonly styleBucket: Uint16Array
	private readonly visibleIndices: Int32Array
	private readonly bucketedVisibleIndices: Int32Array
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
		this.pmRa = data.pmRa
		this.pmDec = data.pmDec
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

	// Applies proper motion and refreshes equatorial unit vectors when needed.
	updateEquatorialVectors(epochYear: number, force = false) {
		if (!force && Math.abs(this.preparedEpoch - epochYear) < 1e-4) {
			return
		}

		const vector = new Float32Array(3)
		for (let i = 0; i < this.count; i++) {
			const epoch = this.epochs?.[i] ?? J2000_EPOCH
			const dt = epochYear - epoch
			const ra = wrapTau(this.ra[i] + (this.pmRa?.[i] ?? 0) * dt)
			const dec = clamp(this.dec[i] + (this.pmDec?.[i] ?? 0) * dt, -HALF_PI, HALF_PI)
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
	forEachBucket(callback: (bucket: number, indices: Int32Array, start: number, end: number) => void) {
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
function normalizeStarInput(input: Star[] | StarCatalogInput): {
	count: number
	ra: Float32Array
	dec: Float32Array
	mag: Float32Array
	bv?: Float32Array
	pmRa?: Float32Array
	pmDec?: Float32Array
	flags?: Uint8Array
	epochs?: Float32Array
	names?: string[]
	ids?: string[]
} {
	if (Array.isArray(input)) {
		const count = input.length
		const ra = new Float32Array(count)
		const dec = new Float32Array(count)
		const mag = new Float32Array(count)
		const bv = new Float32Array(count)
		const pmRa = new Float32Array(count)
		const pmDec = new Float32Array(count)
		const flags = new Uint8Array(count)
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
			ra[i] = wrapTau(isFiniteNumber(star.ra) ? star.ra : 0)
			dec[i] = clamp(isFiniteNumber(star.dec) ? star.dec : 0, -HALF_PI, HALF_PI)
			mag[i] = isFiniteNumber(star.mag) ? star.mag : 99
			if (isFiniteNumber(star.bv)) {
				bv[i] = star.bv
				hasBv = true
			}
			if (isFiniteNumber(star.pmRa) || isFiniteNumber(star.pmDec)) {
				pmRa[i] = star.pmRa ?? 0
				pmDec[i] = star.pmDec ?? 0
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
		}
	}

	const count = Math.min(input.count ?? input.ra.length, input.ra.length, input.dec.length)
	const ra = copyFloat32(input.ra, count, 0, wrapTau)
	const dec = copyFloat32(input.dec, count, 0, (value) => clamp(value, -HALF_PI, HALF_PI))
	const mag = input.mag ? copyFloat32(input.mag, count, 99) : fillFloat32(count, 99)
	const bv = input.bv ? copyFloat32(input.bv, count, 0.65) : undefined
	const pmRa = input.pmRa ? copyFloat32(input.pmRa, count, 0) : undefined
	const pmDec = input.pmDec ? copyFloat32(input.pmDec, count, 0) : undefined
	const flags = input.flags ? copyUint8(input.flags, count) : undefined
	const epochs = fillFloat32(count, input.epoch ?? J2000_EPOCH)

	return {
		count,
		ra,
		dec,
		mag,
		bv,
		pmRa,
		pmDec,
		flags,
		epochs,
		names: input.names,
		ids: input.ids,
	}
}

// Copies finite values into a Float32Array.
function copyFloat32(source: ArrayLike<number>, count: number, fallback: number, map?: (value: number) => number): Float32Array {
	const output = new Float32Array(count)
	for (let i = 0; i < count; i++) {
		const value = source[i]
		output[i] = isFiniteNumber(value) ? (map ? map(value) : value) : fallback
	}
	return output
}

// Fills a Float32Array with one value.
function fillFloat32(count: number, value: number): Float32Array {
	const output = new Float32Array(count)
	output.fill(value)
	return output
}

// Copies flags into a Uint8Array.
function copyUint8(source: ArrayLike<number>, count: number): Uint8Array {
	const output = new Uint8Array(count)
	for (let i = 0; i < count; i++) {
		output[i] = clamp(Math.floor(source[i] ?? 0), 0, 255)
	}
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
		if (x < 0 || y < 0) {
			return
		}

		const cellX = Math.floor(x / this.cellSize)
		const cellY = Math.floor(y / this.cellSize)
		if (cellX < 0 || cellY < 0 || cellX >= this.columns || cellY >= this.rows) {
			return
		}

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
						const priority = this.type[entry] === PICK_TYPE_STAR ? Math.max(0, this.mag[entry] + 2) : -4
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
	get size(): number {
		return this.count
	}

	// Ensures typed arrays can hold the requested capacity.
	private ensureCapacity(capacity: number) {
		if (this.x.length >= capacity) {
			return
		}

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
	type: number
	index: number
}

// Grows a Float32Array.
function growFloat32(source: Float32Array, capacity: number): Float32Array<ArrayBuffer> {
	const output = new Float32Array(capacity)
	output.set(source)
	return output
}

// Grows an Int32Array.
function growInt32(source: Int32Array, capacity: number): Int32Array<ArrayBuffer> {
	const output = new Int32Array(capacity)
	output.set(source)
	return output
}

// Grows a Uint8Array.
function growUint8(source: Uint8Array, capacity: number): Uint8Array<ArrayBuffer> {
	const output = new Uint8Array(capacity)
	output.set(source)
	return output
}

// Basic event emitter with unsubscribe support.
class EventEmitter {
	private readonly callbacks = new Map<CelestialEventName, Set<CelestialEventCallback>>()

	// Registers an event callback.
	on(eventName: CelestialEventName, callback: CelestialEventCallback): () => void {
		let callbacks = this.callbacks.get(eventName)
		if (!callbacks) {
			callbacks = new Set()
			this.callbacks.set(eventName, callbacks)
		}
		callbacks.add(callback)
		return () => this.off(eventName, callback)
	}

	// Removes an event callback.
	off(eventName: CelestialEventName, callback: CelestialEventCallback) {
		this.callbacks.get(eventName)?.delete(callback)
	}

	// Emits an event payload.
	emit(eventName: CelestialEventName, payload: unknown) {
		const callbacks = this.callbacks.get(eventName)
		if (!callbacks) {
			return
		}

		for (const callback of callbacks) {
			callback(payload, eventName)
		}
	}

	// Clears all callbacks.
	clear() {
		this.callbacks.clear()
	}
}

// Simple mock ephemeris provider for initial architecture.
class MockEphemerisProvider implements EphemerisProvider {
	// Returns deterministic approximate positions for display placeholders.
	getPosition(body: SolarSystemBody, time: Date): EquatorialCoord {
		const days = (time.getTime() - Date.UTC(2000, 0, 1, 12)) / DAY_MS
		const seed = bodySeed(body)
		const period = 27 + seed * 53
		return {
			ra: wrapTau((days / period + seed * 0.137) * TAU),
			dec: Math.sin(days / (period * 1.7) + seed) * toRad(23.4),
		}
	}
}

// Generates a stable numeric seed for a body id.
function bodySeed(body: SolarSystemBody): number {
	let seed = 0
	for (let i = 0; i < body.length; i++) {
		seed = (seed * 31 + body.charCodeAt(i)) % 997
	}
	return seed / 997
}

// Internal layer adds dirty-flag behavior to the public interface.
abstract class InternalLayer implements Layer {
	visible = true
	dirty = true
	destroy?(): void

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

// Horizon layer draws the local horizon ring when applicable.
class HorizonLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	constructor() {
		super('horizon', 10)
	}

	// Draws horizon fill and stroke.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		if (state.coordinateSystem !== 'horizontal') {
			return
		}

		ctx.fillStyle = state.theme.horizon.fillBelowHorizon
		ctx.strokeStyle = state.theme.horizon.color
		ctx.lineWidth = 1
		ctx.beginPath()
		let started = false
		for (let i = 0; i <= 144; i++) {
			const az = (i / 144) * TAU
			const ok = projectHorizontalPoint(az, 0, state, this.point)
			if (!ok) {
				continue
			}
			if (!started) {
				ctx.moveTo(this.point[0], this.point[1])
				started = true
			} else {
				ctx.lineTo(this.point[0], this.point[1])
			}
		}
		if (started) {
			ctx.closePath()
			ctx.stroke()
		}

		drawCardinalPoints(ctx, state)
	}
}

// Grid layer draws coarse equatorial or horizontal reference lines.
class GridLayer extends InternalLayer {
	private readonly point = new Float32Array(2)

	constructor() {
		super('grid', 20)
	}

	// Draws reference grid lines.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		ctx.strokeStyle = state.theme.grid.color
		ctx.globalAlpha = state.theme.grid.opacity
		ctx.lineWidth = 1

		if (state.coordinateSystem === 'horizontal') {
			this.renderHorizontalGrid(ctx, state)
		} else {
			this.renderEquatorialGrid(ctx, state)
		}

		ctx.globalAlpha = 1
	}

	// Draws altitude and azimuth lines.
	private renderHorizontalGrid(ctx: CanvasRenderingContext2D, state: RenderState) {
		for (let altDeg = 15; altDeg <= 75; altDeg += 15) {
			this.drawHorizontalPolyline(ctx, state, 0, TAU, toRad(altDeg), true)
		}

		for (let azDeg = 0; azDeg < 360; azDeg += 30) {
			this.drawHorizontalPolyline(ctx, state, toRad(azDeg), toRad(azDeg), 0, false)
		}
	}

	// Draws RA/Dec grid lines.
	private renderEquatorialGrid(ctx: CanvasRenderingContext2D, state: RenderState) {
		for (let decDeg = -60; decDeg <= 60; decDeg += 30) {
			ctx.beginPath()
			let started = false
			for (let i = 0; i <= 144; i++) {
				if (!state.projectEquatorialToScreen((i / 144) * TAU, toRad(decDeg), this.point)) {
					started = false
					continue
				}
				if (started) {
					ctx.lineTo(this.point[0], this.point[1])
				} else {
					ctx.moveTo(this.point[0], this.point[1])
					started = true
				}
			}
			ctx.stroke()
		}

		for (let raHour = 0; raHour < 24; raHour += 2) {
			ctx.beginPath()
			let started = false
			for (let decDeg = -85; decDeg <= 85; decDeg += 5) {
				if (!state.projectEquatorialToScreen((raHour / 24) * TAU, toRad(decDeg), this.point)) {
					started = false
					continue
				}
				if (started) {
					ctx.lineTo(this.point[0], this.point[1])
				} else {
					ctx.moveTo(this.point[0], this.point[1])
					started = true
				}
			}
			ctx.stroke()
		}
	}

	// Draws one horizontal grid polyline.
	private drawHorizontalPolyline(ctx: CanvasRenderingContext2D, state: RenderState, startAz: number, endAz: number, fixedAlt: number, constantAlt: boolean) {
		ctx.beginPath()
		let started = false
		for (let i = 0; i <= 144; i++) {
			const t = i / 144
			const az = constantAlt ? startAz + (endAz - startAz) * t : startAz
			const alt = constantAlt ? fixedAlt : t * HALF_PI
			if (!projectHorizontalPoint(az, alt, state, this.point)) {
				started = false
				continue
			}
			if (started) {
				ctx.lineTo(this.point[0], this.point[1])
			} else {
				ctx.moveTo(this.point[0], this.point[1])
				started = true
			}
		}
		ctx.stroke()
	}
}

// Constellation line renderer.
class ConstellationLineLayer extends InternalLayer {
	private readonly from = new Float32Array(2)
	private readonly to = new Float32Array(2)

	constructor() {
		super('constellations', 30)
	}

	// Draws supplied constellation line segments.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const lines = state.constellations.lines ?? []
		ctx.strokeStyle = state.theme.constellations.color
		ctx.globalAlpha = state.theme.constellations.opacity
		ctx.lineWidth = 1
		ctx.beginPath()
		for (let i = 0; i < lines.length; i++) {
			const line = lines[i]
			if (state.projectEquatorialToScreen(line.from.ra, line.from.dec, this.from) && state.projectEquatorialToScreen(line.to.ra, line.to.dec, this.to)) {
				ctx.moveTo(this.from[0], this.from[1])
				ctx.lineTo(this.to[0], this.to[1])
			}
		}
		ctx.stroke()
		ctx.globalAlpha = 1
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
		for (let i = 0; i < state.deepSkyObjects.length; i++) {
			const object = state.deepSkyObjects[i]
			if (isFiniteNumber(object.mag) && object.mag > 14) {
				continue
			}
			if (!state.projectEquatorialToScreen(object.ra, object.dec, this.point)) {
				continue
			}
			const radius = clamp((object.sizeArcMin ?? 4) / 5, 3, 12) * Math.sqrt(state.transform.k)
			drawDsoSymbol(ctx, object.type, this.point[0], this.point[1], radius)
		}
	}
}

// Star catalog renderer.
class StarLayer extends InternalLayer {
	private styles = buildStarStyles(DEFAULT_THEME, DEFAULT_STAR_OPTIONS)
	private styleSignature = ''

	constructor() {
		super('stars', 50)
	}

	// Draws visible stars grouped by style bucket.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const catalog = state.starCatalog
		if (!catalog) {
			return
		}

		this.ensureStyles(state)
		const transform = state.transform
		const width = state.width
		const height = state.height
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

	// Rebuilds sprite styles when theme or options change.
	private ensureStyles(state: RenderState) {
		const signature = `${state.theme.stars.baseColor}|${state.theme.stars.minRadius}|${state.theme.stars.maxRadius}`
		if (signature === this.styleSignature) {
			return
		}
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
			if (!state.projectEquatorialToScreen(planet.position.ra, planet.position.dec, this.point)) {
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
		if (state.transform.k < 0.75) {
			return
		}

		const labels = state.constellations.labels ?? []
		ctx.fillStyle = state.theme.constellations.labelColor
		ctx.font = state.theme.constellations.labelFont
		ctx.textAlign = 'center'
		ctx.textBaseline = 'middle'
		for (let i = 0; i < labels.length; i++) {
			const label = labels[i]
			if (state.projectEquatorialToScreen(label.ra, label.dec, this.point)) {
				ctx.fillText(label.name, this.point[0], this.point[1])
			}
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

// Debug overlay layer.
class DebugLayer extends InternalLayer {
	constructor() {
		super('debug', 90)
	}

	// Draws lightweight debug metrics.
	render(ctx: CanvasRenderingContext2D, state: RenderState) {
		const lines = [`visible stars: ${state.debug.visibleStars}`, `projected stars: ${state.debug.projectedStars}`, `pick objects: ${state.debug.pickingObjects}`, `update: ${state.debug.updateMs.toFixed(2)}ms`, `render: ${state.debug.renderMs.toFixed(2)}ms`, `fps: ${state.debug.fps.toFixed(1)}`]
		ctx.fillStyle = state.theme.debug.background
		ctx.fillRect(8, 8, 180, 18 + lines.length * 16)
		ctx.fillStyle = state.theme.debug.color
		ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace'
		for (let i = 0; i < lines.length; i++) {
			ctx.fillText(lines[i], 16, 28 + i * 16)
		}
	}
}

// Draws cardinal labels on the horizon.
function drawCardinalPoints(ctx: CanvasRenderingContext2D, state: RenderState) {
	const point = new Float32Array(2)
	const labels: [string, number][] = [
		['N', 0],
		['E', HALF_PI],
		['S', Math.PI],
		['W', Math.PI + HALF_PI],
	]
	ctx.fillStyle = state.theme.horizon.color
	ctx.font = state.theme.constellations.labelFont
	ctx.textAlign = 'center'
	ctx.textBaseline = 'middle'
	for (let i = 0; i < labels.length; i++) {
		const [label, az] = labels[i]
		if (projectHorizontalPoint(az, 0, state, point)) {
			ctx.fillText(label, point[0], point[1])
		}
	}
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

// Draws hover/selection highlight for any pickable object.
function drawObjectHighlight(ctx: CanvasRenderingContext2D, state: RenderState, object: CelestialObject | null, color: string, radius: number) {
	if (!object) {
		return
	}

	const point = new Float32Array(2)
	if (!projectObjectToScreen(object, state, point)) {
		return
	}

	ctx.strokeStyle = color
	ctx.lineWidth = 1.5
	ctx.beginPath()
	ctx.arc(point[0], point[1], radius, 0, TAU)
	ctx.stroke()
}

// Projects a picked object to current screen coordinates.
function projectObjectToScreen(object: CelestialObject, state: RenderState, out: Float32Array): boolean {
	switch (object.type) {
		case 'star': {
			const catalog = state.starCatalog
			if (!catalog || !catalog.visible[object.index]) {
				return false
			}
			applyViewTransform(catalog.screenX[object.index], catalog.screenY[object.index], state.width, state.height, state.transform, out)
			return true
		}
		case 'deepSky':
			return state.projectEquatorialToScreen(object.object.ra, object.object.dec, out)
		case 'planet':
			return state.projectEquatorialToScreen(object.position.ra, object.position.dec, out)
		case 'constellationLabel':
			return state.projectEquatorialToScreen(object.label.ra, object.label.dec, out)
	}
}

// Projects a horizontal point through the current render state.
function projectHorizontalPoint(az: number, alt: number, state: RenderState, out: Float32Array): boolean {
	const vector = new Float32Array(3)
	writeHorizontalUnitVector(az, alt, vector)
	return projectWorldVector(vector[0], vector[1], vector[2], state, out)
}

// Projects an arbitrary coordinate-system vector to screen coordinates.
function projectWorldVector(x: number, y: number, z: number, state: RenderState, out: Float32Array): boolean {
	const celestial = state as RenderState & { __projectWorldVector?: (x: number, y: number, z: number, out: Float32Array) => boolean }
	return celestial.__projectWorldVector ? celestial.__projectWorldVector(x, y, z, out) : false
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
			layer.render(ctx, state)
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
			record.layer.destroy?.()
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
	private readonly tempProjection: ProjectionResult = { x: 0, y: 0 }
	private readonly tempVector = new Float32Array(3)
	private readonly tempScreen = new Float32Array(2)
	private readonly layers: InternalLayer[] = []

	private options: ResolvedCelestialOptions
	private starCatalog: StarCatalog | null = null
	private constellations: ConstellationData = {}
	private deepSkyObjects: DeepSkyObject[] = []
	private planets: PlanetRenderObject[] = []
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
	private readonly debug: DebugMetrics = {
		visibleStars: 0,
		projectedStars: 0,
		renderMs: 0,
		updateMs: 0,
		fps: 0,
		pickingObjects: 0,
	}

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
		this.performUpdate()
	}

	// Sets the current observation time.
	setTime(date: Date) {
		if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
			this.emitError(new Error('Invalid date supplied to setTime'))
			return
		}

		this.options.time = new Date(date.getTime())
		this.queueUpdate()
	}

	// Sets the observer location.
	setObserver(observer: ObserverLocation) {
		this.options.observer = validateObserver(observer)
		this.queueUpdate()
	}

	// Changes the active map projection.
	setProjection(type: ProjectionType) {
		this.options.projection = validateProjection(type)
		this.queueProjectionOnly()
	}

	// Sets the star magnitude limit.
	setMagnitudeLimit(limit: number) {
		if (!isFiniteNumber(limit)) {
			this.emitError(new Error('Invalid magnitude limit'))
			return
		}
		this.options.stars.maxMagnitude = limit
		this.queueProjectionOnly()
	}

	// Sets the default auto-update interval in milliseconds.
	setUpdateInterval(ms: number) {
		if (!isFiniteNumber(ms) || ms <= 0) {
			this.emitError(new Error('Invalid update interval'))
			return
		}

		this.options.updateInterval = Math.floor(ms)
		if (this.autoUpdateOptions) {
			this.startAutoUpdate({ ...this.autoUpdateOptions, interval: this.options.updateInterval })
		}
	}

	// Starts realtime or accelerated simulation updates.
	startAutoUpdate(options: AutoUpdateOptions = {}) {
		this.stopAutoUpdate()
		const resolved = {
			mode: options.mode ?? 'realtime',
			interval: Math.max(1, Math.floor(options.interval ?? this.options.updateInterval)),
			timeStep: Math.floor(options.timeStep ?? options.interval ?? this.options.updateInterval),
		}
		this.autoUpdateOptions = resolved
		let simulatedTime = this.options.time.getTime()
		this.autoUpdateTimer = setInterval(() => {
			if (resolved.mode === 'simulation') {
				simulatedTime += resolved.timeStep
				this.setTime(new Date(simulatedTime))
			} else {
				this.setTime(new Date())
			}
		}, resolved.interval)
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
		this.emitter.emit('resize', { width: this.options.width, height: this.options.height })
		this.requestRender()
	}

	// Schedules a coalesced render frame.
	render() {
		this.requestRender()
	}

	// Destroys timers, listeners, canvases, and large references.
	destroy() {
		if (this.destroyed) {
			return
		}

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
		this.deepSkyObjects = []
		this.constellations = {}
		this.planets = []
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
		writeRaDecUnitVector(wrapTau(ra), clamp(dec, -HALF_PI, HALF_PI), this.centerVector)
		this.referenceUp[0] = 0
		this.referenceUp[1] = 0
		this.referenceUp[2] = 1
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Centers the view on a horizontal coordinate.
	centerOnHorizontal(az: number, alt: number) {
		writeHorizontalUnitVector(wrapTau(az), clamp(alt, -HALF_PI, HALF_PI), this.centerVector)
		this.referenceUp[0] = 0
		this.referenceUp[1] = 1
		this.referenceUp[2] = 0
		this.writeCurrentViewMatrix()
		this.queueProjectionOnly()
	}

	// Registers an event callback and returns an unsubscribe function.
	on(eventName: CelestialEventName, callback: CelestialEventCallback): () => void {
		return this.emitter.on(eventName, callback)
	}

	// Removes an event callback.
	off(eventName: CelestialEventName, callback: CelestialEventCallback): void {
		this.emitter.off(eventName, callback)
	}

	// Creates and registers built-in layers.
	private setupLayers() {
		this.layers.push(new BackgroundLayer(), new HorizonLayer(), new GridLayer(), new ConstellationLineLayer(), new DeepSkyObjectLayer(), new StarLayer(), new PlanetLayer(), new ConstellationLabelLayer(), new InteractionOverlayLayer(), new DebugLayer())

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
		if (this.updateQueued || this.destroyed) {
			return
		}

		this.updateQueued = true
		queueMicrotask(() => {
			this.updateQueued = false
			this.performUpdate()
		})
	}

	// Queues projection-only work after view/projection changes.
	private queueProjectionOnly() {
		if (this.destroyed) {
			return
		}

		this.projectStars()
		this.rebuildPickingIndex()
		this.renderer.markAllDirty()
		this.requestRender()
	}

	// Performs astronomical and projection updates.
	private performUpdate() {
		if (this.destroyed) {
			return
		}

		const start = performance.now()
		this.emitter.emit('updateStart', { time: this.options.time })
		writeEquatorialToHorizontalMatrix(this.options.time, this.options.observer, this.eqToHorizontal)
		this.updatePlanets()
		if (this.starCatalog) {
			this.starCatalog.updateEquatorialVectors(julianEpochYear(this.options.time))
			this.starCatalog.cacheStyleBuckets(this.options.stars, this.options.theme)
		}
		this.projectStars()
		this.rebuildPickingIndex()
		this.debug.updateMs = performance.now() - start
		this.emitter.emit('updateEnd', { time: this.options.time, duration: this.debug.updateMs })
		this.renderer.markAllDirty()
		this.requestRender()
	}

	// Refreshes mock/provider planet positions.
	private updatePlanets() {
		this.planets = []
		if (!this.options.layers.planets) {
			return
		}

		for (let i = 0; i < this.options.solarSystemBodies.length; i++) {
			const body = this.options.solarSystemBodies[i]
			try {
				this.planets.push({ body, position: this.options.ephemerisProvider.getPosition(body, this.options.time) })
			} catch (error) {
				this.emitError(normalizeError(error))
			}
		}
	}

	// Projects visible stars into base screen coordinates.
	private projectStars() {
		const catalog = this.starCatalog

		if (!catalog) {
			this.debug.visibleStars = 0
			this.debug.projectedStars = 0
			return
		}

		const width = this.options.width
		const height = this.options.height
		const scale = Math.min(width, height) * 0.48
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
				if (z < 0) {
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
		this.debug.visibleStars = catalog.visibleCount
		this.debug.projectedStars = projected
		this.renderer.markDirty('stars')
	}

	// Projects a world vector to base screen coordinates without pan/zoom transform.
	private projectWorldVectorToBaseScreen(x: number, y: number, z: number, scale: number, out: Float32Array): boolean {
		const vx = this.viewMatrix[0] * x + this.viewMatrix[1] * y + this.viewMatrix[2] * z
		const vy = this.viewMatrix[3] * x + this.viewMatrix[4] * y + this.viewMatrix[5] * z
		const vz = this.viewMatrix[6] * x + this.viewMatrix[7] * y + this.viewMatrix[8] * z
		if (!projectViewVector(this.options.projection, vx, vy, vz, this.tempProjection)) {
			return false
		}

		out[0] = this.options.width / 2 + this.tempProjection.x * scale
		out[1] = this.options.height / 2 - this.tempProjection.y * scale
		return true
	}

	// Projects an equatorial coordinate to transformed screen coordinates.
	private projectEquatorialToScreen = (ra: number, dec: number, out: Float32Array): boolean => {
		writeRaDecUnitVector(ra, dec, this.tempVector)
		let x = this.tempVector[0]
		let y = this.tempVector[1]
		let z = this.tempVector[2]
		if (this.options.coordinateSystem === 'horizontal') {
			multiplyMatrixVector(this.eqToHorizontal, x, y, z, this.tempVector)
			x = this.tempVector[0]
			y = this.tempVector[1]
			z = this.tempVector[2]
			if (z < 0) {
				return false
			}
		}

		if (!this.projectWorldVectorToBaseScreen(x, y, z, Math.min(this.options.width, this.options.height) * 0.48, out)) {
			return false
		}

		applyViewTransform(out[0], out[1], this.options.width, this.options.height, this.transform, out)
		return out[0] >= -128 && out[1] >= -128 && out[0] <= this.options.width + 128 && out[1] <= this.options.height + 128
	}

	// Projects a coordinate-system vector to transformed screen coordinates.
	private readonly projectWorldVectorToScreen = (x: number, y: number, z: number, out: Float32Array): boolean => {
		if (!this.projectWorldVectorToBaseScreen(x, y, z, Math.min(this.options.width, this.options.height) * 0.48, out)) {
			return false
		}
		applyViewTransform(out[0], out[1], this.options.width, this.options.height, this.transform, out)
		return true
	}

	// Rebuilds the picking index from projected visible objects.
	private rebuildPickingIndex() {
		const radius = this.options.interactions.pickRadius
		this.picking.reset(this.options.width, this.options.height, Math.max(16, radius * 3))
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
			if (this.projectEquatorialToScreen(object.ra, object.dec, this.tempScreen)) {
				this.picking.add(PICK_TYPE_DSO, i, this.tempScreen[0], this.tempScreen[1], object.mag ?? 10)
			}
		}

		for (let i = 0; i < this.planets.length; i++) {
			const planet = this.planets[i]
			if (this.projectEquatorialToScreen(planet.position.ra, planet.position.dec, this.tempScreen)) {
				this.picking.add(PICK_TYPE_PLANET, i, this.tempScreen[0], this.tempScreen[1], -5)
			}
		}

		const labels = this.constellations.labels ?? []
		if (this.transform.k >= 0.75) {
			for (let i = 0; i < labels.length; i++) {
				const label = labels[i]
				if (this.projectEquatorialToScreen(label.ra, label.dec, this.tempScreen)) {
					this.picking.add(PICK_TYPE_CONSTELLATION_LABEL, i, this.tempScreen[0], this.tempScreen[1], 3)
				}
			}
		}

		this.debug.pickingObjects = this.picking.size
	}

	// Schedules one animation-frame render.
	private requestRender() {
		if (this.frameId || this.destroyed) {
			return
		}

		this.frameId = requestAnimationFrame(() => {
			this.frameId = 0
			this.flushRender()
		})
	}

	// Flushes dirty layers.
	private flushRender() {
		const start = performance.now()
		this.emitter.emit('renderStart', { time: this.options.time })
		this.renderer.render(this.createRenderState())
		const duration = performance.now() - start
		this.debug.fps = duration > 0 ? 1000 / duration : 0
		this.debug.renderMs = duration
		this.emitter.emit('renderEnd', { time: this.options.time, duration })
	}

	// Creates the render state passed to layers.
	private createRenderState(): RenderState {
		return {
			width: this.options.width,
			height: this.options.height,
			dpr: this.renderer.devicePixelRatio,
			time: this.options.time,
			observer: this.options.observer,
			projection: this.options.projection,
			coordinateSystem: this.options.coordinateSystem,
			transform: this.transform,
			theme: this.options.theme,
			starCatalog: this.starCatalog,
			constellations: this.constellations,
			deepSkyObjects: this.deepSkyObjects,
			planets: this.planets,
			hoverObject: this.hoverObject,
			selectedObject: this.selectedObject,
			debug: this.debug,
			projectEquatorialToScreen: this.projectEquatorialToScreen,
			__projectWorldVector: this.projectWorldVectorToScreen,
		} as RenderState
	}

	// Resolves a pick index into a public object payload.
	private resolvePick(index: PickIndex | null): CelestialObject | null {
		if (!index) {
			return null
		}

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
		if (!this.options.interactions.enabled) {
			return
		}

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
		if (!this.options.interactions.enabled || this.d3ZoomBound) {
			return
		}

		const behavior = zoom<HTMLElement, unknown>()
			.scaleExtent([this.options.interactions.minZoom, this.options.interactions.maxZoom])
			.on('zoom', (event: D3ZoomEvent<HTMLElement, unknown>) => {
				const k = event.transform.k
				this.transform = {
					x: event.transform.x - (this.options.width / 2) * (1 - k),
					y: event.transform.y - (this.options.height / 2) * (1 - k),
					k,
				}
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
		if (!this.d3ZoomBound) {
			return
		}

		select(this.renderer.element).on('.zoom', null)
		this.d3ZoomBound = false
	}

	// Handles pointer down for local panning.
	private readonly handlePointerDown = (event: PointerEvent): void => {
		if (event.button !== 0) {
			return
		}
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

		if (now - this.lastPointerMove < this.options.interactions.pointerMoveThrottleMs) {
			return
		}

		this.lastPointerMove = now
		const point = this.eventPoint(event)
		const object = this.resolvePick(this.picking.findNearest(point[0], point[1], this.options.interactions.pickRadius))
		this.updateHover(object)
	}

	// Handles pointer up.
	private readonly handlePointerUp = (event: PointerEvent): void => {
		if (!this.pointerDown) {
			return
		}
		this.pointerDown = false
		this.renderer.element.releasePointerCapture?.(event.pointerId)
	}

	// Handles click selection.
	private readonly handleClick = (event: MouseEvent): void => {
		if (this.pointerMoved) {
			return
		}

		const point = this.eventPoint(event)
		const object = this.resolvePick(this.picking.findNearest(point[0], point[1], this.options.interactions.pickRadius))
		if (!object) {
			return
		}

		this.selectedObject = object
		this.renderer.markDirty('overlay')
		this.emitter.emit('objectClick', { object, originalEvent: event })
		this.emitter.emit('selectionChange', { object })
		this.requestRender()
	}

	// Handles wheel zoom centered on the pointer.
	private readonly handleWheel = (event: WheelEvent): void => {
		event.preventDefault()
		const point = this.eventPoint(event)
		const previousK = this.transform.k
		const nextK = clamp(previousK * Math.exp(-event.deltaY * 0.001), this.options.interactions.minZoom, this.options.interactions.maxZoom)
		if (nextK === previousK) {
			return
		}

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
		if (sameObject(this.hoverObject, object)) {
			return
		}

		if (this.hoverObject) {
			this.emitter.emit('objectLeave', { object: this.hoverObject })
		}
		this.hoverObject = object
		if (object) {
			this.emitter.emit('objectHover', { object })
		}
		this.renderer.markDirty('overlay')
		this.requestRender()
	}

	// Converts pointer event coordinates into renderer-local coordinates.
	private eventPoint(event: MouseEvent | PointerEvent | WheelEvent): Float32Array {
		const rect = this.renderer.element.getBoundingClientRect()
		this.tempScreen[0] = event.clientX - rect.left
		this.tempScreen[1] = event.clientY - rect.top
		return this.tempScreen
	}
}

// Compares nullable object identity by semantic type/index.
function sameObject(a: CelestialObject | null, b: CelestialObject | null): boolean {
	if (a === b) {
		return true
	}
	if (!a || !b || a.type !== b.type) {
		return false
	}
	return 'index' in a && 'index' in b && a.index === b.index
}

// Normalizes thrown values to Error instances.
function normalizeError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error))
}

export default Celestial
