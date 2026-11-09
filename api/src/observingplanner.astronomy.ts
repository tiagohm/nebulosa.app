import type { Database } from 'bun:sqlite'
import { equatorial, type PositionOverTime } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { equatorialFromJ2000, equatorialToHorizontal } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { frameToFrame, ICRS, ITRS } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import { altitudeOf, ASTRONOMICAL_TWILIGHT } from 'nebulosa/src/astronomy/events/horizon'
import { searchExtrema } from 'nebulosa/src/astronomy/events/search'
import { type VisibilityConstraints, visibilityWindows } from 'nebulosa/src/astronomy/events/visibility'
import { airmassKastenYoung } from 'nebulosa/src/astronomy/formulas'
import { meteorMoonIllumination } from 'nebulosa/src/astronomy/meteors/observation'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { moonInterference, type ObservationScoreFactors, observationScore, observationScoreFactors } from 'nebulosa/src/astronomy/planning'
import { greenwichApparentSiderealTime, precessionNutationMatrix, type Time, type TimeProviders, timeShift, timeToUnixMillis, timeUnix, ut1 } from 'nebulosa/src/astronomy/time/time'
import { DEG2RAD, J2000, TAU } from 'nebulosa/src/core/constants'
import { type Vec3, vecAngle, vecLength } from 'nebulosa/src/math/linear-algebra/vec3'
import type { AstroWeatherNight, AstroWeatherNightRequest } from './astroweather.night'
import { solarSystemBody } from './sky/bodies'
import { catalogObject } from './sky/catalog'
import { bodyModel, geocentricInterpolation, geographic, type SkyObserver } from './sky/ephemeris'
import { type TimeSpan, zonedDate } from './sky/sun'
import type { SolarSystemBodyCode } from './sky/types'

// Astronomy of the Observing Planner: the night of a site and civil evening date, and the analysis of one target over
// it (visibility windows, display samples, culmination, reasons, and an explainable score). Fixed targets and major
// bodies are computed locally from the sky catalog and the toolkit's analytical models, never JPL; a minor body arrives
// as a trajectory already prepared for the whole night (observingplanner.minorbodies.ts), so the analysis itself stays
// synchronous and local. Directions given to the toolkit are ICRS-oriented vectors in AU: fixed targets are their J2000
// place moved by proper motion, and the Sun, the Moon, the planets, and minor bodies are geometric vectors from the
// observer (topocentric, so parallax is included once). Altitudes are
// geometric (airless) everywhere: constraints, airmass, samples, and score. Angles are radians and times Unix
// milliseconds (UTC) unless a name says otherwise.

// Version of the score model; changes whenever its inputs, ramps, or combination change.
export const OBSERVING_SCORE_MODEL_VERSION = 1

// Root-finder step of the visibility search, in days (10 minutes). A window or a gap shorter than it can be missed; the
// shortest continuous duration a window may require is the same, so a missed window could never qualify.
export const SEARCH_STEP_DAYS = 10 / 1440

// Shortest continuous duration a window may require, in milliseconds: the search step.
export const MINIMUM_CONTINUOUS_MS = 600_000

// Spacing of the display samples, in milliseconds (10 minutes).
const SAMPLE_INTERVAL_MS = 600_000

// Days per Julian year, for proper motion.
const DAYS_PER_JULIAN_YEAR = 365.25

// Milliseconds per hour.
const HOUR_MS = 3_600_000

// Airmass at which the score's airmass factor reaches zero when the constraints set no airmass limit.
const SCORE_MAXIMUM_AIRMASS = 3

// Major body the planner evaluates: the Moon, the planets, and Pluto, all with a local model. The Sun is not a target.
export type PlanningBodyCode = Exclude<SolarSystemBodyCode, '10'>

// Every planning body, in the order the discovery lists them.
export const PLANNING_BODY_CODES: readonly PlanningBodyCode[] = ['301', '199', '299', '499', '599', '699', '799', '899', '999']

