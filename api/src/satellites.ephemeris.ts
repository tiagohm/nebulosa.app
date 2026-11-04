import { equatorial, zeroPositionAndVelocity } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { constellation as constellationOf } from 'nebulosa/src/astronomy/coordinates/constellation'
import { observerState } from 'nebulosa/src/astronomy/coordinates/correction'
import { frameToFrame, ICRS, ITRS, TEME, TRUE_EQUATOR_AND_EQUINOX_OF_DATE } from 'nebulosa/src/astronomy/coordinates/frame'
import { itrs } from 'nebulosa/src/astronomy/coordinates/itrs'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { type SatellitePassEvent, satelliteShadowState, type SatelliteShadowState, satelliteSubpoint, satelliteTrackingState, satelliteVisibleIntervals, type SatelliteWindowPass, satelliteWindowPasses } from 'nebulosa/src/astronomy/events/satellite'
import type { GeographicPosition } from 'nebulosa/src/astronomy/observer/location'
import { recordFromOMM, type SatRec, sgp4 } from 'nebulosa/src/astronomy/orbits/propagation/sgp4'
import { type Time, timeShift, timeToUnixMillis, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, DAYSEC, ONE_SECOND, TAU } from 'nebulosa/src/core/constants'
import { type Vec3, vecDot, vecLength, vecMinus } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle } from 'nebulosa/src/math/units/angle'
import type { EarthOrientationCoverage, EarthOrientationStatus } from './astronomicaltime.eop'
import { LruCache } from './lrucache'
import type { SatelliteElementKind, SatelliteElementSet } from './satellites.store'
import { apparentAltitude, geographic, type SkyObserver } from './sky/ephemeris'

// Predictions of artificial satellites from their stored element sets, with the toolkit's SGP4 and frames only: one
// instant (position, motion, illumination), passes over an observer with their sunlit and dark parts, sampled
// ephemerides, and the sampled tracks the Sky interpolates. Every answer names the element set it came from (digest,
// epoch, kind, source) and a quality judged from the age of the elements, the decay of the object, propagation errors,
// and the Earth orientation data. SGP4 gives TEME states; positions are geometric (no light time, no aberration: a
// satellite moves with the Earth, so the annual aberration of the stars does not apply to it, and the light time of a few
// milliseconds is ignored), topocentric with an observer and geocentric without one. RA/Dec are given of date (true
// equator and equinox, the frame of the Sky map) and in ICRS (J2000). Times are Unix milliseconds (UTC), angles radians.

// Earth's resting state at the geocenter, for the observer's inertial state.
const ZERO_EARTH_STATE = zeroPositionAndVelocity()

// Prepared SGP4 records kept, by element digest.
const RECORD_CACHE_SIZE = 512

// Orbital period below which an object is in low Earth orbit, in minutes: the 225 minutes that separate the near-Earth
// SGP4 from the deep-space SDP4.
const LOW_ORBIT_PERIOD_MINUTES = 225

// Age of the elements, in days, beyond which predictions are only approximate (caution) and then unusable for passes,
// for low orbits (drag changes them quickly) and higher ones. These are conservative policy limits, not error bars.
export const ELEMENT_AGE_LIMITS = { low: { caution: 3, unavailable: 14 }, high: { caution: 14, unavailable: 60 } } as const

// Coarse steps of the pass search, in days: short enough to bracket a pass of a few minutes over a low orbit, and a
// minute for higher ones, whose passes last hours.
const LOW_ORBIT_PASS_STEP = 10 * ONE_SECOND
const HIGH_ORBIT_PASS_STEP = 60 * ONE_SECOND

// Largest number of passes, rows of an ephemeris, objects of a Sky series, and samples of a Sky series.
export const SATELLITE_LIMITS = { passes: 200, ephemerisRows: 5000, seriesObjects: 50, seriesSamples: 20_000 } as const

// Suitability of a prediction for use.
export type SatelliteSuitability = 'usable' | 'caution' | 'unavailable'

// Reason lowering the suitability of a prediction:
// - decayed: the catalog dates the decay of the object before the instant;
// - propagationError: SGP4 failed at the instant (such as an orbit decayed by the model);
// - elementsAging: the elements are older (or younger) than the caution limit of their orbit;
// - elementsOld: the elements are older (or younger) than the usable limit of their orbit;
// - eopApproximate: no Earth orientation table holds the instant, so UT1 is taken as UTC.
export type SatelliteQualityReason = 'decayed' | 'propagationError' | 'elementsAging' | 'elementsOld' | 'eopApproximate'

