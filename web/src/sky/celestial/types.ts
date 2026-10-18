import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { StellariumObjectType } from 'nebulosa/src/catalogs/stars/stellarium/nebulae'
import type { NumberArray } from 'nebulosa/src/math/numerical/math'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { DeepSkyCatalog, StarCatalog } from './catalog'
import type { Celestial } from './celestial'

// Public and shared types of the Celestial star map: input data, options, theme, render state, picked
// objects, and events. Angles are radians unless a name says otherwise; screen values are CSS pixels.

// Azimuthal projection used to map the celestial sphere onto the canvas.
export type ProjectionType = 'azimuthalEquidistant' | 'azimuthalEqualArea' | 'orthographic' | 'stereographic' | 'gnomonic'

// Frame the view is oriented in: local horizon (zenith up) or equatorial (celestial pole up).
export type CoordinateSystem = 'horizontal' | 'equatorial'

// Event names emitted by Celestial.
export type CelestialEventName = 'hover' | 'click' | 'objectHover' | 'objectLeave' | 'selectionChange' | 'viewTransformChange' | 'renderStart' | 'renderEnd' | 'updateStart' | 'updateEnd' | 'resize' | 'error'

// Identifier of a star or deep-sky object, as provided by its catalog.
export type StarId = string | number

// Observer location on the WGS84 ellipsoid.
export interface ObserverLocation {
	// Geodetic latitude in degrees, north positive, in [-90, 90].
	latitude: number
	// Geodetic longitude in degrees, east positive, in [-180, 180].
	longitude: number
	// Height above the ellipsoid in meters.
	elevation?: number
}

// Star entry for object-array catalog loading.
export interface Star extends EquatorialCoordinate {
	// Catalog identifier.
	id?: StarId
	// Proper name shown as label.
	name?: string
	// Visual magnitude; stars without one are treated as magnitude 99.
	magnitude?: number
	// B-V color index in magnitudes, used for star color.
	bv?: number
	// Application-defined bit flags.
	flags?: number
}

// Typed-array catalog input for large catalogs; arrays are indexed in parallel.
export interface StarCatalogInput {
	// Right ascension of each star in radians.
	ra: NumberArray
	// Declination of each star in radians.
	dec: NumberArray
	// Visual magnitude of each star.
	mag?: NumberArray
	// B-V color index of each star in magnitudes.
	bv?: NumberArray
	// Application-defined bit flags of each star.
	flags?: NumberArray
	// Proper name of each star; empty entries are not labeled.
	names: readonly string[]
	// Catalog identifier of each star.
	ids: readonly StarId[]
	// Number of stars to read; defaults to the shortest of the coordinate arrays.
	count?: number
}

// Constellation polyline as consecutive [right ascension, declination] vertices in radians.
export type ConstellationLine = readonly [Angle, Angle][]

// Constellation label anchored at an equatorial position.
export interface ConstellationLabel extends EquatorialCoordinate {
	// Text drawn at the position.
	name: string
}

// Constellation data consumed by the line, boundary, and label layers.
export interface ConstellationData {
	// Stick-figure polylines.
	lines?: ConstellationLine[]
	// Labels drawn at constellation centers.
	labels?: ConstellationLabel[]
	// Boundary polylines.
	boundaries?: ConstellationLine[]
}

// Milky Way outline vertex as [right ascension, declination] in radians.
export type MilkyWayPosition = readonly [Angle, Angle]
// Milky Way outline ring; the last vertex may repeat the first one to close it.
export type MilkyWayLinearRingCoordinates = readonly MilkyWayPosition[]
// Milky Way polygon made of rings.
export type MilkyWayPolygonCoordinates = readonly MilkyWayLinearRingCoordinates[]
// Milky Way brightness levels, from brightest to faintest, as GeoJSON MultiPolygon coordinates.
export type MilkyWayCoordinates = readonly MilkyWayPolygonCoordinates[]