// Identity of a planner target. Catalog, body, and minor-body kinds are those of SkyObjectRef; coordinates are a named
// fixed place; a meteor shower is an observing event of a shower, analyzed by the Meteor Showers service, never a fixed
// target at its radiant.
export type ObservingTargetRef =
	// Star or deep-sky object of the sky catalog.
	| { readonly kind: 'catalog'; readonly id: number }
	// Moon, planet, or Pluto, evaluated at every instant from its local model.
	| { readonly kind: 'body'; readonly code: PlanningBodyCode }
	// Asteroid or comet, evaluated over the night from one ephemeris source (see observingplanner.minorbodies.ts).
	| {
			readonly kind: 'minorBody'
			// Canonical SBDB SPK-ID, decimal text: the identity, never compared as a number.
			readonly spkId: string
			// Designation, shown when nothing else names the body; not an identity.
			readonly designation: string
	  }
	// Observation of a meteor shower by its shower id (iau:<number>), whose windows are the shower's geometric observing
	// windows: darkness, its radiant high enough, and its activity, never a pointing.
	| { readonly kind: 'meteorShower'; readonly id: string }
	// Fixed place entered by the user, ICRS/J2000.
	| {
			readonly kind: 'coordinates'
			// Name shown for the place.
			readonly name: string
			// Right ascension at J2000, in radians [0, 2π).
			readonly rightAscension: number
			// Declination at J2000, in radians [−π/2, π/2].
			readonly declination: number
	  }

// Kind of observation a set of constraints is meant for; it selects the presets and the score's sky factors.
export type ObservingMode = 'deepSky' | 'visual' | 'planetary'

// Hard limits a target must satisfy together to be observable. Angles are radians and durations milliseconds.
export interface ObservingConstraints {
	// Kind of observation.
	readonly mode: ObservingMode
	// Minimum geometric altitude of the target.
	readonly minimumAltitude: number
	// Maximum Kasten–Young airmass of the target, >= 1; absent sets no limit.
	readonly maximumAirmass?: number
	// Maximum geometric altitude of the Sun's center.
	readonly maximumSunAltitude: number
	// Minimum target–Moon separation, enforced only while the Moon is above the geometric horizon; absent sets no limit.
	readonly minimumMoonSeparation?: number
	// Shortest continuous stretch a window must last, >= MINIMUM_CONTINUOUS_MS.
	readonly minimumContinuousMs: number
}

// Default constraints of each mode: planning heuristics, not limits of any equipment. Deep-sky imaging wants an
// astronomical night, a target above 30° (airmass 2), and a lit Moon well away; visual observing accepts nautical
// twilight and a lower target; planetary observing only needs civil twilight and ignores the Moon.
export const OBSERVING_PRESETS: Readonly<Record<ObservingMode, ObservingConstraints>> = {
	deepSky: { mode: 'deepSky', minimumAltitude: 30 * DEG2RAD, maximumAirmass: 2, maximumSunAltitude: -18 * DEG2RAD, minimumMoonSeparation: 40 * DEG2RAD, minimumContinuousMs: 3_600_000 },
	visual: { mode: 'visual', minimumAltitude: 20 * DEG2RAD, maximumSunAltitude: -12 * DEG2RAD, minimumMoonSeparation: 15 * DEG2RAD, minimumContinuousMs: 1_200_000 },
	planetary: { mode: 'planetary', minimumAltitude: 25 * DEG2RAD, maximumSunAltitude: -6 * DEG2RAD, minimumContinuousMs: 900_000 },
}

// Observing site of an analysis: its place (degrees and meters), name, and the IANA zone that names its civil dates.
export interface PlanningSite extends SkyObserver {
	// Name shown for the site.
	readonly name: string
	// IANA time zone of the site's civil time.
	readonly timeZone: string
}

// Request of one target's analysis.
export interface TargetAnalysisRequest {
	// Target to analyze.
	readonly target: ObservingTargetRef
	// Site of the night.
	readonly site: PlanningSite
	// Civil date of the evening in the site's zone, YYYY-MM-DD.
	readonly eveningDate: string
	// Constraints the target must satisfy.
	readonly constraints: ObservingConstraints
	// Continuous time the observation needs, in milliseconds; absent asks only for the constraints' minimum.
	readonly requestedDurationMs?: number
}

// Whether a target can be observed over a night: in a window long enough for the requested duration, only in shorter
// windows, never, unknown because the catalog or SBDB has no such object, or unknown because no ephemeris source could
// give the minor body's trajectory over the whole night (which says nothing about its visibility).
export type ObservingStatus = 'observable' | 'limitedDuration' | 'notObservable' | 'unresolved' | 'ephemerisUnavailable'