// Quality of a prediction.
export interface SatelliteQuality {
	// Suitability, the worst of the reasons.
	readonly suitability: SatelliteSuitability
	// Reasons lowering it, empty when usable.
	readonly reasons: readonly SatelliteQualityReason[]
	// Instant minus the epoch of the elements, in days; the largest magnitude for an interval.
	readonly elementAgeDays: number
	// Earth orientation data at the instant.
	readonly eop: EarthOrientationStatus
}

// Element set a prediction was computed from.
export interface SatelliteElementsRef {
	// SHA-256 of the canonical OMM.
	readonly digest: string
	// Epoch, Unix milliseconds (UTC).
	readonly epoch: number
	// Kind of the set.
	readonly kind: SatelliteElementKind
	// Source key of the query or import that delivered it.
	readonly sourceKey: string
}

// Mean elements of the set and the orbit derived from them.
export interface SatelliteOrbitSummary {
	// Epoch, Unix milliseconds (UTC).
	readonly epoch: number
	// Mean motion, revolutions per day.
	readonly meanMotion: number
	// Mean eccentricity.
	readonly eccentricity: number
	// Mean inclination, right ascension of the ascending node, argument of perigee, and mean anomaly, radians.
	readonly inclination: number
	readonly rightAscensionOfAscendingNode: number
	readonly argumentOfPerigee: number
	readonly meanAnomaly: number
	// SGP4 drag term, inverse Earth radii.
	readonly bstar: number
	// Orbital period derived from the mean motion, minutes.
	readonly periodMinutes: number
	// Semi-major axis derived by SGP4, km.
	readonly semiMajorAxisKm: number
	// Apogee and perigee heights above the model's equatorial radius derived by SGP4, km.
	readonly apogeeHeightKm: number
	readonly perigeeHeightKm: number
	// SGP4 branch: near-Earth, or deep space (period of 225 minutes or more).
	readonly model: 'nearEarth' | 'deepSpace'
}

// Position and motion of a satellite at an instant.
export interface SatellitePosition {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Origin of the direction: the observer, or the Earth's center without one.
	readonly center: 'topocentric' | 'geocentric'
	// Geometric right ascension and declination, true equator and equinox of date, radians.
	readonly rightAscension: number
	readonly declination: number
	// Geometric right ascension and declination in ICRS (J2000), radians.
	readonly rightAscensionJ2000: number
	readonly declinationJ2000: number
	// Azimuth (north through east) and geometric altitude, radians; absent without an observer.
	readonly azimuth?: number
	readonly altitude?: number
	// Altitude with the refraction of a standard atmosphere, radians; absent without an observer.
	readonly apparentAltitude?: number
	// Distance from the observer (or the Earth's center), km.
	readonly distanceKm: number
	// Rate of change of the distance from the observer, km/s, positive receding; absent without an observer.
	readonly rangeRateKmPerSecond?: number
	// Angular speed of the line of sight in inertial axes, radians per second; absent without an observer.
	readonly angularRate?: number
	// Distance from the Earth's center, km.
	readonly geocentricDistanceKm: number
	// Geodetic latitude and east longitude of the point below the satellite, radians, and its height above the
	// ellipsoid, km.
	readonly subpointLatitude: number
	readonly subpointLongitude: number
	readonly heightKm: number
	// Illumination by the Sun: sunlit, in the Earth's penumbra, or in its umbra.
	readonly shadow: SatelliteShadowState
	// Geometric altitude of the Sun's center for the observer, radians; absent without an observer.
	readonly sunAltitude?: number
	// IAU abbreviation of the constellation of the position of date, upper case.
	readonly constellation: string
}

// Instant of a pass with the look angles.
export interface SatellitePassPoint {
	// Instant, Unix milliseconds (UTC).
	readonly time: number
	// Azimuth (north through east) and geometric altitude, radians.
	readonly azimuth: number
	readonly altitude: number
	// Distance from the observer, km.
	readonly rangeKm: number
}

// Part of a pass in which the satellite is sunlit (outside the umbra) while the observer's Sun is below the twilight
// limit: when it can be seen, brightness permitting.
export interface SatelliteVisiblePart {
	// Start and end, Unix milliseconds (UTC).
	readonly start: number
	readonly end: number
	// Highest point of the part.
	readonly culmination: SatellitePassPoint
}