// Deep-sky object entry.
export interface DeepSkyObject extends EquatorialCoordinate {
	// Catalog identifier.
	id: StarId
	// Designation shown as label.
	name: string
	// Stellarium object classification, which selects the drawn symbol.
	type: StellariumObjectType
	// Visual magnitude; objects without one use a default faint magnitude.
	magnitude?: number
	// Apparent size in arcminutes.
	sizeArcMin?: number
}

// Major solar-system body.
export type SolarSystemBody = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune'

// Kind of moving body, which selects its symbol and color.
export type MovingBodyType = SolarSystemBody | 'asteroid' | 'comet'

// Planet, asteroid, or comet with a caller-maintained position.
export interface MovingBody {
	// Unique identifier used to add, replace, and remove the body.
	readonly id: string
	// Kind of body.
	readonly type: MovingBodyType
	// Apparent equatorial position in radians.
	readonly position: EquatorialCoordinate
	// Label; defaults to the type.
	readonly name?: string
	// Visual magnitude; bodies without one are always drawn.
	magnitude?: number
	// Whether the body is drawn; defaults to true.
	visible?: boolean
	// Whether the body can be hovered and selected; defaults to true.
	selectable?: boolean
}

// Theme used by the Canvas layers; colors are CSS color strings and opacities are in [0, 1].
export interface ThemeOptions {
	// Sky background fill.
	background: string
	// Star symbols and labels.
	stars: {
		// Star color when colors are not derived from B-V.
		baseColor: string
		// Star label color.
		labelColor: string
		// Star label CSS font.
		labelFont: string
		// Magnitudes mapped to the largest and smallest star radius.
		magnitudeScale: [number, number]
		// Radius of the faintest star in pixels.
		minRadius: number
		// Radius of the brightest star in pixels.
		maxRadius: number
	}
	// Coordinate grid.
	grid: {
		// Grid line and label color.
		color: string
		// Grid line opacity.
		opacity: number
	}
	// Horizon ring and cardinal points.
	horizon: {
		// Horizon line and label color.
		color: string
		// Fill below the horizon in equatorial views.
		fillBelowHorizon: string
	}
	// Milky Way outline.
	milkyWay: {
		// Color of levels without a specific color.
		lineColor: string
		// Color per brightness level.
		levelColors?: readonly string[]
		// Opacity per brightness level.
		levelOpacities?: readonly number[]
		// Opacity applied to every level.
		lineOpacity: number
		// Outline width in pixels.
		lineWidth: number
	}
	// Constellation lines, boundaries, and labels.
	constellations: {
		// Fallback color of every constellation element.
		color: string
		// Fallback opacity of every constellation element.
		opacity: number
		// Label color.
		labelColor?: string
		// Label CSS font.
		labelFont: string
		// Label opacity.
		labelOpacity?: number
		// Stick-figure line color.
		lineColor?: string
		// Stick-figure line opacity.
		lineOpacity?: number
		// Boundary line color.
		boundaryColor?: string
		// Boundary line opacity.
		boundaryOpacity?: number
	}
	// Deep-sky objects.
	deepSky: {
		// Symbol color.
		color: string
		// Label color.
		labelColor: string
	}
	// Planets, asteroids, and comets.
	movingBodies: {
		// Planet symbol color.
		planetColor: string
		// Asteroid symbol color.
		asteroidColor: string
		// Comet symbol color.
		cometColor: string
		// Label color.
		labelColor: string
	}
	// Selected object ring.
	selectedObject: {
		// Ring color.
		color: string
	}
	// Hovered object ring.
	hoverHighlight: {
		// Ring color.
		color: string
	}
}

// Theme override where each group may be partially specified.
export type PartialThemeOptions = {
	[K in keyof ThemeOptions]?: ThemeOptions[K] extends Record<string, unknown> ? Partial<ThemeOptions[K]> : ThemeOptions[K]
}

