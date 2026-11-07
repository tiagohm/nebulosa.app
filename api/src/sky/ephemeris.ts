import { observer as horizonsObserver, type ObserverWithOsculatingElements, Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import { planetMagnitude } from 'nebulosa/src/astronomy/bodies/photometry'
import { cirsToObserved, icrsToCirs, lightTime, refractedAltitude, type PositionAndVelocity, type PositionAndVelocityOverTime, phaseAngle, topocentricDirection } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { constellation as constellationOf, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import { eraC2s, eraEo06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { frameToFrame, ICRS, ITRS } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import type { SpkMiss } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import * as elpmpp02 from 'nebulosa/src/astronomy/ephemeris/models/analytical/elpmpp02'
import { pluto } from 'nebulosa/src/astronomy/ephemeris/models/analytical/pluto'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { asteroidMagnitudeEstimate, cometMagnitudeEstimate } from 'nebulosa/src/astronomy/formulas'
import type { GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { asteroid, comet, type KeplerOrbit } from 'nebulosa/src/astronomy/orbits/asteroid'
import { type Time, Timescale, time as makeJulianTime, timeShift, timeUnix, toJulianEpoch, tt } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, DEG2RAD, GM_SUN_PITJEVA_2005, J2000, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import { type MutVec3, type Vec3, vecAngle, vecLength, vecPlus } from 'nebulosa/src/math/linear-algebra/vec3'
import { deg, normalizeAngle, normalizePI, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { LruCache } from '../lrucache'
import type { SpiceKernelSnapshot } from '../spicekernels.runtime'
import { SsdBusyError, SsdRequestQueue, SsdThrottledError } from '../ssd'
import { solarSystemBody, type SolarSystemBodyKind } from './bodies'
import type { SolarSystemBodyCode } from './types'

// Ephemerides of the sky API: the apparent position of a catalog object, a major solar-system body, or
// a minor body at an instant, for an observer on the Earth or the geocenter, plus its rise, transit,
// and set. Accurate positions of solar-system targets come first from the SPK kernels of the SPICE Kernel
// Library when the whole chain of the target, the Earth, and the Sun is covered at every epoch the
// calculation needs; otherwise, by the ephemeris policy of the library, from JPL Horizons (automatic),
// falling back to the local models (VSOP87E, ELPMPP02, Pluto, Kepler orbits, and catalog astrometry) when
// Horizons times out or is unreachable, from the local models without any request (offline), or from
// nothing (spkOnly). A calculation never mixes kernel states with the local models. The source and the
// reason are stated in the result. Fast positions, used to draw the map, are local whenever a local model
// exists. Events are always computed locally, from kernels or local models, so they never wait on the network. Horizons requests go
// through the JPL queue, so an accurate position may wait behind another JPL request, within the limit
// of the queue. Angles are radians, times Unix milliseconds (UTC), and distances AU.

// Budget of one Horizons request in milliseconds.
export const HORIZONS_TIMEOUT_MS = 8_000

// Consecutive transient Horizons failures that open the circuit breaker.
export const HORIZONS_BREAKER_FAILURE_THRESHOLD = 3

// How long the circuit breaker skips Horizons once open, in milliseconds.
export const HORIZONS_BREAKER_OPEN_MS = 30_000

// Horizons tables kept in memory.
const HORIZONS_CACHE_LIMIT = 64

// Event windows kept in memory.
const EVENTS_CACHE_LIMIT = 256

// Spacing of Horizons table rows and of local event samples, in milliseconds (10 minutes).
const SAMPLE_STEP_MS = 600_000

// One hour in milliseconds.
const HOUR_MS = 3_600_000

// Half-width of the window around the instant in which rise, transit, and set are searched, in
// milliseconds: the events nearest the instant within ±12 h.
const EVENT_HALF_WINDOW_MS = 12 * HOUR_MS

// Light-time iterations of the local solar-system reduction; two converge to well under a millisecond.
const LIGHT_TIME_ITERATIONS = 2

// Apparent visual magnitude of the Sun.
const SUN_MAGNITUDE = -26.74

// Airless altitude of a point at the horizon: standard refraction lifts it by 34′, the value of the almanacs. The ERFA
// model cannot give it, since it caps refraction at about 11′ near the horizon.
const HORIZON_ALTITUDE = deg(-34 / 60)

// Airless altitude of the center at rise and set of the bodies with a disk: the upper limb at the horizon, with the
// semi-diameter of the Sun (16′, as in sun.ts) and the mean one of the Moon (15.5′).
const RISE_SET_ALTITUDE: Readonly<Partial<Record<SolarSystemBodyKind, number>>> = { sun: deg(-50 / 60), moon: deg(-49.5 / 60) }

// Airless altitude from which the ERFA refraction model is used, in radians (5°): below it the model is capped, and
// refraction grows too fast for the formula, so the one of Sæmundsson (1986) is used.
const ERFA_REFRACTION_LIMIT = deg(5)

// Airless altitudes, in degrees, between which refraction fades out below the horizon, where the object is not seen
// and the formula diverges.
const REFRACTION_FADE_FROM = -1
const REFRACTION_FADE_TO = -2

// Horizons quantities requested, airless so that apparent RA/Dec match the local reduction (Horizons
// refracts RA/Dec too otherwise; the elevation is refracted afterwards with the ERFA model the local
// path uses): astrometric and apparent RA/Dec, apparent azimuth and elevation,
// visual magnitude, illuminated fraction, light-time, solar elongation, and constellation. Horizons
// writes them in quantity-number order, which parseHorizonsRow relies on.
const HORIZONS_QUANTITIES = [Quantity.ASTROMETRIC_RA_DEC, Quantity.APPARENT_RA_DEC, Quantity.APPARENT_AZ_EL, Quantity.VISUAL_MAG_SURFACE_BRGHT, Quantity.ILLUMINATED_FRACTION, Quantity.ONE_WAY_DOWN_LEG_LIGHT_TIME, Quantity.SUN_OBSERVER_TARGET_ELONG_ANGLE, Quantity.CONSTELLATION_ID] as const

// AU travelled by light in one minute.
const AU_PER_LIGHT_MINUTE = (SPEED_OF_LIGHT * 0.06) / AU_KM

// Observer on the Earth. Degrees and meters, like the profile that stores it.
export interface SkyObserver {
	// Geodetic latitude in degrees, north positive, [-90, 90].
	readonly latitude: number
	// Geodetic longitude in degrees, east positive, [-180, 180].
	readonly longitude: number
	// Height above the ellipsoid in meters.
	readonly elevation: number
}

// J2000 astrometric data of a catalog object.
export interface CatalogAstrometry {
	// Right ascension at J2000 in radians.
	readonly rightAscension: number
	// Declination at J2000 in radians.
	readonly declination: number
	// Proper motion dα/dt in radians per Julian year.
	readonly pmRA: number
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC: number
	// Visual magnitude, when known.
	readonly magnitude?: number
}

// Heliocentric osculating elements of a minor body (J2000 ecliptic), with its photometry.
export type MinorBodyElements = ObserverWithOsculatingElements

// What a position is computed for.
export type EphemerisTarget =
	// Star or deep-sky object of the catalog.
	| { readonly type: 'catalog'; readonly object: CatalogAstrometry }
	// Sun, Moon, planet, or Pluto.
	| { readonly type: 'body'; readonly code: SolarSystemBodyCode }
	// Asteroid or comet by SPK-ID, with its osculating elements when known (the local model needs them).
	| { readonly type: 'minorBody'; readonly spkId: string; readonly elements?: MinorBodyElements }

// Calculation path: `accurate` asks Horizons first; `fast` is local only.
export type EphemerisMode = 'fast' | 'accurate'

// Provider of a position: JPL Horizons, the local models, or the SPK kernels of the SPICE Kernel Library.
export type EphemerisSource = 'horizons' | 'local' | 'spk'

// Why an accurate position came from the local models: Horizons timed out, could not be reached, or is paused by its
// breaker, or the offline policy of the SPICE Kernel Library forbids requests and no kernel covers the target.
export type EphemerisFallbackReason = 'timeout' | 'network' | 'breakerOpen' | 'offline'

// Kernels a position was computed from.
export interface SkyPositionKernels {
	// Generation of the kernel set of the SPICE Kernel Library.
	readonly generation: number
	// Ids of the kernels whose segments were used, in the order the calculation first needed them.
	readonly kernelIds: readonly string[]
}

// Why the policy of the SPICE Kernel Library left no source for an accurate position: no kernel covers the target at the
// epochs needed, a kernel the chain needs is missing (the Earth, the Sun, or a center), or the offline policy forbids
// requests and no local model exists.
export type EphemerisUnavailableCode = 'coverageUnavailable' | 'missingDependency' | 'offline'

// Apparent position of an object at an instant.
export interface SkyPosition {
	// Instant of the position, Unix milliseconds (UTC).
	readonly time: number
	// Provider of the position.
	readonly source: EphemerisSource
	// Why Horizons was not used, for an accurate position computed locally.
	readonly fallbackReason?: EphemerisFallbackReason
	// Kernels of a position computed from SPK.
	readonly kernels?: SkyPositionKernels
	// Whether the position is seen from the observer or from the Earth's center (no observer).
	readonly center: 'topocentric' | 'geocentric'
	// Apparent right ascension referred to the true equator and equinox of date, in radians.
	readonly rightAscension: number
	// Apparent declination of date in radians.
	readonly declination: number
	// Astrometric right ascension at J2000 (ICRS) in radians.
	readonly rightAscensionJ2000: number
	// Astrometric declination at J2000 (ICRS) in radians.
	readonly declinationJ2000: number
	// Azimuth from north through east in radians; absent without an observer.
	readonly azimuth?: number
	// Refracted altitude in radians; absent without an observer.
	readonly altitude?: number
	// Apparent visual magnitude; absent when unknown.
	readonly magnitude?: number
	// Distance from the observer in AU; absent for catalog objects.
	readonly distance?: number
	// Illuminated fraction of the disk, [0, 1]; absent for catalog objects.
	readonly illuminated?: number
	// Angular distance from the Sun in radians; absent for catalog objects.
	readonly elongation?: number
	// IAU abbreviation of the constellation of the apparent position, upper case, such as "ORI".
	readonly constellation: string
	// Name of that constellation, such as "Orion"; absent when the code is unknown.
	readonly constellationName?: string
}

// Rise, transit, and set nearest the instant, within ±12 h, for an observer: rise and set with the standard horizon
// (34′ of refraction, and the upper limb of the Sun and the Moon), and the transit on the meridian, which for the Moon
// can be minutes from its highest point. Times are Unix milliseconds (UTC); a missing time means the event does not
// happen in the window.
export interface SkyEvents {
	// Whether the object crosses the horizon, stays above it, or stays below it during the window.
	readonly state: 'normal' | 'circumpolar' | 'belowHorizon'
	// Rise time.
	readonly rise?: number
	// Time of the upper transit, the crossing of the meridian.
	readonly transit?: number
	// Refracted altitude at the upper transit in radians.
	readonly transitAltitude?: number
	// Set time.
	readonly set?: number
}

// Position request.
export interface PositionRequest {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Observer; the geocenter when absent.
	readonly observer?: SkyObserver
	// Calculation path; accurate by default.
	readonly mode?: EphemerisMode
	// Cancels the request.
	readonly signal?: AbortSignal
}

// Horizons observer-table client; tests pass a mock.
export type HorizonsObserver = typeof horizonsObserver

// Construction options of SkyEphemeris.
export interface SkyEphemerisOptions {
	// JPL queue; one of its own by default.
	readonly queue?: SsdRequestQueue
	// Horizons client; the nebulosa adapter by default.
	readonly observer?: HorizonsObserver
	// Horizons request budget in milliseconds; HORIZONS_TIMEOUT_MS by default.
	readonly timeoutMs?: number
	// Clock of the circuit breaker; Date.now by default.
	readonly now?: () => number
	// Kernels of the SPICE Kernel Library and its ephemeris policy; none and automatic by default.
	readonly kernels?: { readonly current: () => SpiceKernelSnapshot }
}

// Horizons answered without an ephemeris (unknown target or invalid request). Not retried locally:
// the request itself is wrong.
export class HorizonsEphemerisError extends Error {
	// Creates the error.
	constructor(message: string) {
		super(message)
		this.name = 'HorizonsEphemerisError'
	}
}

// Neither Horizons, the kernels, nor a local model can compute the position; code says why when the policy of the SPICE
// Kernel Library decided it.
export class EphemerisUnavailableError extends Error {
	// Creates the error with the reason no source could compute the position.
	constructor(
		message: string,
		options?: ErrorOptions,
		readonly code?: EphemerisUnavailableCode,
	) {
		super(message, options)
		this.name = 'EphemerisUnavailableError'
	}
}

// A kernel state a calculation needs is not covered; the whole calculation is abandoned, never completed with a local model.
class SpkCoverageMiss extends Error {
	// Creates the miss of a body of the chain of NAIF code target.
	constructor(
		readonly miss: SpkMiss,
		readonly target: number,
	) {
		super(`SPK does not cover ${miss.body} (${miss.reason})`)
	}

	// Code of the error when the policy allows no other source: a miss of the target itself is a lack of coverage, a miss of
	// another body (the Earth, the Sun, a center) a missing dependency.
	get code(): EphemerisUnavailableCode {
		return this.miss.body === this.target ? 'coverageUnavailable' : 'missingDependency'
	}
}

// NAIF code of the SPK state of a solar-system target: the body code itself, such as 399 for the Earth or 599 for the
// planet Jupiter (never its system barycenter 5), or the SBDB SPK-ID of a minor body.
function naifCode(target: Exclude<EphemerisTarget, { type: 'catalog' }>) {
	return Number(target.type === 'body' ? target.code : target.spkId)
}

// States of one calculation from a kernel set: the target, the Earth, and the Sun, each throwing SpkCoverageMiss when not
// covered at an epoch, and the kernels they used.
function spkCalculation(snapshot: SpiceKernelSnapshot, target: number) {
	const set = snapshot.set!
	const kernels = new Set<string>()

	const state =
		(body: number): PositionAndVelocityOverTime =>
		(t) => {
			const result = set.stateAt(body, t)
			if (!result.ok) throw new SpkCoverageMiss(result, target)
			for (const id of result.kernels) kernels.add(id)
			return result.state
		}

	return { target: state(target), foundation: { earth: state(399), sun: state(10) } satisfies EphemerisFoundation, kernels: () => ({ generation: snapshot.generation, kernelIds: [...kernels] }) }
}

// Whether the JPL queue refused the request, which says nothing about Horizons.
function isQueueRefusal(error: unknown) {
	return error instanceof SsdBusyError || error instanceof SsdThrottledError
}

// Returns why a Horizons failure is transient (and may fall back to a local model), or undefined for a
// semantic failure that must be reported as is.
function transientReason(error: unknown): EphemerisFallbackReason | undefined {
	if (error instanceof HorizonsEphemerisError) return undefined
	if (isQueueRefusal(error)) return 'timeout'
	if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) return 'timeout'
	if (error instanceof TypeError) return 'network'
	if (error instanceof Error && 'code' in error) return 'network'
	return undefined
}

// Consecutive-failure circuit breaker: after HORIZONS_BREAKER_FAILURE_THRESHOLD transient failures,
// Horizons is skipped for HORIZONS_BREAKER_OPEN_MS; a success closes it.
class HorizonsCircuitBreaker {
	#failures = 0
	#openUntil = 0

	// Creates the breaker over a clock in milliseconds.
	constructor(private readonly now: () => number) {}

	// Whether Horizons is skipped now; an expired window closes the breaker.
	isOpen() {
		if (this.#openUntil === 0) return false
		if (this.now() < this.#openUntil) return true
		this.#openUntil = 0
		this.#failures = 0
		return false
	}

	// Records a successful Horizons request.
	recordSuccess() {
		this.#failures = 0
		this.#openUntil = 0
	}

	// Records a transient Horizons failure.
	recordFailure() {
		if (++this.#failures >= HORIZONS_BREAKER_FAILURE_THRESHOLD && this.#openUntil === 0) {
			this.#openUntil = this.now() + HORIZONS_BREAKER_OPEN_MS
		}
	}
}

// One Horizons table row.
interface HorizonsSample {
	// Instant of the row, Unix milliseconds.
	readonly time: number
	// Astrometric J2000 right ascension and declination in radians.
	readonly j2000: readonly [number, number]
	// Apparent right ascension and declination of date in radians.
	readonly apparent: readonly [number, number]
	// Azimuth and refracted altitude in radians; undefined for the geocenter.
	readonly horizontal?: readonly [number, number]
	// Visual magnitude; undefined when Horizons has none.
	readonly magnitude?: number
	// Illuminated fraction, [0, 1].
	readonly illuminated?: number
	// Distance from the observer in AU.
	readonly distance: number
	// Solar elongation in radians.
	readonly elongation?: number
	// Constellation abbreviation, upper case.
	readonly constellation: string
}

// Returns the refracted altitude of an airless altitude, both in radians: the ERFA model of the observed places above
// ERFA_REFRACTION_LIMIT, and below it the formula of Sæmundsson for 1010 hPa and 10 °C, which reaches the 34′ of the
// horizon the rise and set times use. It fades out just below the horizon, so a body under it reads its true altitude.
export function apparentAltitude(altitude: number) {
	if (altitude >= ERFA_REFRACTION_LIMIT) return refractedAltitude(altitude)
	const degrees = toDeg(altitude)
	if (degrees <= REFRACTION_FADE_TO) return altitude
	const fade = degrees >= REFRACTION_FADE_FROM ? 1 : (degrees - REFRACTION_FADE_TO) / (REFRACTION_FADE_FROM - REFRACTION_FADE_TO)
	return altitude + deg((fade * 1.02) / Math.tan(deg(degrees + 10.3 / (degrees + 5.11))) / 60)
}

// Parses a finite number of a Horizons cell; undefined for "n.a." and empty cells.
function horizonsNumber(cell: string | undefined) {
	if (!cell) return undefined
	const value = Number(cell)
	return Number.isFinite(value) ? value : undefined
}

// Parses one airless Horizons observer-table row requested with HORIZONS_QUANTITIES in decimal degrees,
// refracting the elevation: date,
// two presence flags, astrometric RA/Dec, apparent RA/Dec, Az/El, magnitude and surface brightness,
// illuminated percent, light-time in minutes, elongation and its /T or /L flag, and constellation.
function parseHorizonsRow(row: readonly string[], time: number): HorizonsSample {
	const az = horizonsNumber(row[7])
	const el = horizonsNumber(row[8])
	const illuminated = horizonsNumber(row[11])
	const elongation = horizonsNumber(row[13])

	return {
		time,
		j2000: [deg(+row[3]), deg(+row[4])],
		apparent: [deg(+row[5]), deg(+row[6])],
		horizontal: az !== undefined && el !== undefined ? [deg(az), apparentAltitude(deg(el))] : undefined,
		magnitude: horizonsNumber(row[9]),
		illuminated: illuminated === undefined ? undefined : illuminated / 100,
		distance: (horizonsNumber(row[12]) ?? 0) * AU_PER_LIGHT_MINUTE,
		elongation: elongation === undefined ? undefined : deg(elongation),
		constellation: (row[15] ?? '').toUpperCase(),
	}
}

// Linear interpolation from a to b at fraction t of the way.
function lerp(a: number, b: number, t: number) {
	return a + (b - a) * t
}

// Shortest-arc interpolation of an angle in radians, normalized to [0, 2π).
function lerpAngle(a: number, b: number, t: number) {
	return normalizeAngle(a + normalizePI(b - a) * t)
}

// Interpolates the optional value of two samples; undefined when either lacks it.
function lerpOptional(a: number | undefined, b: number | undefined, t: number) {
	return a === undefined || b === undefined ? undefined : lerp(a, b, t)
}

// Position at `time` from a Horizons table, interpolated linearly between the enclosing rows; undefined
// when the table does not cover the instant.
function horizonsPositionAt(samples: readonly HorizonsSample[], time: number, topocentric: boolean): Omit<SkyPosition, 'source' | 'fallbackReason'> | undefined {
	const index = samples.findIndex((e) => e.time > time)
	if (index <= 0) return undefined

	const a = samples[index - 1]
	const b = samples[index]
	const t = (time - a.time) / (b.time - a.time)
	const nearest = t < 0.5 ? a : b

	return {
		time,
		center: topocentric ? 'topocentric' : 'geocentric',
		rightAscension: lerpAngle(a.apparent[0], b.apparent[0], t),
		declination: lerp(a.apparent[1], b.apparent[1], t),
		rightAscensionJ2000: lerpAngle(a.j2000[0], b.j2000[0], t),
		declinationJ2000: lerp(a.j2000[1], b.j2000[1], t),
		azimuth: a.horizontal && b.horizontal ? lerpAngle(a.horizontal[0], b.horizontal[0], t) : undefined,
		altitude: a.horizontal && b.horizontal ? lerp(a.horizontal[1], b.horizontal[1], t) : undefined,
		magnitude: lerpOptional(a.magnitude, b.magnitude, t),
		distance: lerp(a.distance, b.distance, t),
		illuminated: lerpOptional(a.illuminated, b.illuminated, t),
		elongation: lerpOptional(a.elongation, b.elongation, t),
		constellation: nearest.constellation,
	}
}

// Horizons COMMAND of a target that Horizons can compute; undefined for catalog objects.
function horizonsCommand(target: EphemerisTarget) {
	if (target.type === 'body') return target.code
	if (target.type === 'minorBody') return `DES=${target.spkId};`
	return undefined
}

// Converts an observer to the toolkit's geographic position (radians and AU).
export function geographic(observer: SkyObserver): GeographicPosition {
	return { latitude: observer.latitude * DEG2RAD, longitude: observer.longitude * DEG2RAD, elevation: meter(observer.elevation) }
}

// Toolkit time of a Unix instant, carrying the observer's location when there is one.
export function makeTime(time: number, observer?: SkyObserver): Time {
	const result = timeUnix(time / 1000, true)
	if (observer) result.location = geographic(observer)
	return result
}

// Barycentric ICRS states of the Earth and the Sun a calculation reduces its positions with: all from the kernels or all
// from the local models, never mixed.
interface EphemerisFoundation {
	readonly earth: PositionAndVelocityOverTime
	readonly sun: PositionAndVelocityOverTime
}

// States of the Earth and the Sun from VSOP87E.
const ANALYTIC_FOUNDATION: EphemerisFoundation = { earth: (t) => vsop.earth(t), sun: (t) => vsop.sun(t) }

// Barycentric state of the observer: the Earth's center plus the site offset when there is a site. The Earth comes from
// foundation, VSOP87E by default.
export function observerBarycentric(time: Time, foundation: EphemerisFoundation = ANALYTIC_FOUNDATION): PositionAndVelocity {
	const earth = foundation.earth(time)
	if (!time.location) return earth
	const site = frameToFrame(itrs(time.location), ITRS, ICRS, time)
	return [[earth[0][0] + site[0], earth[0][1] + site[1], earth[0][2] + site[2]], earth[1]]
}

// Adds two barycentric states.
function addStates(a: PositionAndVelocity, b: PositionAndVelocity): PositionAndVelocity {
	return [vecPlus(a[0], b[0]), vecPlus(a[1], b[1])]
}

// VSOP87E planet model by Horizons command.
const PLANET_MODELS: Readonly<Partial<Record<SolarSystemBodyCode, PositionAndVelocityOverTime>>> = {
	'199': vsop.mercury,
	'299': vsop.venus,
	'499': vsop.mars,
	'599': vsop.jupiter,
	'699': vsop.saturn,
	'799': vsop.uranus,
	'899': vsop.neptune,
}

// Barycentric ICRS model of a major body.
export function bodyModel(code: SolarSystemBodyCode): PositionAndVelocityOverTime {
	if (code === '10') return (t) => vsop.sun(t)
	if (code === '301') return (t) => addStates(vsop.earth(t), elpmpp02.moon(t))
	if (code === '999') {
		return (t) => {
			const sun = vsop.sun(t)
			const helio = pluto(t)
			return [vecPlus(sun[0], helio), sun[1]]
		}
	}
	return PLANET_MODELS[code]!
}

// Kepler orbit of osculating elements; undefined for B1950 elements, which the local model does not support.
function keplerOrbit(elements: MinorBodyElements): KeplerOrbit | undefined {
	if (elements.referenceEclipticFrame === 'B1950') return undefined

	const { tpqr, ec, i, om, w } = elements
	if ('qr' in tpqr) return comet(tpqr.qr * (1 + ec), ec, i, om, w, makeJulianTime(tpqr.tp, 0, Timescale.TDB))
	if (ec >= 1) return undefined

	const epoch = makeJulianTime(elements.epoch, 0, Timescale.TDB)
	if ('a' in tpqr) return asteroid(tpqr.a, ec, i, om, w, tpqr.ma, epoch)
	return asteroid(Math.cbrt(GM_SUN_PITJEVA_2005 / (tpqr.n * tpqr.n)), ec, i, om, w, tpqr.ma, epoch)
}

// IAU H-G phase correction in magnitudes at a phase angle in radians.
function hgPhaseCorrection(phase: number, g: number) {
	const t = Math.tan(Math.max(0, phase) / 2)
	return -2.5 * Math.log10((1 - g) * Math.exp(-3.33 * t ** 0.63) + g * Math.exp(-1.87 * t ** 1.22))
}

// Magnitude of a solar-system body from its observation geometry, or undefined when unknown.
type MagnitudeModel = (sunToBody: Vec3, observerToBody: Vec3, time: Time) => number | undefined

// Local model of a solar-system target: its barycentric state and its magnitude.
interface SolarSystemModel {
	// Barycentric ICRS state over time.
	readonly state: PositionAndVelocityOverTime
	// Magnitude model.
	readonly magnitude: MagnitudeModel
}

// Magnitude model of a body or minor body, whatever its states come from; a minor body without elements has none.
function magnitudeModel(target: Exclude<EphemerisTarget, { type: 'catalog' }>): MagnitudeModel {
	if (target.type === 'body') {
		const kind = solarSystemBody(target.code)?.kind
		if (kind === 'sun') return () => SUN_MAGNITUDE
		if (kind === 'moon' || kind === 'pluto' || kind === undefined) return () => undefined
		return (sunToBody, observerToBody, time) => {
			const value = planetMagnitude(kind, sunToBody, observerToBody, { year: toJulianEpoch(time) })
			return Number.isFinite(value) ? value : undefined
		}
	}

	const elements = target.elements
	if (!elements) return () => undefined

	return (sunToBody, observerToBody) => {
		const r = vecLength(sunToBody)
		const delta = vecLength(observerToBody)
		if (elements.m1 !== undefined) return cometMagnitudeEstimate(elements.m1, delta, r, elements.k1 ?? 10)
		if (elements.h === undefined) return undefined
		const correction = elements.g === undefined ? 0 : hgPhaseCorrection(vecAngle(sunToBody, observerToBody), elements.g)
		return asteroidMagnitudeEstimate(elements.h, r, delta, correction)
	}
}

// Local model of a body or minor body; undefined when there is none (minor body without usable elements).
function solarSystemModel(target: Exclude<EphemerisTarget, { type: 'catalog' }>, orbits: LruCache<KeplerOrbit>): SolarSystemModel | undefined {
	if (target.type === 'body') return { state: bodyModel(target.code), magnitude: magnitudeModel(target) }

	const elements = target.elements
	if (!elements) return undefined

	let orbit = orbits.get(target.spkId)

	if (!orbit) {
		orbit = keplerOrbit(elements)
		if (!orbit) return undefined
		orbits.set(target.spkId, orbit)
	}

	const kepler = orbit

	return { state: (t) => addStates(vsop.sun(t), kepler.at(t)), magnitude: magnitudeModel(target) }
}

// Apparent place of date and observed azimuth and altitude of an astrometric ICRS direction (vector or
// spherical) seen at `time`, whose location (if any) is the observer. `deflected` applies the light deflection by the
// Sun; it is off for the Sun itself. `geometricAltitude` and `hourAngle` are airless, for the rise, set, and transit.
function apparentPlace(direction: Vec3 | readonly [number, number], time: Time, earth: PositionAndVelocity, deflected: boolean = true) {
	const [ri, di] = icrsToCirs(direction, time, earth, undefined, undefined, deflected)
	const a = tt(time)
	// CIRS right ascension is referred to the CIO; subtracting the equation of the origins refers it to
	// the true equinox of date.
	const rightAscension = normalizeAngle(ri - eraEo06a(a.day, a.fraction))
	const observed = time.location ? cirsToObserved([ri, di], time, false) : undefined
	return { rightAscension, declination: di, azimuth: observed?.azimuth, altitude: observed && apparentAltitude(observed.altitude), geometricAltitude: observed?.altitude, hourAngle: observed && normalizePI(observed.hourAngle) }
}

// Airless altitude and hour angle of an object for an observer, in radians, at an instant.
interface HorizontalSample {
	// Airless altitude.
	readonly altitude: number
	// Hour angle, (−π, π], positive west of the meridian.
	readonly hourAngle: number
}

// Apparent place of a catalog object: its J2000 place moved by proper motion.
function catalogPlace(object: CatalogAstrometry, time: Time) {
	const years = (time.day - J2000 + time.fraction) / 365.25
	const ra = normalizeAngle(object.rightAscension + object.pmRA * years)
	const dec = object.declination + object.pmDEC * years
	return apparentPlace([ra, dec], time, vsop.earth(time))
}

// Local position of a catalog object: J2000 place moved by proper motion, then to the apparent place.
function catalogPosition(object: CatalogAstrometry, time: Time): Omit<SkyPosition, 'source' | 'fallbackReason' | 'time'> {
	const { rightAscension, declination, azimuth, altitude } = catalogPlace(object, time)
	const apparent = { rightAscension, declination, azimuth, altitude }

	return {
		center: time.location ? 'topocentric' : 'geocentric',
		...apparent,
		rightAscensionJ2000: object.rightAscension,
		declinationJ2000: object.declination,
		magnitude: object.magnitude,
		constellation: constellationOf(apparent.rightAscension, apparent.declination, time),
	}
}

// Airless altitude and hour angle model of a solar-system target for an observer, over Unix milliseconds.
// The model is evaluated once per hour as a geocentric geometric vector (neglecting light-time, under
// 15″ for the planets and 1″ for the Moon) and interpolated linearly in between (about 2″ for the
// Moon), so a day of event samples costs about 25 evaluations of models as slow as ELPMPP02; the
// observer's offset is then removed and the direction reduced to the observed place. The Earth comes from foundation.
function solarSystemHorizontalModel(model: SolarSystemModel, observer: SkyObserver, deflected: boolean, foundation: EphemerisFoundation = ANALYTIC_FOUNDATION): (time: number) => HorizontalSample {
	const nodes = new Map<number, Vec3>()

	const node = (hour: number) => {
		let vector = nodes.get(hour)

		if (!vector) {
			const t = timeUnix((hour * HOUR_MS) / 1000, true)
			const body = model.state(t)[0]
			const earth = foundation.earth(t)[0]
			vector = [body[0] - earth[0], body[1] - earth[1], body[2] - earth[2]]
			nodes.set(hour, vector)
		}

		return vector
	}

	return (time: number) => {
		const hour = Math.floor(time / HOUR_MS)
		const fraction = (time - hour * HOUR_MS) / HOUR_MS
		const a = node(hour)
		const b = node(hour + 1)
		const t = makeTime(time, observer)
		const site = frameToFrame(itrs(t.location!), ITRS, ICRS, t)
		const direction: Vec3 = [lerp(a[0], b[0], fraction) - site[0], lerp(a[1], b[1], fraction) - site[1], lerp(a[2], b[2], fraction) - site[2]]
		const { geometricAltitude, hourAngle } = apparentPlace(direction, t, foundation.earth(t), deflected)
		return { altitude: geometricAltitude!, hourAngle: hourAngle! }
	}
}

// Height in radians of the Moon's upper limb above the refracted horizon of an observer, over Unix milliseconds: positive
// while the Moon is up, with the rise and set convention of SkyEphemeris.events.
export function moonHorizonMargin(observer: SkyObserver) {
	const horizontal = solarSystemHorizontalModel({ state: bodyModel('301'), magnitude: () => undefined }, observer, true)
	const threshold = RISE_SET_ALTITUDE.moon!
	return (time: number) => horizontal(time).altitude - threshold
}

// Local position of a solar-system target: light-time corrected direction from the observer, apparent
// place, magnitude, illumination, and elongation. The Earth and the Sun come from foundation.
function solarSystemPosition(model: SolarSystemModel, time: Time, isSun: boolean, foundation: EphemerisFoundation = ANALYTIC_FOUNDATION): Omit<SkyPosition, 'source' | 'fallbackReason' | 'time'> {
	const direction: MutVec3 = [0, 0, 0]
	topocentricDirection(model.state, (t) => observerBarycentric(t, foundation), time, LIGHT_TIME_ITERATIONS, direction)
	const [rightAscensionJ2000, declinationJ2000] = eraC2s(...direction)
	const earth = foundation.earth(time)
	const { rightAscension, declination, azimuth, altitude } = apparentPlace(direction, time, earth, !isSun)
	const apparent = { rightAscension, declination, azimuth, altitude }
	const distance = vecLength(direction)

	const emission = timeShift(time, -lightTime(direction))
	const body = model.state(emission)[0]
	const sun = foundation.sun(emission)[0]
	const observer = observerBarycentric(time, foundation)[0]
	const sunToBody: Vec3 = [body[0] - sun[0], body[1] - sun[1], body[2] - sun[2]]
	const observerToSun: Vec3 = [sun[0] - observer[0], sun[1] - observer[1], sun[2] - observer[2]]

	return {
		center: time.location ? 'topocentric' : 'geocentric',
		...apparent,
		rightAscensionJ2000: normalizeAngle(rightAscensionJ2000),
		declinationJ2000,
		magnitude: model.magnitude(sunToBody, direction, time),
		distance,
		illuminated: isSun ? 1 : 0.5 * (1 + Math.cos(phaseAngle(body, sun, observer))),
		elongation: isSun ? 0 : vecAngle(observerToSun, direction),
		constellation: constellationOf(apparent.rightAscension, apparent.declination, time),
	}
}

// Rounds an observer coordinate for cache keys: 1e-4° (about 10 m) and 1 m.
function observerKey(observer?: SkyObserver) {
	return observer ? `${observer.latitude.toFixed(4)},${observer.longitude.toFixed(4)},${observer.elevation.toFixed(0)}` : 'geo'
}

// Rejects with the abort reason as soon as `signal` aborts, without cancelling `promise`.
async function untilAborted<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
	if (!signal) return await promise
	signal.throwIfAborted()

	let onAbort: (() => void) | undefined
	const aborted = new Promise<never>((_, reject) => {
		onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new Error('Aborted'))
		signal.addEventListener('abort', onAbort, { once: true })
	})

	try {
		return await Promise.race([promise, aborted])
	} finally {
		signal.removeEventListener('abort', onAbort!)
	}
}

// Ephemeris service with its Horizons cache, circuit breaker, Kepler orbit cache, and event cache.
export class SkyEphemeris {
	readonly #queue: SsdRequestQueue
	readonly #observer: HorizonsObserver
	readonly #timeoutMs: number
	readonly #breaker: HorizonsCircuitBreaker
	readonly #tables = new LruCache<Promise<readonly HorizonsSample[]>>(HORIZONS_CACHE_LIMIT)
	readonly #orbits = new LruCache<KeplerOrbit>(HORIZONS_CACHE_LIMIT)
	readonly #events = new LruCache<SkyEvents>(EVENTS_CACHE_LIMIT)
	readonly #kernels?: SkyEphemerisOptions['kernels']

	// Creates the service; options replace the JPL queue, the Horizons client, its budget, and the breaker clock, and give
	// the kernels of the SPICE Kernel Library.
	constructor(options: SkyEphemerisOptions = {}) {
		this.#queue = options.queue ?? new SsdRequestQueue()
		this.#observer = options.observer ?? horizonsObserver
		this.#timeoutMs = options.timeoutMs ?? HORIZONS_TIMEOUT_MS
		this.#breaker = new HorizonsCircuitBreaker(options.now ?? Date.now)
		this.#kernels = options.kernels
	}

	// Whether the ephemeris policy allows requests to JPL to resolve or compute a target: only the automatic policy does.
	get remoteAllowed() {
		return (this.#kernels?.current().policy ?? 'automatic') === 'automatic'
	}

	// Apparent position of a target. Accurate requests of bodies and minor bodies use the kernels when they cover the
	// whole calculation; otherwise, by the ephemeris policy, Horizons with the local model as a fallback on a transient
	// failure (timeout, network, open breaker) stating the reason, the local model alone, or nothing. Semantic Horizons
	// failures and minor bodies without any source reject. Catalog objects are always local, and fast requests local
	// whenever a local model exists.
	async position(target: EphemerisTarget, request: PositionRequest): Promise<SkyPosition> {
		const position = await this.#position(target, request)
		const name = CONSTELLATIONS[position.constellation as keyof typeof CONSTELLATIONS]?.name
		return name ? { ...position, constellationName: name } : position
	}

	// Computes a position as described by position(), without the constellation name.
	async #position(target: EphemerisTarget, request: PositionRequest): Promise<SkyPosition> {
		request.signal?.throwIfAborted()

		if (target.type === 'catalog') return { time: request.time, source: 'local', ...catalogPosition(target.object, makeTime(request.time, request.observer)) }

		const model = solarSystemModel(target, this.#orbits)
		const local = () => {
			if (!model) throw new EphemerisUnavailableError('No local model for this minor body; its orbital elements are unknown')
			return { time: request.time, source: 'local' as const, ...solarSystemPosition(model, makeTime(request.time, request.observer), target.type === 'body' && target.code === '10') }
		}

		if (request.mode === 'fast' && model) return local()

		const snapshot = this.#kernels?.current()
		const policy = snapshot?.policy ?? 'automatic'
		const spk = snapshot?.set ? this.#spkPosition(snapshot, target, request) : undefined
		if (spk && !(spk instanceof SpkCoverageMiss)) return spk

		if (policy === 'spkOnly') throw new EphemerisUnavailableError(spk ? `The SPK kernels do not cover this calculation: ${spk.message}` : 'No SPK kernel is enabled', undefined, spk?.code ?? 'coverageUnavailable')

		if (policy === 'offline') {
			if (model) return { ...local(), fallbackReason: 'offline' }
			throw new EphemerisUnavailableError('No SPK kernel covers this minor body, and the offline policy forbids asking Horizons', undefined, 'offline')
		}

		if (this.#breaker.isOpen()) {
			if (model) return { ...local(), fallbackReason: 'breakerOpen' }
			throw new EphemerisUnavailableError('Horizons is temporarily unavailable')
		}

		try {
			const samples = await untilAborted(this.#horizonsTable(horizonsCommand(target)!, request.time, request.observer), request.signal)
			const position = horizonsPositionAt(samples, request.time, !!request.observer)
			if (!position) throw new HorizonsEphemerisError('Horizons did not cover the requested time')
			return { ...position, source: 'horizons' }
		} catch (error) {
			if (request.signal?.aborted) throw error
			const reason = transientReason(error)
			if (reason === undefined) throw error
			if (model) return { ...local(), fallbackReason: reason }
			throw new EphemerisUnavailableError(`Horizons is unavailable (${reason})`, { cause: error })
		}
	}

	// Rise, transit, and set nearest `time` within ±12 h for an observer, sampled every 10 minutes from the kernels when
	// they cover the whole window, else from the local model (never under the spkOnly policy); undefined for a minor body
	// without either. Cached per target, observer, hour, kernel generation, and policy.
	events(target: EphemerisTarget, time: number, observer: SkyObserver, key: string): SkyEvents | undefined {
		const snapshot = this.#kernels?.current()
		const cacheKey = `${key}|${observerKey(observer)}|${Math.floor(time / HOUR_MS)}|${snapshot?.generation ?? 0}|${snapshot?.policy ?? 'automatic'}`
		const cached = this.#events.get(cacheKey)
		if (cached) return cached

		let events: SkyEvents | undefined

		if (target.type !== 'catalog' && snapshot?.set?.bodies.has(naifCode(target))) {
			const calculation = spkCalculation(snapshot, naifCode(target))
			const horizontalAt = solarSystemHorizontalModel({ state: calculation.target, magnitude: () => undefined }, observer, !(target.type === 'body' && target.code === '10'), calculation.foundation)

			try {
				events = this.#sampleEvents(target, time, horizontalAt)
			} catch (error) {
				if (!(error instanceof SpkCoverageMiss)) throw error
			}
		}

		if (!events) {
			if (target.type !== 'catalog' && snapshot?.policy === 'spkOnly') return undefined
			const horizontalAt = this.#horizontalModel(target, observer)
			if (!horizontalAt) return undefined
			events = this.#sampleEvents(target, time, horizontalAt)
		}

		this.#events.set(cacheKey, events)
		return events
	}

	// Position of a solar-system target computed entirely from the kernels, synchronously from snapshot; the miss when they
	// do not cover a state the calculation needs (the target at its emission epochs, the Earth, the Sun). A kernel that
	// cannot be read rejects with EphemerisUnavailableError instead of falling back.
	#spkPosition(snapshot: SpiceKernelSnapshot, target: Exclude<EphemerisTarget, { type: 'catalog' }>, request: PositionRequest): SkyPosition | SpkCoverageMiss {
		const code = naifCode(target)
		if (!snapshot.set!.bodies.has(code)) return new SpkCoverageMiss({ ok: false, reason: 'missing', body: code }, code)
		const calculation = spkCalculation(snapshot, code)

		try {
			const position = solarSystemPosition({ state: calculation.target, magnitude: magnitudeModel(target) }, makeTime(request.time, request.observer), target.type === 'body' && target.code === '10', calculation.foundation)
			return { time: request.time, source: 'spk', kernels: calculation.kernels(), ...position }
		} catch (error) {
			if (error instanceof SpkCoverageMiss) return error
			throw new EphemerisUnavailableError(`An SPK kernel could not be read: ${Error.isError(error) ? error.message : String(error)}`, { cause: error })
		}
	}

	// Rise, transit, and set nearest time from a horizontal model sampled every 10 minutes over ±12 h.
	#sampleEvents(target: EphemerisTarget, time: number, horizontalAt: (time: number) => HorizontalSample): SkyEvents {
		const threshold = target.type === 'body' ? (RISE_SET_ALTITUDE[solarSystemBody(target.code)?.kind ?? 'mercury'] ?? HORIZON_ALTITUDE) : HORIZON_ALTITUDE
		const center = Math.floor(time / SAMPLE_STEP_MS) * SAMPLE_STEP_MS
		const times: number[] = []
		const altitudes: number[] = []
		const hourAngles: number[] = []

		for (let t = center - EVENT_HALF_WINDOW_MS; t <= center + EVENT_HALF_WINDOW_MS; t += SAMPLE_STEP_MS) {
			const { altitude, hourAngle } = horizontalAt(t)
			times.push(t)
			altitudes.push(altitude)
			hourAngles.push(hourAngle)
		}

		return findEvents(times, altitudes, hourAngles, threshold, time)
	}

	// Airless altitude and hour angle model of a target over time for an observer; undefined without a local model.
	#horizontalModel(target: EphemerisTarget, observer: SkyObserver): ((time: number) => HorizontalSample) | undefined {
		if (target.type === 'catalog') {
			return (t) => {
				const { geometricAltitude, hourAngle } = catalogPlace(target.object, makeTime(t, observer))
				return { altitude: geometricAltitude!, hourAngle: hourAngle! }
			}
		}

		const model = solarSystemModel(target, this.#orbits)
		if (!model) return undefined
		return solarSystemHorizontalModel(model, observer, !(target.type === 'body' && target.code === '10'))
	}

	// Horizons table of a command at 10-minute steps over a 25 h window around `time`, shared by
	// concurrent requests and cached per command, observer, and hour. Failed tables are not cached.
	#horizonsTable(command: string, time: number, observer?: SkyObserver): Promise<readonly HorizonsSample[]> {
		const start = Math.floor(time / HOUR_MS) * HOUR_MS - EVENT_HALF_WINDOW_MS
		const end = start + 2 * EVENT_HALF_WINDOW_MS + HOUR_MS
		const key = `${command}|${observerKey(observer)}|${start}`
		const cached = this.#tables.get(key)
		if (cached) return cached

		const promise = this.#fetchTable(command, start, end, observer)
		this.#tables.set(key, promise)
		promise.catch(() => this.#tables.delete(key))
		return promise
	}

	// Requests and parses one Horizons table in a turn of the JPL queue, recording the outcome in the circuit breaker. A
	// refusal of the queue is not a failure of Horizons, so it never counts.
	async #fetchTable(command: string, start: number, end: number, observer?: SkyObserver): Promise<readonly HorizonsSample[]> {
		const site = observer ? geographic(observer) : undefined
		const options = { stepSize: SAMPLE_STEP_MS / 60_000, stepSizeUnit: 'm', refractionCorrection: false, headers: this.#queue.headers } as const

		try {
			const rows = await this.#queue.run((signal) => this.#observer(command, site ? 'coord' : 'geo', site ? [site.longitude, site.latitude, site.elevation] : undefined, start, end, HORIZONS_QUANTITIES, options, signal), { timeoutMs: this.#timeoutMs })
			this.#breaker.recordSuccess()
			if (rows.length === 0) throw new HorizonsEphemerisError(`Horizons returned no ephemeris for ${command}`)
			return rows.map((row, i) => parseHorizonsRow(row, start + i * SAMPLE_STEP_MS))
		} catch (error) {
			if (!isQueueRefusal(error) && transientReason(error)) this.#breaker.recordFailure()
			throw error
		}
	}
}

// Finds rise, transit, and set nearest `time` from airless altitudes and hour angles (radians, (−π, π]) sampled at
// increasing times. Crossings of `threshold` are interpolated linearly; the transit is the crossing of the meridian
// nearest `time`, where the hour angle goes from negative to positive, interpolated linearly, with its altitude from
// a parabola through the samples around it. The hour angle's own wrap, at ±π, is the lower transit and is skipped.
export function findEvents(times: readonly number[], altitudes: readonly number[], hourAngles: readonly number[], threshold: number, time: number): SkyEvents {
	let rise: number | undefined
	let set: number | undefined
	let transit: number | undefined
	let transitAltitude: number | undefined
	const nearest = (current: number | undefined, candidate: number) => (current === undefined || Math.abs(candidate - time) < Math.abs(current - time) ? candidate : current)

	for (let i = 1; i < altitudes.length; i++) {
		const a = altitudes[i - 1] - threshold
		const b = altitudes[i] - threshold

		if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
			const crossing = times[i - 1] + ((times[i] - times[i - 1]) * a) / (a - b)
			if (a < 0) rise = nearest(rise, crossing)
			else set = nearest(set, crossing)
		}

		const ha0 = hourAngles[i - 1]
		const ha1 = hourAngles[i]

		if (ha0 < 0 && ha1 >= 0 && ha1 - ha0 < Math.PI) {
			const fraction = ha0 / (ha0 - ha1)
			const candidate = times[i - 1] + (times[i] - times[i - 1]) * fraction

			if (transit === undefined || Math.abs(candidate - time) < Math.abs(transit - time)) {
				const j = i < altitudes.length - 1 ? i : i - 1
				const s = fraction + i - 1 - j
				const y0 = altitudes[j - 1]
				const y1 = altitudes[j]
				const y2 = altitudes[j + 1]
				transit = candidate
				transitAltitude = y1 + 0.5 * s * (y2 - y0 + s * (y0 - 2 * y1 + y2))
			}
		}
	}

	if (transitAltitude !== undefined) transitAltitude = apparentAltitude(transitAltitude)

	const state = rise !== undefined || set !== undefined ? 'normal' : altitudes.every((e) => e >= threshold) ? 'circumpolar' : 'belowHorizon'
	return { state, rise, transit, transitAltitude, set }
}