// Why a target is not, or only partly, observable, or why its trajectory is unavailable, decisive first.
export type ObservingReasonCode =
	// The catalog or SBDB has no object with the id.
	| 'unresolvedTarget'
	// No usable orbital elements of the minor body are known (none published, or a model the local propagator lacks).
	| 'orbitalSolutionUnavailable'
	// The spkOnly policy allows only the SPK kernels, and they do not cover the body, the Earth, or a center all night.
	| 'kernelCoverageUnavailable'
	// The offline policy forbids asking JPL, and no kernel or saved orbital elements cover the body.
	| 'ephemerisOffline'
	// SBDB and Horizons could not be reached or did not answer, and no kernel or orbital elements cover the body.
	| 'ephemerisSourceUnavailable'
	// The body moves too fast for the trajectory to be interpolated or searched within the computation budget.
	| 'trajectoryResolutionExceeded'
	// The meteor shower is not active that night.
	| 'meteorShowerInactive'
	// The meteor shower has no known radiant.
	| 'radiantUnknown'
	// The Sun limit asks for an astronomical night the site does not have that night.
	| 'noAstronomicalDarkness'
	// The Sun never goes below its limit.
	| 'sunTooHigh'
	// The target never reaches the minimum altitude.
	| 'belowMinimumAltitude'
	// The target reaches the minimum altitude but never the maximum airmass.
	| 'airmassTooHigh'
	// The target is high enough only while the Sun is above its limit.
	| 'notDuringDarkness'
	// A lit Moon above the horizon is too close whenever the target is otherwise observable.
	| 'moonTooClose'
	// Every window is shorter than the minimum continuous duration.
	| 'windowTooShort'
	// Every window is shorter than the requested duration.
	| 'shorterThanRequested'

// Continuous stretch in which every constraint holds and that lasts at least the minimum continuous duration.
export interface ObservingWindow {
	// First instant.
	readonly start: number
	// Last instant.
	readonly end: number
	// Length, in milliseconds.
	readonly durationMs: number
	// Highest score inside the window, 0..100; absent for a meteor shower, which has no score.
	readonly bestScore?: number
	// Instant of that score; for a meteor shower, of the highest radiant.
	readonly bestAt: number
}

// Display sample of a target, the Sun, and the Moon at one instant. Samples draw the chart; crossings come from the
// windows, never from the samples.
export interface ObservingSample {
	// Instant.
	readonly time: number
	// Geometric altitude of the target.
	readonly altitude: number
	// Azimuth of the target, from north through east, [0, 2π).
	readonly azimuth: number
	// Kasten–Young airmass of the target; absent when it is not above the horizon.
	readonly airmass?: number
	// Geometric altitude of the Sun's center.
	readonly sunAltitude: number
	// Geometric topocentric altitude of the Moon's center.
	readonly moonAltitude: number
	// Topocentric target–Moon separation.
	readonly moonSeparation: number
	// Score at the instant, 0..100; absent outside every window.
	readonly score?: number
	// Geometric distance from the observer to a minor body, in AU; absent for other targets.
	readonly distance?: number
	// Estimated visual magnitude of a minor body from its published photometry (H and G, or M1 and K1); absent when it
	// has none or for other targets. An estimate, unreliable for comets.
	readonly magnitude?: number
}

// Provider of the trajectory of a minor body over a night.
export type PlannerEphemerisSource = 'spk' | 'horizons' | 'kepler'

// Where the trajectory of a minor body came from, and how far it can be trusted. One source covers the whole night.
export interface PlannerEphemerisProvenance {
	// Provider: the SPK kernels of the SPICE Kernel Library, a geometric vector table of JPL Horizons, or a two-body
	// Kepler propagation of osculating elements.
	readonly source: PlannerEphemerisSource
	// Whether the source is an approximation (the Kepler model ignores planetary perturbations).
	readonly approximate: boolean
	// Why the Kepler model was used although the policy allows JPL: Horizons timed out or could not be reached; offline
	// when the policy forbids JPL.
	readonly fallbackReason?: 'timeout' | 'network' | 'offline'
	// Generation of the kernel set and the kernels used, for the SPK source.
	readonly kernels?: { readonly generation: number; readonly kernelIds: readonly string[] }
	// Epoch of the osculating elements, Julian date (TDB), for the Kepler source.
	readonly orbitEpoch?: number
	// Date SBDB computed the orbit solution, as published (such as "2021-04-13 11:15:57"), for the Kepler source.
	readonly solutionDate?: string
	// When the elements were read from SBDB, Unix milliseconds, for the Kepler source.
	readonly elementsFetchedAt?: number
	// Spacing of the trajectory nodes, interpolated linearly in between, in milliseconds.
	readonly nodeSpacingMs: number
	// Root-finder step of the visibility search, in milliseconds: shorter than the default for a fast body.
	readonly searchStepMs: number
}

// Best score of a target over a night and the factors behind it.
export interface ObservingScore {
	// Score, 0..100: the geometric mean of the factors.
	readonly value: number
	// Instant of the score.
	readonly at: number
	// Factors, each 0..1. Twilight and Moon are absent in planetary mode; duration compares the window with the request.
	readonly factors: ObservationScoreFactors
	// Version of the score model.
	readonly modelVersion: number
}