// Pass of a satellite above the observer's minimum altitude.
export interface SatellitePassPrediction {
	// Rise through the minimum altitude, or the start of the window when startsBeforeWindow.
	readonly start: SatellitePassPoint
	// Highest point within the window.
	readonly culmination: SatellitePassPoint
	// Set through the minimum altitude, or the end of the window when endsAfterWindow.
	readonly end: SatellitePassPoint
	// Whether the pass was in progress at the start of the window, or still is at its end.
	readonly startsBeforeWindow: boolean
	readonly endsAfterWindow: boolean
	// Illumination at the culmination.
	readonly culminationShadow: SatelliteShadowState
	// Geometric altitude of the Sun's center at the culmination, radians.
	readonly culminationSunAltitude: number
	// Parts in which the satellite can be seen, in time order; empty for a pass entirely in daylight or in the shadow.
	readonly visible: readonly SatelliteVisiblePart[]
}

// Options of a pass search.
export interface SatellitePassOptions {
	// Minimum geometric altitude, radians.
	readonly minAltitude: number
	// Largest geometric altitude of the observer's Sun for a visible part, radians, such as -6° for civil twilight.
	readonly maxSunAltitude: number
}

// Passes of a window.
export interface SatellitePasses {
	// Passes in time order, at most SATELLITE_LIMITS.passes.
	readonly passes: readonly SatellitePassPrediction[]
	// Whether passes after the last one were left out.
	readonly truncated: boolean
}

// Row of a sampled ephemeris.
export interface SatelliteEphemerisRow extends SatellitePosition {}

// Sampled ephemeris.
export interface SatelliteEphemerisTable {
	// Rows in time order, at most SATELLITE_LIMITS.ephemerisRows.
	readonly rows: readonly SatelliteEphemerisRow[]
	// Whether rows after the last one were left out.
	readonly truncated: boolean
}

// Sampled track of a satellite for the Sky map, in parallel arrays by sample.
export interface SatelliteTrack {
	// Instants, Unix milliseconds (UTC), increasing.
	readonly times: readonly number[]
	// Geometric right ascension and declination, true equator and equinox of date, radians.
	readonly rightAscension: readonly number[]
	readonly declination: readonly number[]
	// Geometric altitude, radians; absent without an observer.
	readonly altitude?: readonly number[]
	// Whether the satellite is outside the Earth's umbra.
	readonly sunlit: readonly boolean[]
}

// Nodes of the interpolated Sun per day: one per hour. Linear interpolation between hourly VSOP87E positions departs
// from the orbit by its sagitta, about 6e-8 of the distance (0.01″), far below what shadow and twilight need, while a
// VSOP87E evaluation costs about half a millisecond and the event searches evaluate the Sun at every sample.
const SUN_NODES_PER_DAY = 24

// Hourly geocentric Sun positions kept, by hour index: about half a year.
const SUN_CACHE_SIZE = 4096

// Geocentric Sun positions at the hourly nodes, shared by every prediction since they depend on the instant only.
const SUN_NODES = new LruCache<Vec3>(SUN_CACHE_SIZE)

// Geocentric Sun in ICRS at the hourly node `node` (hours from the Julian day origin of the scale of `time`), AU.
function sunNode(time: Time, node: number) {
	const key = `${time.scale}:${node}`
	let sun = SUN_NODES.get(key)

	if (!sun) {
		const at = timeShift(time, node / SUN_NODES_PER_DAY - time.day - time.fraction)
		sun = vecMinus(vsop.sun(at)[0], vsop.earth(at)[0])
		SUN_NODES.set(key, sun)
	}

	return sun
}

