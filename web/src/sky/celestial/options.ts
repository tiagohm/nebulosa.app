import { clamp } from 'nebulosa/src/math/numerical/math'
import { isFiniteNumber } from './geometry'
import type { CelestialOptions, InteractionOptions, ObserverLocation, PartialThemeOptions, ProjectionType, ReferenceLineOptions, ReferenceLinesOptions, ResolvedCelestialOptions, ResolvedReferenceLineOptions, ResolvedReferenceLinesOptions, StarLayerOptions, ThemeOptions } from './types'

// Defaults of the star map and the resolution of caller options into a fully specified, validated shape.

// Canvas width in pixels used when callers do not provide one.
export const DEFAULT_WIDTH = 800

// Canvas height in pixels used when callers do not provide one.
export const DEFAULT_HEIGHT = 800

// Device pixel ratio cap; limits the quadratic canvas backing-store growth on high-density displays.
const DEFAULT_MAX_DEVICE_PIXEL_RATIO = 2

// Realtime update interval in milliseconds; lower updates sky positions more often, higher reduces work.
const DEFAULT_UPDATE_INTERVAL = 10000

// CSS keyword for a fill that draws nothing.
export const TRANSPARENT = 'transparent'

// Material palette colors used by the default theme.
const WHITE = '#FFFFFF'
const RED = '#F44336'
const PURPLE = '#9C27B0'
const INDIGO = '#3F51B5'
const BLUE = '#2196F3'
const LIGHT_BLUE = '#03A9F4'
const CYAN = '#00BCD4'
const GREEN = '#4CAF50'
const LIGHT_GREEN = '#8BC34A'
const LIME = '#CDDC39'
const YELLOW = '#FFEB3B'
const ORANGE = '#FF9800'
const BROWN = '#795548'
const GREY = '#9E9E9E'
const BLUE_GREY = '#607D8B'

// Theme used for every field callers leave unspecified.
export const DEFAULT_THEME: ThemeOptions = {
	background: TRANSPARENT,
	stars: {
		baseColor: '#f8fbff',
		labelColor: '#d8deca',
		labelFont: '10px system-ui, sans-serif',
		magnitudeScale: [-1.5, 9],
		minRadius: 0.45,
		maxRadius: 1.8,
	},
	grid: {
		color: GREY,
		opacity: 0.38,
	},
	horizon: {
		color: GREEN,
		fillBelowHorizon: TRANSPARENT,
	},
	milkyWay: {
		lineColor: CYAN,
		levelColors: [CYAN, LIGHT_BLUE, BLUE, INDIGO, PURPLE],
		levelOpacities: [0.7, 0, 0, 0, 0],
		lineOpacity: 0.6,
		lineWidth: 0.65,
	},
	constellations: {
		color: GREY,
		opacity: 0.7,
		labelColor: WHITE,
		labelFont: '10px system-ui, sans-serif',
		labelOpacity: 0.7,
		lineColor: BLUE_GREY,
		lineOpacity: 0.3,
		boundaryColor: PURPLE,
		boundaryOpacity: 0.6,
	},
	deepSky: {
		color: ORANGE,
		labelColor: ORANGE,
	},
	movingBodies: {
		planetColor: RED,
		asteroidColor: BROWN,
		cometColor: LIME,
		labelColor: LIGHT_GREEN,
	},
	selectedObject: {
		color: YELLOW,
	},
	hoverHighlight: {
		color: LIGHT_BLUE,
	},
}

// Observer at the intersection of the equator and the prime meridian, used until one is set.
const DEFAULT_OBSERVER: ObserverLocation = {
	latitude: 0,
	longitude: 0,
	elevation: 0,
}

// Initial visibility of each built-in layer.
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

// Star layer options used for every field callers leave unspecified.
export const DEFAULT_STAR_OPTIONS: Required<StarLayerOptions> = {
	maxMagnitude: 9,
	colorByBV: true,
	sizeByMagnitude: true,
	maxRenderStars: Number.POSITIVE_INFINITY,
	labels: true,
}

// Reference line styles used for every field callers leave unspecified.
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

// Interaction options used for every field callers leave unspecified.
const DEFAULT_INTERACTION_OPTIONS: Required<InteractionOptions> = {
	enabled: true,
	minZoom: 0.35,
	maxZoom: 1000,
	pickRadius: 7,
	touchPickRadius: 22,
	tapSlop: 3,
	touchTapSlop: 10,
	pointerMoveThrottleMs: 32,
	wheelZoomSpeed: 0.0004,
}

// Returns a supported projection, falling back to the azimuthal equidistant one.
export function validateProjection(value: ProjectionType): ProjectionType {
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

// Returns a copy of an observer with non-finite values zeroed and latitude and longitude clamped to their
// degree ranges.
export function validateObserver(observer: ObserverLocation): ObserverLocation {
	return {
		latitude: clamp(isFiniteNumber(observer.latitude) ? observer.latitude : 0, -90, 90),
		longitude: clamp(isFiniteNumber(observer.longitude) ? observer.longitude : 0, -180, 180),
		elevation: isFiniteNumber(observer.elevation) ? observer.elevation : 0,
	}
}

// Deep-merges theme overrides over the default theme without mutating it.
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

// Merges reference line overrides over the defaults.
function mergeReferenceLines(referenceLines?: ReferenceLinesOptions): ResolvedReferenceLinesOptions {
	return {
		localMeridian: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.localMeridian, referenceLines?.localMeridian),
		celestialEquator: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.celestialEquator, referenceLines?.celestialEquator),
		ecliptic: mergeReferenceLine(DEFAULT_REFERENCE_LINES_OPTIONS.ecliptic, referenceLines?.ecliptic),
	}
}

// Merges one reference line override over its defaults, keeping the width at least 0.1 pixel.
function mergeReferenceLine(defaults: ResolvedReferenceLineOptions, options?: ReferenceLineOptions): ResolvedReferenceLineOptions {
	return {
		enabled: options?.enabled ?? defaults.enabled,
		color: options?.color ?? defaults.color,
		lineWidth: Math.max(0.1, options?.lineWidth ?? defaults.lineWidth),
	}
}

// Resolves constructor options into a fully specified shape whose time is the given Unix time in
// milliseconds (UTC).
export function resolveOptions(options: CelestialOptions, time: number): ResolvedCelestialOptions {
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
		maxDevicePixelRatio: Math.max(1, isFiniteNumber(options.maxDevicePixelRatio) ? options.maxDevicePixelRatio : DEFAULT_MAX_DEVICE_PIXEL_RATIO),
		projection: validateProjection(options.projection ?? 'stereographic'),
		coordinateSystem: options.coordinateSystem ?? 'horizontal',
		observer: DEFAULT_OBSERVER,
		time,
		updateInterval: Math.max(1, Math.floor(options.updateInterval ?? DEFAULT_UPDATE_INTERVAL)),
		stars: { ...DEFAULT_STAR_OPTIONS, ...options.stars },
		referenceLines: mergeReferenceLines(options.referenceLines),
		layers,
		theme: mergeTheme(options.theme),
		interactions,
	}
}