// Summary of a target over the night.
export interface ObservingSummary {
	// Instant of the target's highest altitude over the night (its culmination); absent when it is still rising or
	// setting at both ends of the night.
	readonly culminationAt?: number
	// Geometric altitude at the culmination.
	readonly culminationAltitude?: number
	// Total length of the windows, in milliseconds.
	readonly totalUsableMs: number
	// Length of the longest window, in milliseconds.
	readonly longestWindowMs: number
}

// Analysis of one target over one night.
export interface TargetAnalysis {
	// Target analyzed.
	readonly target: ObservingTargetRef
	// Name of the target.
	readonly name: string
	// Object type, such as "Galaxy" or "Planet"; absent for coordinates and unresolved targets.
	readonly typeName?: string
	// ICRS right ascension of the target's direction at the middle of the night, in radians; absent when unresolved.
	readonly rightAscension?: number
	// ICRS declination of the target's direction at the middle of the night, in radians; absent when unresolved.
	readonly declination?: number
	// The night, with its Sun and Moon.
	readonly night: AstroWeatherNight
	// Constraints applied.
	readonly constraints: ObservingConstraints
	// Continuous time requested, in milliseconds; absent when none was.
	readonly requestedDurationMs?: number
	// Whether the target is observable.
	readonly status: ObservingStatus
	// Why it is not, or only partly, decisive first; empty when observable.
	readonly reasons: readonly ObservingReasonCode[]
	// Windows, chronological.
	readonly windows: readonly ObservingWindow[]
	// Summary over the night.
	readonly summary: ObservingSummary
	// Display samples over the displayed part of the night; empty when unresolved.
	readonly samples: readonly ObservingSample[]
	// Best score; absent without a window.
	readonly score?: ObservingScore
	// Source of a minor body's trajectory; absent for other targets and when no source was found.
	readonly ephemeris?: PlannerEphemerisProvenance
	// Highest topocentric angular rate of a minor body against the stars over the night, in radians per minute; absent
	// for other targets.
	readonly motion?: number
	// What a meteor shower's windows were judged against; absent for other targets.
	readonly meteorShower?: PlannerMeteorShowerDetails
}

// The basis of a meteor shower analysis: the support of its windows, and how long its id lasts.
export interface PlannerMeteorShowerDetails {
	// Support the windows were judged against: the IMO visual period, the IAU support, or none (geometry only).
	readonly support: 'imoVisual' | 'iauScientific' | 'none'
	// Whether the shower id comes from an IAU number (iau) or names a record of this edition of the catalog (snapshot).
	readonly identity: 'iau' | 'snapshot'
}

// Returns the night of a site whose evening falls on a civil date of the site's zone, through the Astro Weather nights:
// the last instant of the date belongs to the night that starts at the Sun's transit of that date.
export function resolveNight(nights: (request: AstroWeatherNightRequest) => AstroWeatherNight, site: PlanningSite, eveningDate: string) {
	const day = zonedDate(eveningDate, site.timeZone)
	const night = nights({ observer: site, timeZone: site.timeZone, time: day.end - 1 })
	if (night.sun.localDate !== eveningDate) throw new Error(`the night of ${day.end - 1} is named ${night.sun.localDate}, not ${eveningDate}`)
	return night
}

// Earth orientation of a span around `middle`: the precession-nutation matrix of its middle, held fixed, and the apparent
// sidereal time of its middle advanced at the sidereal rate. Over half a day the matrix drifts by under 0.1″ and the
// sidereal time by under a millisecond, over a week by under 2″ and 0.02 s, while the full IAU 2006/2000A evaluation
// costs a few hundred microseconds per instant; every instant shifted from one carrying these providers inherits them.
export function fixedOrientationProviders(middle: Time): TimeProviders {
	const matrix = precessionNutationMatrix(middle)
	const reference = ut1(middle)
	const sidereal = greenwichApparentSiderealTime(middle)
	return { pnm: () => matrix, gast: (u) => sidereal + SIDEREAL_RATE * (u.day - reference.day + (u.fraction - reference.fraction)) }
}

// Turns of the Earth per UT1 day, in radians per day.
const SIDEREAL_RATE = TAU * 1.00273781191135448

// A toolkit instant of a Unix time in milliseconds carrying the fixed orientation of a span (fixedOrientationProviders).
export function fixedOrientationTime(middle: number): Time {
	const time = timeUnix(middle / 1000, true)
	Object.defineProperty(time, 'providers', { value: fixedOrientationProviders(time), enumerable: false, writable: true })
	return time
}

// The geocentric ICRS position of a site, memoized for the last instant, so the providers of several bodies evaluated at
// the same epoch remove the same offset once.
export class SiteOffset {
	// Instant and offset of the last site offset computed.
	#at = Number.NaN
	#offset: Vec3 = [0, 0, 0]