// Geocentric Sun in ICRS, AU, interpolated linearly between the VSOP87E positions of the hourly nodes around the instant.
function sunAt(time: Time): Vec3 {
	const hours = (time.day + time.fraction) * SUN_NODES_PER_DAY
	const node = Math.floor(hours)
	const f = hours - node
	const a = sunNode(time, node)
	const b = sunNode(time, node + 1)
	return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

// Unit vector of the local vertical of a geodetic site, in ITRS.
function zenith(site: GeographicPosition): [number, number, number] {
	const cosLat = Math.cos(site.latitude)
	return [cosLat * Math.cos(site.longitude), cosLat * Math.sin(site.longitude), Math.sin(site.latitude)]
}

// Geometric altitude of the Sun's center for a site, radians; the solar parallax (8.8″) is neglected.
function sunAltitudeAt(site: GeographicPosition, time: Time) {
	const sun = frameToFrame(sunAt(time), ICRS, ITRS, time)
	return Math.asin(Math.max(-1, Math.min(1, vecDot(sun, zenith(site)) / vecLength(sun))))
}

// Span searched for passes at a time, in milliseconds: a day, about 50 ms of computation for a low orbit.
const PASS_CHUNK_MS = 86_400_000

// Rows of an ephemeris computed between two turns of the event loop: about 100 ms of computation.
const EPHEMERIS_BATCH = 250

// Lets the event loop run before the next part of a long computation; rejects with the abort reason when `signal` has
// aborted, so a request that was cancelled or superseded stops computing.
async function yieldToEventLoop(signal: AbortSignal | undefined) {
	await Bun.sleep(0)
	signal?.throwIfAborted()
}

// Joins the two halves of a pass cut by a boundary between two searches: the start of the first, the end of the second,
// and the higher culmination.
function joinPasses(first: SatelliteWindowPass, second: SatelliteWindowPass): SatelliteWindowPass {
	const culmination = second.culmination.altitude > first.culmination.altitude ? second.culmination : first.culmination
	return { start: first.start, culmination, end: second.end, startsBeforeWindow: first.startsBeforeWindow, endsAfterWindow: second.endsAfterWindow }
}

// Converts a toolkit pass event to the API's.
function passPoint(event: SatellitePassEvent): SatellitePassPoint {
	return { time: timeToUnixMillis(event.time), azimuth: event.azimuth, altitude: event.altitude, rangeKm: event.range * AU_KM }
}

// Orbital period of a prepared record, minutes.
function periodOf(record: SatRec) {
	return TAU / record.no
}

// Predictions of satellites from their element sets.
export class SatelliteEphemeris {
	readonly #records = new LruCache<SatRec>(RECORD_CACHE_SIZE)

	// Creates the predictions; `coverage` tells whether the Earth orientation tables hold an instant.
	constructor(private readonly coverage: (utc: Time) => EarthOrientationCoverage) {}

	// Returns a fresh copy of the prepared record of an element set. SGP4 writes into a record as it propagates, so every
	// computation gets its own copy and concurrent requests never share one.
	record(elements: SatelliteElementSet): SatRec {
		let record = this.#records.get(elements.digest)

		if (!record) {
			record = recordFromOMM(elements.omm)
			this.#records.set(elements.digest, record)
		}

		return { ...record }
	}

	// Returns the reference to an element set that every prediction carries.
	elementsRef(elements: SatelliteElementSet): SatelliteElementsRef {
		return { digest: elements.digest, epoch: elements.epoch, kind: elements.kind, sourceKey: elements.sourceKey }
	}

	// Returns the mean elements and the orbit derived from them.
	orbit(elements: SatelliteElementSet): SatelliteOrbitSummary {
		const record = this.record(elements)
		const radius = record.gravity?.radius ?? 6378.135
		return {
			epoch: elements.epoch,
			meanMotion: +elements.omm.MEAN_MOTION,
			eccentricity: record.ecco,
			inclination: record.inclo,
			rightAscensionOfAscendingNode: record.nodeo,
			argumentOfPerigee: record.argpo,
			meanAnomaly: record.mo,
			bstar: record.bstar,
			periodMinutes: periodOf(record),
			semiMajorAxisKm: record.a * radius,
			apogeeHeightKm: record.alta * radius,
			perigeeHeightKm: record.altp * radius,
			model: record.method === 'd' ? 'deepSpace' : 'nearEarth',
		}
	}

	// Judges the predictions of an element set over instants (Unix milliseconds, UTC), the worst instant deciding.
	// `decayDate` is the catalog's decay date (YYYY-MM-DD), and `failed` whether SGP4 failed at one of them.
	quality(elements: SatelliteElementSet, times: readonly number[], decayDate?: string, failed = false): SatelliteQuality {
		const limits = periodOf(this.record(elements)) < LOW_ORBIT_PERIOD_MINUTES ? ELEMENT_AGE_LIMITS.low : ELEMENT_AGE_LIMITS.high
		const reasons: SatelliteQualityReason[] = []
		let elementAgeDays = 0
		let eop: EarthOrientationStatus = 'covered'

		for (const time of times) {
			const age = (time - elements.epoch) / 86_400_000
			if (Math.abs(age) > Math.abs(elementAgeDays)) elementAgeDays = age
			const status = this.coverage(timeUnix(time / 1000, true)).status
			if (status !== 'covered') eop = status
		}

		const decay = decayDate === undefined ? Number.NaN : Date.parse(`${decayDate}T00:00:00Z`)
		if (times.some((time) => time >= decay)) reasons.push('decayed')
		if (failed) reasons.push('propagationError')
		if (Math.abs(elementAgeDays) > limits.unavailable) reasons.push('elementsOld')
		else if (Math.abs(elementAgeDays) > limits.caution) reasons.push('elementsAging')
		if (eop !== 'covered') reasons.push('eopApproximate')

		const unavailable = reasons.some((reason) => reason === 'decayed' || reason === 'propagationError' || reason === 'elementsOld')
		return { suitability: unavailable ? 'unavailable' : reasons.length > 0 ? 'caution' : 'usable', reasons, elementAgeDays, eop }
	}

	// Computes the position of a satellite at an instant, from an observer or the Earth's center. Throws when SGP4 fails
	// at the instant.
	position(elements: SatelliteElementSet, time: number, observer?: SkyObserver): SatellitePosition {
		return this.#position(this.record(elements), time, observer && geographic(observer))
	}

	// Computes a position with a prepared record and site.
	#position(record: SatRec, time: number, site: GeographicPosition | undefined): SatellitePosition {
		const t = timeUnix(time / 1000, true)
		const geocentric = frameToFrame(sgp4(t, record), TEME, ICRS, t)
		const origin = site ? observerState(t, ZERO_EARTH_STATE, site)[0] : ZERO_EARTH_STATE[0]
		const relative = vecMinus(geocentric[0], origin)
		const [raJ2000, decJ2000, distance] = equatorial(relative)
		const [ra, dec] = equatorial(frameToFrame(relative, ICRS, TRUE_EQUATOR_AND_EQUINOX_OF_DATE, t))
		const subpoint = satelliteSubpoint(record, t)
		const rightAscension = normalizeAngle(ra)
		let topocentric: Partial<SatellitePosition> = {}

		if (site) {
			const tracking = satelliteTrackingState(record, site, t)
			topocentric = {
				azimuth: tracking.azimuth,
				altitude: tracking.altitude,
				apparentAltitude: apparentAltitude(tracking.altitude),
				rangeRateKmPerSecond: (tracking.rangeRate * AU_KM) / DAYSEC,
				angularRate: tracking.angularRate / DAYSEC,
				sunAltitude: sunAltitudeAt(site, t),
			}
		}

		return {
			time,
			center: site ? 'topocentric' : 'geocentric',
			rightAscension,
			declination: dec,
			rightAscensionJ2000: normalizeAngle(raJ2000),
			declinationJ2000: decJ2000,
			distanceKm: distance * AU_KM,
			geocentricDistanceKm: vecLength(geocentric[0]) * AU_KM,
			subpointLatitude: subpoint.latitude,
			subpointLongitude: subpoint.longitude,
			heightKm: subpoint.elevation * AU_KM,
			shadow: satelliteShadowState(record, sunAt, t),
			constellation: constellationOf(rightAscension, dec, t),
			...topocentric,
		}
	}

	// Finds the passes of a satellite over an observer between two instants (Unix milliseconds, UTC), with the parts of
	// each in which it is sunlit while the observer's Sun is below the twilight limit. The window is searched a day at a
	// time, letting the event loop run between days, and a pass cut by a day boundary is joined again. Rejects with the
	// abort reason when `signal` aborts, and when SGP4 fails.
	async passes(elements: SatelliteElementSet, observer: SkyObserver, start: number, end: number, options: SatellitePassOptions, signal?: AbortSignal): Promise<SatellitePasses> {
		const record = this.record(elements)
		const site = geographic(observer)
		const step = periodOf(record) < LOW_ORBIT_PERIOD_MINUTES ? LOW_ORBIT_PASS_STEP : HIGH_ORBIT_PASS_STEP
		const found: SatelliteWindowPass[] = []

		for (let from = start; from < end && found.length <= SATELLITE_LIMITS.passes; from += PASS_CHUNK_MS) {
			if (from > start) await yieldToEventLoop(signal)
			const to = Math.min(end, from + PASS_CHUNK_MS)

			for (const pass of satelliteWindowPasses(record, site, timeUnix(from / 1000), timeUnix(to / 1000), { minAltitude: options.minAltitude, step })) {
				const last = found.at(-1)
				// A pass above the horizon at a day boundary ends one day and starts the next: the two halves are one pass.
				if (last?.endsAfterWindow && pass.startsBeforeWindow && timeToUnixMillis(last.end.time) === from) found[found.length - 1] = joinPasses(last, pass)
				else found.push(pass)
			}
		}

		const truncated = found.length > SATELLITE_LIMITS.passes
		const kept = truncated ? found.slice(0, SATELLITE_LIMITS.passes) : found
		const visibility = { minimumAltitude: options.minAltitude, maximumSunAltitude: options.maxSunAltitude, step }
		const passes: SatellitePassPrediction[] = []

		for (const pass of kept) {
			await yieldToEventLoop(signal)
			// The visible parts share the minimum altitude of the pass, so only its own span is searched: the inertial
			// frames the shadow needs cost far more per sample than the look angles of the pass search.
			const parts = satelliteVisibleIntervals(record, site, sunAt, pass.start.time, pass.end.time, visibility).map((part): SatelliteVisiblePart => ({ start: timeToUnixMillis(part.start.time), end: timeToUnixMillis(part.end.time), culmination: passPoint(part.culmination) }))

			passes.push({
				start: passPoint(pass.start),
				culmination: passPoint(pass.culmination),
				end: passPoint(pass.end),
				startsBeforeWindow: pass.startsBeforeWindow,
				endsAfterWindow: pass.endsAfterWindow,
				culminationShadow: satelliteShadowState(record, sunAt, pass.culmination.time),
				culminationSunAltitude: sunAltitudeAt(site, pass.culmination.time),
				visible: parts,
			})
		}

		return { passes, truncated }
	}

	// Samples the position of a satellite every `step` milliseconds from `start` to `end` (Unix milliseconds, UTC), at
	// most SATELLITE_LIMITS.ephemerisRows rows, letting the event loop run every EPHEMERIS_BATCH rows. Rejects with the
	// abort reason when `signal` aborts, and when SGP4 fails at a sample.
	async ephemeris(elements: SatelliteElementSet, start: number, end: number, step: number, observer?: SkyObserver, signal?: AbortSignal): Promise<SatelliteEphemerisTable> {
		const record = this.record(elements)
		const site = observer && geographic(observer)
		const count = Math.floor((end - start) / step) + 1
		const truncated = count > SATELLITE_LIMITS.ephemerisRows
		const rows: SatelliteEphemerisRow[] = []

		for (let i = 0; i < Math.min(count, SATELLITE_LIMITS.ephemerisRows); i++) {
			if (i > 0 && i % EPHEMERIS_BATCH === 0) await yieldToEventLoop(signal)
			rows.push(this.#position(record, start + i * step, site))
		}

		return { rows, truncated }
	}

	// Samples the track of a satellite for the Sky map every `step` milliseconds from `start` to `end` (Unix
	// milliseconds, UTC), at most `samples` samples. Throws when SGP4 fails at a sample.
	track(elements: SatelliteElementSet, start: number, end: number, step: number, samples: number, observer?: SkyObserver): SatelliteTrack {
		const record = this.record(elements)
		const site = observer && geographic(observer)
		const count = Math.max(1, Math.min(samples, Math.floor((end - start) / step) + 1))
		const times: number[] = []
		const rightAscension: number[] = []
		const declination: number[] = []
		const altitude: number[] = []
		const sunlit: boolean[] = []

		for (let i = 0; i < count; i++) {
			const time = start + i * step
			const t = timeUnix(time / 1000, true)
			const geocentric = frameToFrame(sgp4(t, record)[0], TEME, ICRS, t)
			const relative = site ? vecMinus(geocentric, frameToFrame(itrs(site), ITRS, ICRS, t)) : geocentric
			const [ra, dec] = equatorial(frameToFrame(relative, ICRS, TRUE_EQUATOR_AND_EQUINOX_OF_DATE, t))
			times.push(time)
			rightAscension.push(normalizeAngle(ra))
			declination.push(dec)
			sunlit.push(satelliteShadowState(record, sunAt, t) !== 'umbra')
			if (site) altitude.push(Math.asin(Math.max(-1, Math.min(1, vecDot(frameToFrame(relative, ICRS, ITRS, t), zenith(site)) / vecLength(relative)))))
		}

		return site ? { times, rightAscension, declination, altitude, sunlit } : { times, rightAscension, declination, sunlit }
	}
}