// Auto-update options; astronomical updates run on a timer independent from animation frames.
export interface AutoUpdateOptions {
	// Follow the wall clock or advance a simulated clock.
	mode?: 'realtime' | 'simulation'
	// Timer period in milliseconds.
	interval?: number
	// Simulated time advanced per tick in milliseconds; defaults to the interval.
	timeStep?: number
}

// Star layer options.
export interface StarLayerOptions {
	// Faintest magnitude projected and drawn.
	maxMagnitude?: number
	// Whether star colors derive from the B-V index.
	colorByBV?: boolean
	// Whether star radius scales with brightness.
	sizeByMagnitude?: boolean
	// Maximum number of stars projected per update.
	maxRenderStars?: number
	// Whether named stars are labeled.
	labels?: boolean
}

// Style of one reference line.
export interface ReferenceLineOptions {
	// Whether the line is drawn.
	enabled?: boolean
	// CSS stroke color.
	color?: string
	// Stroke width in pixels, at least 0.1.
	lineWidth?: number
}

// Styles of the reference lines.
export interface ReferenceLinesOptions {
	// Local meridian through the zenith and the celestial poles.
	localMeridian?: ReferenceLineOptions
	// Celestial equator of date.
	celestialEquator?: ReferenceLineOptions
	// Ecliptic of date.
	ecliptic?: ReferenceLineOptions
}

// Reference line style with every field resolved.
export type ResolvedReferenceLineOptions = Required<ReferenceLineOptions>

// Reference line styles with every field resolved.
export interface ResolvedReferenceLinesOptions {
	// Local meridian style.
	readonly localMeridian: ResolvedReferenceLineOptions
	// Celestial equator style.
	readonly celestialEquator: ResolvedReferenceLineOptions
	// Ecliptic style.
	readonly ecliptic: ResolvedReferenceLineOptions
}

// Pointer interaction options.
export interface InteractionOptions {
	// Whether pan, zoom, hover, and click are handled.
	enabled?: boolean
	// Smallest zoom factor.
	minZoom?: number
	// Largest zoom factor.
	maxZoom?: number
	// Picking radius in pixels.
	pickRadius?: number
	// Minimum interval between hover picks in milliseconds.
	pointerMoveThrottleMs?: number
	// Zoom change per wheel pixel, in [0.00005, 0.01].
	wheelZoomSpeed?: number
}

// Celestial constructor options.
export interface CelestialOptions {
	// Canvas width in pixels.
	width?: number
	// Canvas height in pixels.
	height?: number
	// Upper bound of the device pixel ratio used for canvas backing stores.
	maxDevicePixelRatio?: number
	// Map projection.
	projection?: ProjectionType
	// Frame the view is oriented in; fixed for the instance lifetime.
	coordinateSystem?: CoordinateSystem
	// Default auto-update interval in milliseconds.
	updateInterval?: number
	// Star layer options.
	stars?: StarLayerOptions
	// Reference line styles.
	referenceLines?: ReferenceLinesOptions
	// Initial visibility per layer id.
	layers?: Partial<Record<string, boolean>>
	// Theme overrides.
	theme?: PartialThemeOptions
	// Pointer interaction options.
	interactions?: InteractionOptions
}

// Options with every field resolved; mutable fields change through Celestial setters.
export interface ResolvedCelestialOptions {
	// Canvas width in pixels.
	width: number
	// Canvas height in pixels.
	height: number
	// Upper bound of the device pixel ratio.
	readonly maxDevicePixelRatio: number
	// Map projection.
	projection: ProjectionType
	// Frame the view is oriented in.
	readonly coordinateSystem: CoordinateSystem
	// Observer location.
	observer: ObserverLocation
	// Observation instant as Unix time in milliseconds (UTC).
	time: number
	// Default auto-update interval in milliseconds.
	updateInterval: number
	// Star layer options.
	readonly stars: Required<StarLayerOptions>
	// Reference line styles.
	readonly referenceLines: ResolvedReferenceLinesOptions
	// Visibility per layer id.
	readonly layers: Record<string, boolean>
	// Theme.
	readonly theme: ThemeOptions
	// Pointer interaction options.
	readonly interactions: Required<InteractionOptions>
}