	// `location` is the toolkit location of the site.
	constructor(readonly location: GeographicPosition) {}

	// Geocentric ICRS position of the site at an instant, in AU.
	at(time: Time) {
		const at = time.day + time.fraction

		if (at !== this.#at) {
			const offset = frameToFrame(itrs(this.location), ITRS, ICRS, time)
			this.#offset = [offset[0], offset[1], offset[2]]
			this.#at = at
		}

		return this.#offset
	}

	// Provider of the topocentric direction of a geocentric ICRS vector over Unix milliseconds (AU), removing the site
	// offset at each instant; each call returns a new vector.
	topocentric(geocentric: (time: number) => Vec3): PositionOverTime {
		return (time) => {
			const center = geocentric(timeToUnixMillis(time))
			const site = this.at(time)
			return [center[0] - site[0], center[1] - site[1], center[2] - site[2]]
		}
	}
}

// One night of a site with the Sun and Moon directions every analysis of it shares: their geocentric vectors are
// evaluated hourly and interpolated, and the observer's offset is removed, so the directions are topocentric. Every
// instant of the night carries the night's Earth orientation (fixedOrientationProviders).
export class PlanningNight {
	// Toolkit location of the site.
	readonly location: GeographicPosition
	// First instant of the night (the Sun's upper transit of the evening date).
	readonly start: Time
	// Last instant of the night (the next upper transit).
	readonly end: Time
	// Topocentric ICRS direction of the Sun, in AU.
	readonly sunAt: PositionOverTime
	// Topocentric ICRS direction of the Moon, in AU.
	readonly moonAt: PositionOverTime
	// Topocentric direction of a body, by code, created on first use.
	readonly #bodies = new Map<PlanningBodyCode, PositionOverTime>()
	// Stretches with the Sun below an altitude, by altitude.
	readonly #sunWindows = new Map<number, readonly TimeSpan[]>()
	// Middle of the night, which carries the night's Earth orientation.
	readonly #middle: Time
	// The site offset shared by the providers evaluated at the same epoch.
	readonly #site: SiteOffset

	// Toolkit instant of a Unix time in milliseconds, with the night's Earth orientation.
	time(time: number) {
		const middle = this.#middle
		return timeShift(middle, (time - timeToUnixMillis(middle)) / 86_400_000)
	}

	// Prepares the night of a site from its Astro Weather night.
	constructor(
		readonly site: PlanningSite,
		readonly night: AstroWeatherNight,
	) {
		this.location = geographic(site)
		this.#site = new SiteOffset(this.location)
		this.#middle = fixedOrientationTime((night.sun.start + night.sun.end) / 2)
		this.start = this.time(night.sun.start)
		this.end = this.time(night.sun.end)
		this.sunAt = this.topocentric(geocentricInterpolation(bodyModel('10')))
		this.moonAt = this.topocentric(geocentricInterpolation(bodyModel('301')))
	}

	// Key of the night among the nights of other sites and evenings: the site's place and zone, and the evening date.
	get key() {
		return `${this.site.latitude}|${this.site.longitude}|${this.site.elevation}|${this.site.timeZone}|${this.night.sun.localDate}`
	}

	// Stretches of the night with the Sun's center at or below a geometric altitude (radians), the planning scope of a
	// plan; cached by altitude.
	sunWindows(maximumSunAltitude: number): readonly TimeSpan[] {
		let windows = this.#sunWindows.get(maximumSunAltitude)

		if (!windows) {
			const found = visibilityWindows(this.sunAt, this.location, this.start, this.end, { maximumSunAltitude }, { sunAt: this.sunAt, step: SEARCH_STEP_DAYS })
			windows = found.map((e) => ({ start: timeToUnixMillis(e.start), end: timeToUnixMillis(e.end) }))
			this.#sunWindows.set(maximumSunAltitude, windows)
		}

		return windows
	}

	// Topocentric direction of a planning body.
	bodyAt(code: PlanningBodyCode): PositionOverTime {
		let provider = this.#bodies.get(code)

		if (!provider) {
			provider = code === '301' ? this.moonAt : this.topocentric(geocentricInterpolation(bodyModel(code)))
			this.#bodies.set(code, provider)
		}

		return provider
	}

	// Provider of the topocentric direction of a geocentric ICRS vector over Unix milliseconds (AU), removing the
	// observer's offset at each instant; each call returns a new vector.
	topocentric(geocentric: (time: number) => Vec3): PositionOverTime {
		return this.#site.topocentric(geocentric)
	}
}

