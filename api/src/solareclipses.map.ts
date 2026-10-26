import { nearestSolarEclipse, type SolarEclipse, type SolarEclipseType } from 'nebulosa/src/astronomy/bodies/sun'
import { type EclipseGeoPoint, geoPolylinesToSvgPathData, sunMoonPosition } from 'nebulosa/src/astronomy/events/eclipse/eclipse'
import { computeGreatestDurationCircumstances, computeGreatestEclipseCircumstances, type SolarEclipseExtremeCircumstances } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import { computePolynomialBesselianElements, computeSolarEclipseMapGeometry, type HybridEclipseKind, type PolynomialBesselianElements, type SolarEclipseContactPoints, solarAltitudeAtPoint, solarEclipseMapToSvgPaths, splitCentralLineByKind } from 'nebulosa/src/astronomy/events/eclipse/solar/map'
import { timeAtJulianDay, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { toDeg } from 'nebulosa/src/math/units/angle'
import { DEGREE_PLANE, type EclipseDirection, type EclipseLocation, ID_SEARCH_MARGIN, MAP_PRECISION } from './eclipses'

// Solar eclipses and their global maps, the pure part of the solar eclipse routes (solareclipses.ts) shared with
// the map worker (solareclipses.worker.ts): stepping through the toolkit's solar eclipses, naming them by id, the
// Unix milliseconds of their greatest eclipse, and drawing their central line, limits, and sunrise/sunset curves
// on the degree plane of eclipses.ts. A map costs hundreds of milliseconds, which is why it runs on the worker.
// Times are Unix milliseconds (UTC, converted from the toolkit's TT), angles and positions degrees (longitude east
// positive), durations seconds, widths kilometers.

export type { HybridEclipseKind, SolarEclipseType }

// Named point of a global map: P1 to P4 penumbral contacts with the Earth, U1 to U4 umbral ones, C1 and C2 the
// ends of the central line, MAX the greatest eclipse, N1, N2, S1, and S2 the ends of the northern and southern
// limits of the partial eclipse.
export type SolarEclipsePointKind = keyof SolarEclipseContactPoints

// Global circumstances of a solar eclipse, the same for every observer.
export interface SolarEclipseSummary {
	// Id of the eclipse: the Unix milliseconds of its greatest eclipse, as a decimal string.
	readonly id: string
	// Type of the eclipse.
	readonly type: SolarEclipseType
	// Instant of the greatest eclipse, in Unix milliseconds (UTC).
	readonly maximum: number
	// Magnitude at the greatest eclipse: the Moon/Sun apparent diameter ratio for a central eclipse, the fraction
	// of the solar diameter covered otherwise; dimensionless.
	readonly magnitude: number
	// Least distance of the shadow axis from the Earth's center, in Earth equatorial radii, negative south.
	readonly gamma: number
	// Whether the shadow axis meets the Earth.
	readonly central: boolean
	// Meeus lunation number of the new moon of the eclipse.
	readonly lunation: number
}

// A named point of a global map.
export interface SolarEclipseMapPoint extends EclipseLocation {
	// Instant at which the point has its circumstance, in Unix milliseconds (UTC), when known.
	readonly time?: number
	// Geometric altitude of the Sun there at that instant, in degrees, when the instant is known: about 0 at the
	// points on the sunrise/sunset curve (P1, P4, C1, C2, N1, N2, S1, S2).
	readonly sunAltitude?: number
}

// Circumstances at the greatest eclipse or the greatest duration of the central phase.
export interface SolarEclipseExtreme extends EclipseLocation {
	// Instant, in Unix milliseconds (UTC).
	readonly time: number
	// Geometric altitude of the Sun, in degrees.
	readonly sunAltitude: number
	// Azimuth of the Sun, in degrees, north through east, [0, 360).
	readonly sunAzimuth: number
	// Width of the central path on the ground, in kilometers; absent when the point is not central.
	readonly pathWidth?: number
	// Duration of the central phase there, in seconds; absent when the point is not central.
	readonly centralDuration?: number
	// Whether the central phase is total or annular there; absent when the point is not central.
	readonly kind?: HybridEclipseKind
}

// Line of a global map: total and annular are the parts of the central line where the eclipse is total or
// annular, umbraNorth and umbraSouth the northern and southern limits of the total or annular eclipse,
// penumbraNorth and penumbraSouth those of the partial eclipse, and riseSet where the eclipse begins, is
// greatest, or ends at sunrise or sunset.
export type SolarEclipsePathKind = 'total' | 'annular' | 'umbraNorth' | 'umbraSouth' | 'penumbraNorth' | 'penumbraSouth' | 'riseSet'

// SVG path data of the lines of a global map, drawn on the degree plane: x = longitude + 180 in [0, 360] and y =
// 90 - latitude in [0, 180]. Every separate branch is its own subpath, never joined to another; a line the
// eclipse does not have is absent.
export type SolarEclipsePaths = Partial<Record<SolarEclipsePathKind, string>>

// Global map of a solar eclipse.
export interface SolarEclipseMap {
	// Eclipse.
	readonly eclipse: SolarEclipseSummary
	// TT - UT1 of the elements the map was computed with, in seconds.
	readonly deltaT: number
	// Named points the eclipse has.
	readonly points: Partial<Record<SolarEclipsePointKind, SolarEclipseMapPoint>>
	// Circumstances at the greatest eclipse, absent when it cannot be placed on the Earth.
	readonly greatestEclipse?: SolarEclipseExtreme
	// Circumstances where the central phase lasts longest, absent for an eclipse without a central line.
	readonly greatestDuration?: SolarEclipseExtreme
	// Lines.
	readonly paths: SolarEclipsePaths
}

// Id of an eclipse: the Unix milliseconds of its greatest eclipse, truncated.
export function solarEclipseId(eclipse: SolarEclipse): string {
	return `${timeToUnixMillis(eclipse.maximalTime)}`
}

// Returns the eclipse nearest an instant in a direction: the next one has an id later than time, the previous one an
// id earlier than it, so stepping from an id never returns the same eclipse. time is in Unix milliseconds.
export function findSolarEclipse(time: number, direction: EclipseDirection): SolarEclipse {
	// The greatest eclipse is up to a millisecond after its id, so the instant is moved by one millisecond away from it.
	return direction === 'next' ? nearestSolarEclipse(timeUnix((time + 1) / 1000), true) : nearestSolarEclipse(timeUnix((time - 1) / 1000), false)
}

// Returns the eclipse an id names, or undefined when it names none.
export function resolveSolarEclipse(id: string): SolarEclipse | undefined {
	const eclipse = findSolarEclipse(+id - ID_SEARCH_MARGIN, 'next')
	return solarEclipseId(eclipse) === id ? eclipse : undefined
}

// Returns the global circumstances of an eclipse.
export function solarEclipseSummary(eclipse: SolarEclipse): SolarEclipseSummary {
	return { id: solarEclipseId(eclipse), type: eclipse.type, maximum: timeToUnixMillis(eclipse.maximalTime), magnitude: eclipse.magnitude, gamma: eclipse.gamma, central: eclipse.central, lunation: eclipse.lunation }
}

// Returns the polynomial Besselian elements of an eclipse, fitted on the ephemeris every solar eclipse
// computation of the API uses, so the map and the local circumstances agree.
export function solarEclipseElements(eclipse: SolarEclipse): PolynomialBesselianElements {
	return computePolynomialBesselianElements(eclipse.maximalTime, sunMoonPosition)
}

// Returns the Unix milliseconds of a Julian Day on the time scale of the elements (TT).
function julianDayMillis(pbe: PolynomialBesselianElements, jd: number) {
	return timeToUnixMillis(timeAtJulianDay(pbe.time0, jd))
}

// Returns a named point in degrees, with its instant and the Sun's altitude when it has an instant.
function mapPoint(pbe: PolynomialBesselianElements, point: EclipseGeoPoint): SolarEclipseMapPoint {
	const location = { longitude: toDeg(point.x), latitude: toDeg(point.y) }
	return point.jd === undefined ? location : { ...location, time: julianDayMillis(pbe, point.jd), sunAltitude: toDeg(solarAltitudeAtPoint(pbe, point)) }
}

// Returns the toolkit's extreme circumstances in degrees and Unix milliseconds.
function extreme(circumstances: SolarEclipseExtremeCircumstances | undefined): SolarEclipseExtreme | undefined {
	if (!circumstances) return undefined
	const { longitude, latitude, time, sunAltitude, sunAzimuth, pathWidthKm, centralDuration, kind } = circumstances
	return { longitude: toDeg(longitude), latitude: toDeg(latitude), time: timeToUnixMillis(time), sunAltitude: toDeg(sunAltitude), sunAzimuth: toDeg(sunAzimuth), pathWidth: pathWidthKm, centralDuration, kind }
}

// Returns the global map of an eclipse: its named points, its greatest eclipse and duration, and its lines, with
// the central line split where a hybrid eclipse changes between total and annular.
export function solarEclipseMap(eclipse: SolarEclipse): SolarEclipseMap {
	const pbe = solarEclipseElements(eclipse)
	const geometry = computeSolarEclipseMapGeometry(eclipse, pbe, { includeRiseSetCurves: true })
	const svg = solarEclipseMapToSvgPaths(geometry, DEGREE_PLANE, { precision: MAP_PRECISION })
	const central = splitCentralLineByKind(geometry.lines.centerLine, pbe)

	const lines: Readonly<Record<SolarEclipsePathKind, string>> = {
		total: geoPolylinesToSvgPathData(central.total, DEGREE_PLANE, MAP_PRECISION),
		annular: geoPolylinesToSvgPathData(central.annular, DEGREE_PLANE, MAP_PRECISION),
		umbraNorth: svg.umbraNorth,
		umbraSouth: svg.umbraSouth,
		penumbraNorth: svg.penumbraNorth,
		penumbraSouth: svg.penumbraSouth,
		riseSet: svg.riseSetCurves,
	}

	const paths: SolarEclipsePaths = {}

	for (const [kind, path] of Object.entries(lines) as [SolarEclipsePathKind, string][]) {
		if (path) paths[kind] = path
	}

	const points: Partial<Record<SolarEclipsePointKind, SolarEclipseMapPoint>> = {}

	for (const [kind, point] of Object.entries(geometry.points) as [SolarEclipsePointKind, EclipseGeoPoint | undefined][]) {
		if (point) points[kind] = mapPoint(pbe, point)
	}

	return {
		eclipse: solarEclipseSummary(eclipse),
		deltaT: pbe.deltaT,
		points,
		greatestEclipse: extreme(computeGreatestEclipseCircumstances(pbe)),
		greatestDuration: extreme(computeGreatestDurationCircumstances(pbe)),
		paths,
	}
}