// Pan and zoom transform relative to the canvas center: a base position b is shown at center + (x, y) + (b - center) × k.
export interface ViewTransform {
	// Horizontal translation in pixels.
	x: number
	// Vertical translation in pixels.
	y: number
	// Zoom factor.
	k: number
}

// Object to select programmatically: a loaded star, deep-sky object, moving body, or constellation label
// by its id.
export interface SelectionTarget {
	// Kind of object.
	readonly type: 'star' | 'deepSky' | 'movingBody' | 'constellationLabel'
	// Catalog id of the star or deep-sky object, id of the moving body, or name of the label.
	readonly id: StarId
}

// Navigation state of the map, enough to restore the same view in a new instance of the same
// coordinate system: the view orientation and the pan and zoom transform.
export interface ViewState {
	// World unit vector (frame of the coordinate system) at the view center.
	readonly center: readonly [number, number, number]
	// World unit vector that orients the view's up direction.
	readonly up: readonly [number, number, number]
	// Pan and zoom transform.
	readonly transform: ViewTransform
}

// Milky Way ring prepared for projection.
export interface MilkyWayRing {
	// Equatorial unit vectors, three components per vertex.
	readonly vectors: Float32Array
	// Number of vertices.
	readonly pointCount: number
	// Whether the last vertex connects back to the first one.
	readonly closed: boolean
}

// Milky Way brightness level prepared for projection.
export interface MilkyWayStep {
	// Rings of the level.
	readonly rings: readonly MilkyWayRing[]
}

// Samples a projection at a screen position in base (untransformed) or transformed coordinates, writing it
// to `out[0..1]` (NaN when not projectable), and returns the horizon visibility (sine of the altitude in
// horizontal views, 1 otherwise).
export type ProjectionSample = (a: number, b: number, out: NumberArray) => number

// Samples a projection of an equatorial unit vector like ProjectionSample.
export type VectorProjectionSample = (x: number, y: number, z: number, out: NumberArray) => number

// Projects a coordinate to transformed screen pixels in `out[0..1]` and returns whether it is visible.
export type ProjectionToScreen = (a: number, b: number, out: NumberArray) => boolean