// Target ready to analyze: its identity, name, type, and direction over time.
export interface ResolvedTarget {
	// Identity.
	readonly ref: ObservingTargetRef
	// Name.
	readonly name: string
	// Object type; absent for coordinates.
	readonly typeName?: string
	// ICRS direction over time.
	readonly directionAt: PositionOverTime
	// Root-finder step of the visibility search, in days; SEARCH_STEP_DAYS when absent.
	readonly step?: number
	// Estimated visual magnitude of a minor body at an instant from the Sun-to-body and observer-to-body vectors (AU);
	// undefined without photometry. Absent for other targets.
	readonly magnitude?: (sunToBody: Vec3, observerToBody: Vec3) => number | undefined
	// Source of a minor body's trajectory.
	readonly ephemeris?: PlannerEphemerisProvenance
	// Highest topocentric angular rate of a minor body, in radians per minute.
	readonly motion?: number
}

// J2000.0 as Unix milliseconds, ignoring the TT−UTC offset, which is negligible for proper motion.
const J2000_UNIX_MS = (J2000 - 2440587.5) * 86_400_000

// Direction of a fixed J2000 place moved by its proper motion (radians per Julian year) to an instant (Unix
// milliseconds); constant over a night, whose proper motion is negligible.
export function fixedDirection(rightAscension: number, declination: number, pmRA: number, pmDEC: number, middle: number): PositionOverTime {
	const years = (middle - J2000_UNIX_MS) / 86_400_000 / DAYS_PER_JULIAN_YEAR
	const direction = eraS2c(rightAscension + pmRA * years, declination + pmDEC * years)
	return () => direction
}

// Resolves a target the planner computes locally for a night; undefined when the catalog has no such object. A minor body
// is prepared asynchronously instead (MinorBodyTrajectories).
export function resolveTarget(catalog: Database, night: PlanningNight, ref: Exclude<ObservingTargetRef, { kind: 'minorBody' | 'meteorShower' }>): ResolvedTarget | undefined {
	const middle = (night.night.sun.start + night.night.sun.end) / 2

	if (ref.kind === 'catalog') {
		const object = catalogObject(catalog, ref.id)
		if (!object) return undefined
		return { ref, name: object.name, typeName: object.typeName, directionAt: fixedDirection(object.rightAscension, object.declination, object.pmRA, object.pmDEC, middle) }
	}

	if (ref.kind === 'body') {
		const body = solarSystemBody(ref.code)!
		return { ref, name: body.name, typeName: body.typeName, directionAt: night.bodyAt(ref.code) }
	}

	return { ref, name: ref.name, directionAt: fixedDirection(ref.rightAscension, ref.declination, 0, 0, middle) }
}

// Name of a target that could not be resolved.
function unresolvedName(ref: ObservingTargetRef) {
	if (ref.kind === 'catalog') return `Catalog object ${ref.id}`
	if (ref.kind === 'body') return solarSystemBody(ref.code)?.name ?? ref.code
	if (ref.kind === 'minorBody') return ref.designation
	if (ref.kind === 'meteorShower') return ref.id
	return ref.name
}

// Instants of the display samples: every SAMPLE_INTERVAL_MS over the displayed part of the night, both ends included.
function sampleTimes({ start, end }: AstroWeatherNight['display']) {
	const first = Math.ceil(start / SAMPLE_INTERVAL_MS) * SAMPLE_INTERVAL_MS
	const times = [start]
	for (let time = first; time < end; time += SAMPLE_INTERVAL_MS) if (time > start) times.push(time)
	times.push(end)
	return times
}

// Geometry of a target, the Sun, and the Moon at one instant.
interface InstantGeometry {
	readonly altitude: number
	readonly azimuth: number
	readonly sunAltitude: number
	readonly moonAltitude: number
	readonly moonSeparation: number
	readonly moonIllumination: number
	// Distance from the observer in AU and estimated magnitude, for a minor body.
	readonly distance?: number
	readonly magnitude?: number
}

// Computes the geometry of a target, the Sun, and the Moon at an instant.
function geometryAt(night: PlanningNight, target: ResolvedTarget, time: number): InstantGeometry {
	const t = night.time(time)
	const direction = target.directionAt(t)
	const [ra2000, dec2000] = equatorial(direction)
	const [rightAscension, declination] = equatorialFromJ2000(ra2000, dec2000, t)
	const [azimuth, altitude] = equatorialToHorizontal(rightAscension, declination, night.location.latitude, localSiderealTime(t, night.location, false))
	const sun = night.sunAt(t)
	const moon = night.moonAt(t)
	const geometry = { altitude, azimuth, sunAltitude: altitudeOf(sun, t, night.location), moonAltitude: altitudeOf(moon, t, night.location), moonSeparation: vecAngle(direction, moon), moonIllumination: meteorMoonIllumination(sun, moon) }
	if (target.ref.kind !== 'minorBody') return geometry
	// Both vectors are topocentric, so their difference is the Sun-to-body vector.
	const magnitude = target.magnitude?.([direction[0] - sun[0], direction[1] - sun[1], direction[2] - sun[2]], direction)
	return { ...geometry, distance: vecLength(direction), magnitude: magnitude !== undefined && Number.isFinite(magnitude) ? magnitude : undefined }
}

