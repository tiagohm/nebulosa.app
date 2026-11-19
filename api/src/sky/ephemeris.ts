import { observer as horizonsObserver, type ObserverWithOsculatingElements, Quantity } from 'nebulosa/src/adapters/ephemeris/horizons'
import { planetMagnitude } from 'nebulosa/src/astronomy/bodies/photometry'
import { cirsToObserved, icrsToCirs, lightTime, refractedAltitude, type PositionAndVelocity, type PositionAndVelocityOverTime, phaseAngle, topocentricDirection } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { constellation as constellationOf, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import { eraC2s, eraEo06a } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { frameToFrame, ICRS, ITRS } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import type { SpkKernelSet } from 'nebulosa/src/astronomy/ephemeris/kernels/spk.kernelset'
import { analyticalEphemerisSource, type EphemerisSource, interpolatedEphemerisSource, relativeEphemerisState, spkEphemerisSource, type SpkEphemerisSource } from 'nebulosa/src/astronomy/ephemeris/source'
import { asteroidMagnitudeEstimate, cometMagnitudeEstimate } from 'nebulosa/src/astronomy/formulas'
import type { GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { asteroid, comet, type KeplerOrbit } from 'nebulosa/src/astronomy/orbits/asteroid'
import { precessionNutationMatrix, type Time, Timescale, time as makeJulianTime, timeShift, timeUnix, toJulianEpoch, tt } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, DEG2RAD, GM_SUN_PITJEVA_2005, J2000, SPEED_OF_LIGHT } from 'nebulosa/src/core/constants'
import { type MutVec3, type Vec3, vecAngle, vecLength, vecPlus } from 'nebulosa/src/math/linear-algebra/vec3'
import { deg, normalizeAngle, normalizePI, toDeg } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import { computeEphemeris, computeEphemerisSync, type EphemerisAttempt, type EphemerisKernels, type EphemerisKernelsUsed, type EphemerisMode, type EphemerisProvenance, type EphemerisSourceKind, EphemerisUnavailableError, HorizonsCircuitBreaker, NO_EPHEMERIS_KERNELS, snapshotKernels } from '../ephemeris.chain'
import { LruCache } from '../lrucache'
import type { SpiceKernelSnapshot } from '../spicekernels.runtime'
import { SsdRequestQueue } from '../ssd'
import { solarSystemBody, type SolarSystemBodyKind } from './bodies'
import type { SolarSystemBodyCode } from './types'

// Ephemerides of the sky API: the apparent position of a catalog object, a major solar-system body, or
// a minor body at an instant, for an observer on the Earth or the geocenter, plus its rise, transit,
// and set. Positions of solar-system targets follow the ephemeris chain of ephemeris.chain.ts in the mode the request
// asks: accurate (the default, for the selected object and pointing) tries the SPK kernels of the SPICE Kernel Library,
// then JPL Horizons, then the local models (VSOP87E, ELPMPP02, Pluto, Kepler orbits of SBDB elements); fast (drawing
// the map) tries the kernels, then the local models, then Horizons. The kernels are used when the whole chain of the
// target, the Earth, and the Sun is covered at every epoch the calculation needs; the offline switch removes Horizons;
// a calculation never mixes sources, and its source and the sources tried before are stated in the result. Catalog
// objects are always computed from their astrometry. Events always follow the fast chain without Horizons, so they never
// wait on the network. Horizons requests go through the JPL queue, so an accurate position may wait behind another JPL
// request, within the limit of the queue. Angles are radians, times Unix milliseconds (UTC), and distances AU.

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

export type { EphemerisMode }

// Provider of a position: a source of the ephemeris chain, the astrometry of a catalog object, or the SGP4 propagation
// of the elements of an artificial satellite.
export type SkyPositionSource = EphemerisSourceKind | 'catalog' | 'sgp4'

// Kernels a position was computed from.
export type SkyPositionKernels = EphemerisKernelsUsed

// Apparent position of an object at an instant.
export interface SkyPosition {
	// Instant of the position, Unix milliseconds (UTC).
	readonly time: number
	// Provider of the position.
	readonly source: SkyPositionSource
	// Mode of the ephemeris chain; absent for a catalog object.
	readonly mode?: EphemerisMode
	// Sources of the chain tried before the one that gave the position, with why each did not; absent for a catalog object.
	readonly attempts?: readonly EphemerisAttempt[]
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
	// Kernels of the SPICE Kernel Library and the offline switch; none, online, by default.
	readonly kernels?: EphemerisKernels
}

export { EphemerisUnavailableError }

// Horizons answered without an ephemeris (unknown target or invalid request). Not retried on another source:
// the request itself is wrong.
export class HorizonsEphemerisError extends Error {
	// Creates the error.
	constructor(message: string) {
		super(message)
		this.name = 'HorizonsEphemerisError'
	}
}

// NAIF code of the SPK state of a solar-system target: the body code itself, such as 399 for the Earth or 599 for the
// planet Jupiter (never its system barycenter 5), or the SBDB SPK-ID of a minor body.
function naifCode(target: Exclude<EphemerisTarget, { type: 'catalog' }>) {
	return Number(target.type === 'body' ? target.code : target.spkId)
}

// Bodies the kernels must have for a target: the target itself, and the Earth and the Sun its apparent place is reduced with.
function kernelBodies(target: Exclude<EphemerisTarget, { type: 'catalog' }>) {
	return [
		{ name: target.type === 'body' ? target.code : target.spkId, naif: naifCode(target) },
		{ name: '399', naif: 399, dependency: true },
		{ name: '10', naif: 10, dependency: true },
	]
}

// One calculation over a kernel set: its SPK source, the state of the target, and the kernels the evaluated states used.
// Every state throws EphemerisMiss at an epoch the set does not resolve.
function spkCalculation(set: SpkKernelSet, target: number) {
	const source = spkEphemerisSource(set)
	return { source, target: (t: Time) => source.state(target, t), kernelIds: () => kernelIdsOf(source) }
}

// Identifiers of the files an SPK source used for every body it evaluated.
function kernelIdsOf(source: SpkEphemerisSource) {
	const ids = new Set<string>()
	for (const kernels of source.kernelsByBody.values()) for (const id of kernels) ids.add(id)
	return [...ids]
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

// Barycentric state of the observer: the Earth's center of a source plus the site offset when there is a site.
export function observerBarycentric(time: Time, source: EphemerisSource): PositionAndVelocity {
	const earth = source.state(399, time)
	if (!time.location) return earth
	const site = frameToFrame(itrs(time.location), ITRS, ICRS, time)
	return [[earth[0][0] + site[0], earth[0][1] + site[1], earth[0][2] + site[2]], earth[1]]
}

// Adds two barycentric states.
function addStates(a: PositionAndVelocity, b: PositionAndVelocity): PositionAndVelocity {
	return [vecPlus(a[0], b[0]), vecPlus(a[1], b[1])]
}

// The source chosen for a computation, where it comes from, and the key of that source for caches (analytical, or spk
// with the kernel generation).
export interface SolarSystemSourceChoice {
	readonly source: EphemerisSource
	readonly provenance: EphemerisProvenance
	readonly key: string
}

// Chooses over the fast ephemeris chain the source of a computation that evaluates the Sun, the Earth, and the major
// bodies `codes` lazily within a span: the SPK kernels of snapshot when they resolve every one of them at each probe (Unix
// milliseconds: the ends and the middle of the span), else the analytical theories, which always can. A kernel set
// covers a body over years to centuries, so a span probed at its ends never misses inside; a miss there would surface
// as an error of the computation, never as a mix of sources.
export function solarSystemSource(snapshot: SpiceKernelSnapshot, codes: readonly SolarSystemBodyCode[], probes: readonly number[]): SolarSystemSourceChoice {
	const bodies = codes.filter((code) => code !== '10').map((code) => ({ name: code, naif: Number(code) }))
	const { result, provenance } = computeEphemerisSync({
		kernels: snapshotKernels(snapshot),
		mode: 'fast',
		sources: {
			bodies: [...bodies, { name: '399', naif: 399, dependency: true }, { name: '10', naif: 10, dependency: true }],
			spk: (set) => {
				const source = spkEphemerisSource(set)

				for (const probe of probes) {
					const time = timeUnix(probe / 1000, true)
					source.state(399, time)
					source.state(10, time)
					for (const code of codes) source.state(Number(code), time)
				}

				return source
			},
			analytical: () => analyticalEphemerisSource,
		},
		compute: (source, _, context) => ({ source, key: context.key }),
	})

	return { ...result, provenance }
}

// Kepler orbit of osculating elements; undefined for B1950 elements, which the local model does not support, and for
// hyperbolic elements without a perihelion distance and time.
export function keplerOrbit(elements: MinorBodyElements): KeplerOrbit | undefined {
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
	return (sunToBody, observerToBody) => minorBodyMagnitude(elements, sunToBody, observerToBody)
}

// Estimated visual magnitude of a minor body from its photometry and the Sun-to-body and observer-to-body vectors (AU):
// the comet model of M1 and K1 (K1 = 10 when absent), else the asteroid H-G model (no phase correction without G);
// undefined without either.
export function minorBodyMagnitude(elements: MinorBodyElements, sunToBody: Vec3, observerToBody: Vec3) {
	const r = vecLength(sunToBody)
	const delta = vecLength(observerToBody)
	if (elements.m1 !== undefined) return cometMagnitudeEstimate(elements.m1, delta, r, elements.k1 ?? 10)
	if (elements.h === undefined) return undefined
	const correction = elements.g === undefined ? 0 : hgPhaseCorrection(vecAngle(sunToBody, observerToBody), elements.g)
	return asteroidMagnitudeEstimate(elements.h, r, delta, correction)
}

// Model of a body or minor body over a source: a body is the source's state of its code, a minor body the Kepler orbit of
// its elements around the source's Sun; undefined when there is none (minor body without usable elements).
function solarSystemModel(target: Exclude<EphemerisTarget, { type: 'catalog' }>, orbits: LruCache<KeplerOrbit>, source: EphemerisSource): SolarSystemModel | undefined {
	if (target.type === 'body') return { state: (t) => source.state(Number(target.code), t), magnitude: magnitudeModel(target) }

	const elements = target.elements
	if (!elements) return undefined

	let orbit = orbits.get(target.spkId)

	if (!orbit) {
		orbit = keplerOrbit(elements)
		if (!orbit) return undefined
		orbits.set(target.spkId, orbit)
	}

	const kepler = orbit

	return { state: (t) => addStates(source.state(10, t), kepler.at(t)), magnitude: magnitudeModel(target) }
}

// Apparent place of date and observed azimuth and altitude of an astrometric ICRS direction (vector or
// spherical) seen at `time`, whose location (if any) is the observer. `deflected` applies the light deflection by the
// Sun; it is off for the Sun itself. `geometricAltitude` and `hourAngle` are airless, for the rise, set, and transit.
function apparentPlace(direction: Vec3 | readonly [number, number], time: Time, earth: PositionAndVelocity, deflected: boolean = true) {
	const [ri, di] = icrsToCirs(direction, time, earth, undefined, undefined, deflected)
	const a = tt(time)
	// CIRS right ascension is referred to the CIO; subtracting the equation of the origins refers it to
	// the true equinox of date.
	const rightAscension = normalizeAngle(ri - eraEo06a(a.day, a.fraction, precessionNutationMatrix(time)))
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

// Apparent place of a catalog object: its J2000 place moved by proper motion, with the Earth of a source.
function catalogPlace(object: CatalogAstrometry, time: Time, source: EphemerisSource) {
	const years = (time.day - J2000 + time.fraction) / 365.25
	const ra = normalizeAngle(object.rightAscension + object.pmRA * years)
	const dec = object.declination + object.pmDEC * years
	return apparentPlace([ra, dec], time, source.state(399, time))
}

// Local position of a catalog object: J2000 place moved by proper motion, then to the apparent place with the Earth of a
// source.
function catalogPosition(object: CatalogAstrometry, time: Time, source: EphemerisSource): Omit<SkyPosition, 'source' | 'fallbackReason' | 'time'> {
	const { rightAscension, declination, azimuth, altitude } = catalogPlace(object, time, source)
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

// Geometric geocentric ICRS vector (AU) of a body of a source over Unix milliseconds, neglecting light-time; a new vector.
// A computation sampling many instants passes an interpolated source (interpolatedEphemerisSource), where the slow
// theories such as ELPMPP02 cost a few node evaluations a night.
export function geocentricOf(source: EphemerisSource, naif: number): (time: number) => Vec3 {
	return (time) => relativeEphemerisState(source, naif, 399, timeUnix(time / 1000, true))[0]
}

// Airless altitude and hour angle model of a solar-system target for an observer, over Unix milliseconds: the geometric
// geocentric vector of the model (neglecting light-time, under 15″ for the planets and 1″ for the Moon) less the
// observer's offset, reduced to the observed place with the Earth of the source. A computation sampling many instants
// passes an interpolated source, so the model and the Earth cost a few node evaluations a day.
function solarSystemHorizontalModel(model: SolarSystemModel, observer: SkyObserver, deflected: boolean, source: EphemerisSource): (time: number) => HorizontalSample {
	return (time: number) => {
		const t = makeTime(time, observer)
		const earth = source.state(399, t)
		const body = model.state(t)[0]
		const site = frameToFrame(itrs(t.location!), ITRS, ICRS, t)
		const direction: Vec3 = [body[0] - earth[0][0] - site[0], body[1] - earth[0][1] - site[1], body[2] - earth[0][2] - site[2]]
		const { geometricAltitude, hourAngle } = apparentPlace(direction, t, earth, deflected)
		return { altitude: geometricAltitude!, hourAngle: hourAngle! }
	}
}

// Height in radians of the Moon's upper limb above the refracted horizon of an observer, over Unix milliseconds: positive
// while the Moon is up, with the rise and set convention of SkyEphemeris.events. The Moon, the Earth, and the Sun come
// from a source, interpolated by the caller when it samples many instants.
export function moonHorizonMargin(observer: SkyObserver, source: EphemerisSource) {
	const horizontal = solarSystemHorizontalModel({ state: (t) => source.state(301, t), magnitude: () => undefined }, observer, true, source)
	const threshold = RISE_SET_ALTITUDE.moon!
	return (time: number) => horizontal(time).altitude - threshold
}

// Apparent geocentric right ascension of date of a body of a source at an instant, in radians from the true equinox,
// with light time, aberration (and light deflection except for the Sun), precession, and nutation.
export function apparentRightAscension(source: EphemerisSource, naif: number, time: Time): number {
	return solarSystemPosition({ state: (t) => source.state(naif, t), magnitude: () => undefined }, time, naif === 10, source).rightAscension
}

// Local position of a solar-system target: light-time corrected direction from the observer, apparent
// place, magnitude, illumination, and elongation. The Earth and the Sun come from a source.
function solarSystemPosition(model: SolarSystemModel, time: Time, isSun: boolean, source: EphemerisSource): Omit<SkyPosition, 'source' | 'fallbackReason' | 'time'> {
	const direction: MutVec3 = [0, 0, 0]
	topocentricDirection(model.state, (t) => observerBarycentric(t, source), time, LIGHT_TIME_ITERATIONS, direction)
	const [rightAscensionJ2000, declinationJ2000] = eraC2s(...direction)
	const earth = source.state(399, time)
	const { rightAscension, declination, azimuth, altitude } = apparentPlace(direction, time, earth, !isSun)
	const apparent = { rightAscension, declination, azimuth, altitude }
	const distance = vecLength(direction)

	const emission = timeShift(time, -lightTime(direction))
	const body = model.state(emission)[0]
	const sun = source.state(10, emission)[0]
	const observer = observerBarycentric(time, source)[0]
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

// What one source of the chain computes a position with, and the kernels it used.
interface PositionComputation {
	readonly position: () => Omit<SkyPosition, 'source' | 'mode' | 'attempts' | 'kernels' | 'time'>
	readonly kernelIds?: () => readonly string[]
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
	readonly #kernels: EphemerisKernels

	// Creates the service; options replace the JPL queue, the Horizons client, its budget, and the breaker clock, and give
	// the kernels of the SPICE Kernel Library.
	constructor(options: SkyEphemerisOptions = {}) {
		this.#queue = options.queue ?? new SsdRequestQueue()
		this.#observer = options.observer ?? horizonsObserver
		this.#timeoutMs = options.timeoutMs ?? HORIZONS_TIMEOUT_MS
		this.#breaker = new HorizonsCircuitBreaker(options.now ?? Date.now, HORIZONS_BREAKER_FAILURE_THRESHOLD, HORIZONS_BREAKER_OPEN_MS)
		this.#kernels = options.kernels ?? NO_EPHEMERIS_KERNELS
	}

	// Whether automatic requests may reach JPL to resolve or compute a target: not while the ephemeris sources are offline.
	get remoteAllowed() {
		return !this.#kernels.current().offline
	}

	// Apparent position of a target. Bodies and minor bodies follow the ephemeris chain of the request's mode (accurate by
	// default), from one source, stating it and the sources tried before; rejects with EphemerisUnavailableError when no
	// source can give it (no kernel, no local model, and Horizons offline or failing) and with HorizonsEphemerisError when
	// Horizons rejects the request itself. Catalog objects are always computed from their astrometry.
	async position(target: EphemerisTarget, request: PositionRequest): Promise<SkyPosition> {
		const position = await this.#position(target, request)
		const name = CONSTELLATIONS[position.constellation as keyof typeof CONSTELLATIONS]?.name
		return name ? { ...position, constellationName: name } : position
	}

	// Computes a position as described by position(), without the constellation name.
	async #position(target: EphemerisTarget, request: PositionRequest): Promise<SkyPosition> {
		request.signal?.throwIfAborted()

		if (target.type === 'catalog') {
			const { source } = solarSystemSource(this.#kernels.current(), [], [request.time])
			return { time: request.time, source: 'catalog', ...catalogPosition(target.object, makeTime(request.time, request.observer), source) }
		}

		const time = makeTime(request.time, request.observer)
		const isSun = target.type === 'body' && target.code === '10'
		const model = solarSystemModel(target, this.#orbits, analyticalEphemerisSource)

		const { results, provenance } = await computeEphemeris<PositionComputation, ReturnType<PositionComputation['position']>>({
			kernels: this.#kernels,
			mode: request.mode ?? 'accurate',
			signal: request.signal,
			breaker: this.#breaker,
			sources: {
				bodies: kernelBodies(target),
				spk: (set) => {
					const calculation = spkCalculation(set, naifCode(target))
					return { position: () => solarSystemPosition({ state: calculation.target, magnitude: magnitudeModel(target) }, time, isSun, calculation.source), kernelIds: calculation.kernelIds }
				},
				analytical: () => model && { position: () => solarSystemPosition(model, time, isSun, analyticalEphemerisSource) },
				horizons: async (signal) => {
					const samples = await untilAborted(this.#horizonsTable(horizonsCommand(target)!, request.time, request.observer), signal)

					return {
						position: () => {
							const position = horizonsPositionAt(samples, request.time, !!request.observer)
							if (!position) throw new HorizonsEphemerisError('Horizons did not cover the requested time')
							return position
						},
					}
				},
				kernelsOf: (computation) => computation.kernelIds?.() ?? [],
			},
			compute: (computation) => computation.position(),
		})

		return { time: request.time, ...results[0], source: provenance.source, mode: provenance.mode, attempts: provenance.attempts, ...(provenance.kernels && { kernels: provenance.kernels }) }
	}

	// Rise, transit, and set nearest `time` within ±12 h for an observer, sampled every 10 minutes over the fast ephemeris
	// chain without Horizons: the kernels when they cover the whole window, else the local model; undefined for a minor
	// body without either. Cached per target, observer, hour, and kernel generation.
	events(target: EphemerisTarget, time: number, observer: SkyObserver, key: string): SkyEvents | undefined {
		const snapshot = this.#kernels.current()
		const cacheKey = `${key}|${observerKey(observer)}|${Math.floor(time / HOUR_MS)}|${snapshot.generation}`
		const cached = this.#events.get(cacheKey)
		if (cached) return cached

		let events: SkyEvents

		if (target.type === 'catalog') {
			const source = interpolatedEphemerisSource(solarSystemSource(snapshot, [], [time - EVENT_HALF_WINDOW_MS, time + EVENT_HALF_WINDOW_MS]).source)
			events = this.#sampleEvents(target, time, (t) => {
				const { geometricAltitude, hourAngle } = catalogPlace(target.object, makeTime(t, observer), source)
				return { altitude: geometricAltitude!, hourAngle: hourAngle! }
			})
		} else {
			const deflected = !(target.type === 'body' && target.code === '10')
			const analytical = interpolatedEphemerisSource(analyticalEphemerisSource)
			const model = solarSystemModel(target, this.#orbits, analytical)

			try {
				events = computeEphemerisSync({
					kernels: snapshotKernels(snapshot),
					mode: 'fast',
					sources: {
						bodies: kernelBodies(target),
						spk: (set) => {
							const source = interpolatedEphemerisSource(spkEphemerisSource(set))
							const naif = naifCode(target)
							return solarSystemHorizontalModel({ state: (t) => source.state(naif, t), magnitude: () => undefined }, observer, deflected, source)
						},
						analytical: () => model && solarSystemHorizontalModel(model, observer, deflected, analytical),
					},
					compute: (horizontalAt) => this.#sampleEvents(target, time, horizontalAt),
				}).result
			} catch (error) {
				if (error instanceof EphemerisUnavailableError) return undefined
				throw error
			}
		}

		this.#events.set(cacheKey, events)
		return events
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

	// Requests and parses one Horizons table in a turn of the JPL queue; the chain records the outcome in the circuit
	// breaker. An empty answer is a semantic failure.
	async #fetchTable(command: string, start: number, end: number, observer?: SkyObserver): Promise<readonly HorizonsSample[]> {
		const site = observer ? geographic(observer) : undefined
		const options = { stepSize: SAMPLE_STEP_MS / 60_000, stepSizeUnit: 'm', refractionCorrection: false, headers: this.#queue.headers } as const
		const rows = await this.#queue.run((signal) => this.#observer(command, site ? 'coord' : 'geo', site ? [site.longitude, site.latitude, site.elevation] : undefined, start, end, HORIZONS_QUANTITIES, options, signal), { timeoutMs: this.#timeoutMs })
		if (rows.length === 0) throw new HorizonsEphemerisError(`Horizons returned no ephemeris for ${command}`)
		return rows.map((row, i) => parseHorizonsRow(row, start + i * SAMPLE_STEP_MS))
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