// Render state passed to layers and custom shapes; it is reused across frames.
export interface RenderState {
	// Owning map.
	readonly celestial: Celestial
	// Canvas width in pixels.
	readonly width: number
	// Canvas height in pixels.
	readonly height: number
	// Device pixel ratio of the canvas backing stores.
	readonly dpr: number
	// Observation instant as Unix time in milliseconds (UTC).
	readonly time: number
	// Observer location.
	readonly observer: Readonly<ObserverLocation>
	// Map projection.
	readonly projection: ProjectionType
	// Frame the view is oriented in.
	readonly coordinateSystem: CoordinateSystem
	// Pan and zoom transform.
	readonly transform: Readonly<ViewTransform>
	// Radius of the projection disk in base pixels.
	readonly projectionRadius: number
	// Counter incremented whenever base projected geometry becomes stale; layers key their caches on it.
	readonly projectedGeometryRevision: number
	// Reference line styles.
	readonly referenceLines: ResolvedReferenceLinesOptions
	// Star layer options.
	readonly stars: Readonly<Required<StarLayerOptions>>
	// Theme.
	readonly theme: Readonly<ThemeOptions>
	// Loaded star catalog.
	readonly starCatalog: StarCatalog | null
	// Loaded deep-sky catalog.
	readonly deepSkyCatalog: DeepSkyCatalog | null
	// Loaded constellation data.
	readonly constellations: Readonly<ConstellationData>
	// Loaded Milky Way levels.
	readonly milkyWay: readonly Readonly<MilkyWayStep>[]
	// Moving bodies in insertion order.
	readonly movingBodies: readonly Readonly<MovingBody>[]
	// Custom shapes in insertion order.
	readonly shapes: readonly Readonly<CelestialShape>[]
	// Object under the pointer.
	readonly hoverObject: Readonly<CelestialObject> | null
	// Selected object.
	readonly selectedObject: Readonly<CelestialObject> | null
	// Projects right ascension and declination (radians) to transformed screen pixels.
	readonly projectEquatorialToScreen: ProjectionToScreen
	// Samples right ascension and declination (radians) in transformed screen pixels.
	readonly projectEquatorialSample: ProjectionSample
	// Samples an equatorial unit vector in transformed screen pixels.
	readonly projectEquatorialVectorSample: VectorProjectionSample
	// Samples right ascension and declination (radians) in base screen pixels.
	readonly projectEquatorialBaseSample: ProjectionSample
	// Samples an equatorial unit vector in base screen pixels.
	readonly projectEquatorialVectorBaseSample: VectorProjectionSample
	// Projects azimuth and altitude (radians) to transformed screen pixels.
	readonly projectHorizontalToScreen: ProjectionToScreen
	// Samples azimuth and altitude (radians) in transformed screen pixels.
	readonly projectHorizontalSample: ProjectionSample
	// Samples azimuth and altitude (radians) in base screen pixels.
	readonly projectHorizontalBaseSample: ProjectionSample
}

// State passed to a custom shape renderer.
export interface ShapeRenderState {
	// Shape identifier.
	readonly id: string
	// Projected horizontal position in pixels.
	readonly x: number
	// Projected vertical position in pixels.
	readonly y: number
	// Shape anchor in radians.
	readonly coordinate: Readonly<EquatorialCoordinate>
	// Shape being drawn.
	readonly shape: Readonly<CelestialShape>
	// Current render state.
	readonly state: RenderState
}

// Shape render state reused by the shape layer across draws.
export type MutableShapeRenderState = {
	-readonly [K in keyof ShapeRenderState]: ShapeRenderState[K]
}

// Custom marker anchored at an equatorial coordinate and drawn by the caller.
export interface CelestialShape {
	// Unique identifier used to add, replace, and remove the shape.
	readonly id: string
	// Anchor in radians.
	readonly coordinate: EquatorialCoordinate
	// Whether the shape is drawn; defaults to true.
	visible?: boolean
	// Whether the shape can be hovered and selected; defaults to true.
	selectable?: boolean
	// Caller data carried along with the shape.
	readonly data?: unknown
	// Caller-defined kind.
	readonly type?: string
	// Draws the shape; the context is saved and restored around the call.
	readonly render: (celestial: Celestial, ctx: CanvasRenderingContext2D, state: ShapeRenderState) => void
}

// Object reported by picking and events.
export type CelestialObject =
	| ({ type: 'star'; index: number; id: StarId; name?: string; mag?: number } & EquatorialCoordinate)
	| { type: 'deepSky'; index: number; object: DeepSkyObject }
	| { type: 'movingBody'; index: number; object: MovingBody }
	| { type: 'constellationLabel'; index: number; label: ConstellationLabel }
	| { type: 'shape'; id: string; shape: CelestialShape }

// Payload of each event; `time` is a Unix time in milliseconds (UTC) and positions are pixels.
export type CelestialEventMap = {
	readonly hover: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null }>
	readonly click: Readonly<{ x: number; y: number; coordinate: EquatorialCoordinate; object: CelestialObject | null; event: MouseEvent }>
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

// Event callback; durations are milliseconds.
export type CelestialEventCallback<K extends CelestialEventName = CelestialEventName> = (payload: CelestialEventMap[K], eventName: K) => void