// Score inputs of an instant inside a window of a given length.
function scoreInput(geometry: InstantGeometry, constraints: ObservingConstraints, windowMs: number, requiredMs: number) {
	const sky = constraints.mode !== 'planetary'
	return {
		altitude: geometry.altitude,
		sunAltitude: sky ? geometry.sunAltitude : undefined,
		moonInterference: sky ? moonInterference(geometry.moonIllumination, geometry.moonAltitude, geometry.moonSeparation) : undefined,
		availableDurationHours: windowMs / HOUR_MS,
		requiredDurationHours: requiredMs / HOUR_MS,
	}
}

// Score ramps of a set of constraints: the altitude factor rises from the minimum altitude, and the airmass factor falls
// to zero at the airmass limit (or airmass 3 without one).
function scoreOptions(constraints: ObservingConstraints) {
	return { minimumAltitude: constraints.minimumAltitude, maximumAirmass: constraints.maximumAirmass ?? SCORE_MAXIMUM_AIRMASS, scale: 100 } as const
}

// Visibility constraints of the toolkit for a set of planner constraints.
function visibilityConstraints(constraints: ObservingConstraints): VisibilityConstraints {
	return {
		minimumAltitude: constraints.minimumAltitude,
		maximumAirmass: constraints.maximumAirmass,
		maximumSunAltitude: constraints.maximumSunAltitude,
		minimumMoonSeparation: constraints.minimumMoonSeparation,
		moonSeparationHorizon: constraints.minimumMoonSeparation === undefined ? undefined : 0,
	}
}

// Finds why a target has no window long enough, adding one constraint at a time; the first that leaves nothing decides.
// `all` are the stretches of the full constraint set.
function diagnose(night: PlanningNight, target: ResolvedTarget, constraints: ObservingConstraints, all: readonly { readonly start: number; readonly end: number }[]): ObservingReasonCode[] {
	const sources = { sunAt: night.sunAt, moonAt: night.moonAt, step: target.step ?? SEARCH_STEP_DAYS }
	const search = (limits: VisibilityConstraints) => visibilityWindows(target.directionAt, night.location, night.start, night.end, limits, sources)
	const { minimumAltitude, maximumAirmass, maximumSunAltitude } = constraints

	if (search({ maximumSunAltitude }).length === 0) return [maximumSunAltitude <= ASTRONOMICAL_TWILIGHT && night.night.sun.darkness.length === 0 ? 'noAstronomicalDarkness' : 'sunTooHigh']
	if (search({ minimumAltitude }).length === 0) return ['belowMinimumAltitude']
	if (maximumAirmass !== undefined && search({ minimumAltitude, maximumAirmass }).length === 0) return ['airmassTooHigh']

	const dark = search({ minimumAltitude, maximumAirmass, maximumSunAltitude }).map((e) => timeToUnixMillis(e.end) - timeToUnixMillis(e.start))
	if (dark.length === 0) return ['notDuringDarkness']
	if (all.length === 0) return ['moonTooClose']
	if (dark.every((e) => e < constraints.minimumContinuousMs)) return ['windowTooShort']
	return ['moonTooClose', 'windowTooShort']
}

// Analyzes a resolved target over a night: its windows under the constraints, its culmination, its display samples, the
// reasons it is not (fully) observable, and its best score. Pure and synchronous; a long night of a slow body costs a
// few tens of milliseconds.
export function analyzeTarget(night: PlanningNight, target: ResolvedTarget, constraints: ObservingConstraints, requestedDurationMs?: number): TargetAnalysis {
	const step = target.step ?? SEARCH_STEP_DAYS
	const sources = { sunAt: night.sunAt, moonAt: night.moonAt, step }
	const all = visibilityWindows(target.directionAt, night.location, night.start, night.end, visibilityConstraints(constraints), sources).map((e) => ({ start: timeToUnixMillis(e.start), end: timeToUnixMillis(e.end) }))
	const stretches = all.filter((e) => e.end - e.start >= constraints.minimumContinuousMs)
	const required = requestedDurationMs ?? constraints.minimumContinuousMs
	const options = scoreOptions(constraints)
	const samples: ObservingSample[] = []
	const windows: ObservingWindow[] = []
	let score: ObservingScore | undefined

	// Each window is scored at the samples inside it and at its own middle, so a short window is never left unscored.
	const geometries = sampleTimes(night.night.display).map((time) => [time, geometryAt(night, target, time)] as const)

	for (const stretch of stretches) {
		const durationMs = stretch.end - stretch.start
		const candidates = [...geometries.filter(([time]) => time >= stretch.start && time <= stretch.end), [(stretch.start + stretch.end) / 2, geometryAt(night, target, (stretch.start + stretch.end) / 2)] as const]
		let bestScore = -1
		let bestAt = stretch.start
		let bestGeometry = candidates[0][1]

		for (const [time, geometry] of candidates) {
			const value = observationScore(scoreInput(geometry, constraints, durationMs, required), options)

			if (value > bestScore) {
				bestScore = value
				bestAt = time
				bestGeometry = geometry
			}
		}

		windows.push({ start: stretch.start, end: stretch.end, durationMs, bestScore, bestAt })

		if (!score || bestScore > score.value) {
			score = { value: bestScore, at: bestAt, factors: observationScoreFactors(scoreInput(bestGeometry, constraints, durationMs, required), options), modelVersion: OBSERVING_SCORE_MODEL_VERSION }
		}
	}

	for (const [time, geometry] of geometries) {
		const window = windows.find((e) => time >= e.start && time <= e.end)
		const airmass = geometry.altitude > 0 ? airmassKastenYoung(geometry.altitude) : undefined
		const value = window ? observationScore(scoreInput(geometry, constraints, window.durationMs, required), options) : undefined
		samples.push({ time, altitude: geometry.altitude, azimuth: geometry.azimuth, airmass, sunAltitude: geometry.sunAltitude, moonAltitude: geometry.moonAltitude, moonSeparation: geometry.moonSeparation, score: value, distance: geometry.distance, magnitude: geometry.magnitude })
	}

	let culminationAt: number | undefined
	let culminationAltitude: number | undefined

	for (const extremum of searchExtrema((time) => altitudeOf(target.directionAt(time), time, night.location), night.start, night.end, { step })) {
		if (extremum.kind === 'maximum' && (culminationAltitude === undefined || extremum.value > culminationAltitude)) {
			culminationAt = timeToUnixMillis(extremum.time)
			culminationAltitude = extremum.value
		}
	}

	let longestWindowMs = 0
	let totalUsableMs = 0

	for (const { durationMs } of windows) {
		longestWindowMs = Math.max(longestWindowMs, durationMs)
		totalUsableMs += durationMs
	}

	const status: ObservingStatus = windows.length === 0 ? 'notObservable' : longestWindowMs < required ? 'limitedDuration' : 'observable'
	const reasons: ObservingReasonCode[] = status === 'notObservable' ? diagnose(night, target, constraints, all) : status === 'limitedDuration' ? ['shorterThanRequested'] : []
	const [rightAscension, declination] = equatorial(target.directionAt(night.time((night.night.sun.start + night.night.sun.end) / 2)))

	return {
		target: target.ref,
		name: target.name,
		typeName: target.typeName,
		rightAscension,
		declination,
		night: night.night,
		constraints,
		requestedDurationMs,
		status,
		reasons,
		windows,
		summary: { culminationAt, culminationAltitude, totalUsableMs, longestWindowMs },
		samples,
		score,
		ephemeris: target.ephemeris,
		motion: target.motion,
	}
}

// Analysis of a target the catalog or SBDB does not know: no window, no sample, and the reason.
export function unresolvedAnalysis(night: PlanningNight, ref: ObservingTargetRef, constraints: ObservingConstraints, requestedDurationMs?: number): TargetAnalysis {
	return {
		target: ref,
		name: unresolvedName(ref),
		night: night.night,
		constraints,
		requestedDurationMs,
		status: 'unresolved',
		reasons: ['unresolvedTarget'],
		windows: [],
		summary: { totalUsableMs: 0, longestWindowMs: 0 },
		samples: [],
	}
}

// Analysis of a known minor body whose trajectory no source could give over the night: no window and no sample, the
// reason, and its name and type when known. It never claims the body is not observable.
export function ephemerisUnavailableAnalysis(night: PlanningNight, ref: ObservingTargetRef, reason: ObservingReasonCode, constraints: ObservingConstraints, requestedDurationMs?: number, name?: string, typeName?: string): TargetAnalysis {
	return { ...unresolvedAnalysis(night, ref, constraints, requestedDurationMs), ...(name !== undefined && { name }), typeName, status: 'ephemerisUnavailable', reasons: [reason] }
}
