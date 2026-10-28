import { type LunarPhase, lunation, moonParallax, nearestLunarApsis, nearestLunarPhase } from 'nebulosa/src/astronomy/bodies/moon'
import { MOON_ROTATION, bodyFixedMatrix, positionAngleOfPole, subObserverPoint, subSolarPoint } from 'nebulosa/src/astronomy/bodies/orientation'
import { cirsToObserved, icrsToCirs, lightTime, parallacticAngle, topocentricDirection } from 'nebulosa/src/astronomy/coordinates/astrometry'
import * as elpmpp02 from 'nebulosa/src/astronomy/ephemeris/models/analytical/elpmpp02'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { precessionNutationMatrix, type Time, timeShift, timeToUnixMillis } from 'nebulosa/src/astronomy/time/time'
import { AU_KM, ECLIPTIC_J2000_MATRIX, TAU } from 'nebulosa/src/core/constants'
import { type Mat3, matMul, matMulVec, matTranspose } from 'nebulosa/src/math/linear-algebra/mat3'
import { type MutVec3, type Vec3, vecAngle, vecCross, vecLength, vecMinus, vecNegate, vecNormalize } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle, normalizePI } from 'nebulosa/src/math/units/angle'
import { bodyModel, makeTime, observerBarycentric, type SkyObserver } from './ephemeris'

// Lunar almanac of the Moon Inspector: the Moon's appearance at an instant (phase, illuminated
// fraction, age, apparent size, optical and physical libration, the orientation of its pole and bright
// limb, and the rotation that draws its surface as the observer sees it), the next four principal
// phases, and the next perigee and apogee. Everything is computed locally from the toolkit (ELPMPP02 for
// the Moon, VSOP87E for the Earth and the Sun, the IAU rotation model of the Moon, Meeus' phase and
// apsis series), never from the network, so it may differ slightly from the Horizons position of the
// Sky selection. The appearance is topocentric with an observer and geocentric without one; the phases
// and apsides are geocentric events. Times are Unix milliseconds (UTC, converted from the toolkit's TT),
// angles radians, distances kilometers.

// IAU mean radius of the Moon in km.
const MOON_RADIUS_KM = 1737.4

// One day in milliseconds.
const DAY_MS = 86_400_000

// Half-width in radians of the window of Moon−Sun ecliptic longitude difference named after a principal
// phase: half a day of the mean synodic motion (360° / 29.530589 d / 2 ≈ 6.1°).
const PRINCIPAL_PHASE_HALF_WIDTH = TAU / 29.530589 / 2

// Light-time iterations of the observer→Moon direction; two converge to well under a millisecond.
const LIGHT_TIME_ITERATIONS = 2

// Calendars kept in memory: one per validity interval, a few per tab moving through time.
const CALENDAR_CACHE_LIMIT = 8

// Name of the Moon's phase for people: a principal phase within PRINCIPAL_PHASE_HALF_WIDTH of its
// instant, otherwise the crescent or gibbous Moon between them.
export type MoonPhaseName = 'newMoon' | 'waxingCrescent' | 'firstQuarter' | 'waxingGibbous' | 'fullMoon' | 'waningGibbous' | 'lastQuarter' | 'waningCrescent'

// A principal phase of the Moon.
export type MoonPrincipalPhase = 'newMoon' | 'firstQuarter' | 'fullMoon' | 'lastQuarter'

// A point of the Moon's surface in planetocentric coordinates.
export interface MoonSurfacePoint {
	// East longitude from the IAU prime meridian, in radians, in (−π, π].
	readonly longitude: number
	// Latitude, north positive, in radians.
	readonly latitude: number
}

// How the Moon looks at an instant, for an observer or the geocenter.
export interface MoonAppearance {
	// Whether the view is the observer's or the geocenter's.
	readonly center: 'topocentric' | 'geocentric'
	// Illuminated fraction of the disk, 0 to 1.
	readonly illuminatedFraction: number
	// Sun–Moon–observer angle, in radians, 0 (full) to π (new).
	readonly phaseAngle: number
	// Geocentric ecliptic longitude of the Moon minus that of the Sun, in radians, in [0, 2π): 0 new, π/2
	// first quarter, π full, 3π/2 last quarter.
	readonly elongation: number
	// Name of the phase.
	readonly phase: MoonPhaseName
	// Days since the previous geocentric new Moon.
	readonly ageDays: number
	// Brown lunation number of the lunation in progress.
	readonly lunation: number
	// Distance from the observer (or the geocenter) to the Moon's center, in km.
	readonly distanceKm: number
	// Apparent angular diameter from that distance, in radians.
	readonly angularDiameter: number
	// Equatorial horizontal parallax, from the geocentric distance, in radians.
	readonly horizontalParallax: number
	// Sub-observer point: the center of the disk, whose offset from (0, 0) is the libration in longitude
	// and latitude (optical and physical, and diurnal with an observer).
	readonly subObserver: MoonSurfacePoint
	// Sub-solar point.
	readonly subSolar: MoonSurfacePoint
	// Selenographic colongitude of the Sun (90° minus the sub-solar east longitude), in radians, in [0, 2π):
	// about 270° at new Moon, 0° at first quarter, 90° at full Moon, and 180° at last quarter.
	readonly colongitude: number
	// Position angle of the Moon's north pole, from celestial north through east, in radians, in (−π, π].
	readonly poleAngle: number
	// Position angle of the midpoint of the bright limb, from celestial north through east, in radians,
	// in [0, 2π).
	readonly brightLimbAngle: number
	// Parallactic angle (position angle of the zenith from celestial north through east) at the Moon's
	// center, in radians, in (−π, π]; absent without an observer. Rotating the north-up view by −q puts the
	// zenith up.
	readonly parallacticAngle?: number
	// Rotation from the Moon's body-fixed frame (+Z north pole, +X prime meridian) to the north-up view
	// frame (+X right, which is celestial west, +Y celestial north, +Z toward the viewer), row-major. A
	// surface point p is on the visible hemisphere when (M·p).z > 0, and its orthographic position on the
	// disk is ((M·p).x, (M·p).y) in Moon radii.
	readonly bodyToCamera: Mat3
	// Unit vector from the Moon's center to the Sun in the body-fixed frame; a surface point p is lit when
	// p · sunDirection > 0.
	readonly sunDirection: Vec3
}

// A principal phase.
export interface MoonPhaseEvent {
	// Which phase.
	readonly kind: MoonPrincipalPhase
	// Instant, Unix milliseconds.
	readonly time: number
}

// A perigee or apogee of the Moon, geocentric.
export interface MoonApsisEvent {
	// Which apsis.
	readonly kind: 'perigee' | 'apogee'
	// Instant, Unix milliseconds.
	readonly time: number
	// Geocentric distance of the Moon's center, in km.
	readonly distanceKm: number
	// Apparent angular diameter from the geocenter, in radians.
	readonly angularDiameter: number
}

// Body of POST /api/sky/moon/almanac.
export interface MoonAlmanacRequest {
	// Instant, Unix milliseconds: the instant the Sky clock shows.
	readonly time: number
	// Observer whose view is computed; the geocenter's without one.
	readonly observer?: SkyObserver
}

// Lunar almanac at an instant.
export interface MoonAlmanacResponse {
	// Instant of the request, Unix milliseconds.
	readonly time: number
	// The Moon's appearance at the instant.
	readonly appearance: MoonAppearance
	// The next four principal phases strictly after the instant, in time order.
	readonly phases: readonly MoonPhaseEvent[]
	// The next perigee and the next apogee strictly after the instant, in time order.
	readonly apsides: readonly MoonApsisEvent[]
	// Where the values come from: the toolkit's local models.
	readonly source: 'local'
}

// Phase and apsis events of an instant, which hold from the previous new Moon until the first event.
interface MoonCalendar {
	// Previous geocentric new Moon at or before the instants it serves, Unix milliseconds.
	readonly from: number
	// First event after the instants it serves, Unix milliseconds; the calendar holds strictly before it.
	readonly until: number
	// The next four principal phases.
	readonly phases: readonly MoonPhaseEvent[]
	// The next perigee and apogee.
	readonly apsides: readonly MoonApsisEvent[]
}

// Toolkit phases in calendar order, with the names used by the API.
const PHASES: readonly (readonly [LunarPhase, MoonPrincipalPhase])[] = [
	['NEW', 'newMoon'],
	['FIRST_QUARTER', 'firstQuarter'],
	['FULL', 'fullMoon'],
	['LAST_QUARTER', 'lastQuarter'],
]

// Returns the name of the phase at a Moon−Sun ecliptic longitude difference in [0, 2π).
export function moonPhaseName(elongation: number): MoonPhaseName {
	const near = (center: number) => Math.abs(normalizePI(elongation - center)) <= PRINCIPAL_PHASE_HALF_WIDTH
	if (near(0)) return 'newMoon'
	if (near(TAU / 4)) return 'firstQuarter'
	if (near(TAU / 2)) return 'fullMoon'
	if (near((3 * TAU) / 4)) return 'lastQuarter'
	if (elongation < TAU / 4) return 'waxingCrescent'
	if (elongation < TAU / 2) return 'waxingGibbous'
	if (elongation < (3 * TAU) / 4) return 'waningGibbous'
	return 'waningCrescent'
}

// Returns the ecliptic longitude (J2000 ecliptic) of an ICRS vector, in radians.
function eclipticLongitude(vector: Vec3) {
	const [x, y] = matMulVec(ECLIPTIC_J2000_MATRIX, vector)
	return Math.atan2(y, x)
}

// Returns the position angle, from north through east, of a direction in the north-up view frame.
function viewPositionAngle([x, y]: Vec3) {
	return Math.atan2(-x, y)
}

// Returns a body-fixed surface point with its longitude in (−π, π].
function surfacePoint({ longitude, latitude }: { readonly longitude: number; readonly latitude: number }): MoonSurfacePoint {
	return { longitude: normalizePI(longitude), latitude }
}

// Returns the rotation from ICRS to the north-up view frame of a body seen along `direction` (observer
// to body, ICRS): +X celestial west, +Y celestial north of date, +Z toward the observer.
export function northUpView(direction: Vec3, time: Time): Mat3 {
	const pnm = precessionNutationMatrix(time)
	const pole: Vec3 = [pnm[6], pnm[7], pnm[8]]
	const line = vecNormalize(direction)
	const east = vecNormalize(vecCross(pole, line))
	const north = vecCross(line, east)
	return [-east[0], -east[1], -east[2], north[0], north[1], north[2], -line[0], -line[1], -line[2]]
}

// Computes the Moon's appearance at an instant (Unix milliseconds) for an observer, or the geocenter.
export function moonAppearance(time: number, observer?: SkyObserver): MoonAppearance {
	const instant = makeTime(time, observer)
	const model = bodyModel('301')
	const direction: MutVec3 = [0, 0, 0]
	topocentricDirection(model, observerBarycentric, instant, LIGHT_TIME_ITERATIONS, direction)

	const emission = timeShift(instant, -lightTime(direction))
	const moon = model(emission)[0]
	const moonToSun = vecMinus(vsop.sun(emission)[0], moon)
	const moonToObserver = vecNegate(direction)
	const phaseAngle = vecAngle(moonToSun, moonToObserver)
	const distanceAu = vecLength(direction)

	// Geocentric ecliptic longitudes, enough to name the phase.
	const earth = vsop.earth(instant)[0]
	const elongation = normalizeAngle(eclipticLongitude(elpmpp02.moon(instant)[0]) - eclipticLongitude(vecMinus(vsop.sun(instant)[0], earth)))
	const geocentricDistanceAu = vecLength(elpmpp02.moon(instant)[0])

	const bodyFixed = bodyFixedMatrix(MOON_ROTATION, emission)
	const view = northUpView(direction, instant)
	const bodyToCamera = matMul(view, matTranspose(bodyFixed))
	const sunDirection = vecNormalize(matMulVec(bodyFixed, moonToSun))
	const subSolar = surfacePoint(subSolarPoint(MOON_ROTATION, instant, moonToObserver, moonToSun))

	const previousNew = timeToUnixMillis(nearestLunarPhase(instant, 'NEW', false))

	let parallactic: number | undefined

	if (observer && instant.location) {
		const [rightAscension, declination] = icrsToCirs(direction, instant, vsop.earth(instant))
		const { hourAngle } = cirsToObserved([rightAscension, declination], instant, false)
		parallactic = parallacticAngle(hourAngle, declination, instant.location.latitude)
	}

	return {
		center: observer ? 'topocentric' : 'geocentric',
		illuminatedFraction: (1 + Math.cos(phaseAngle)) / 2,
		phaseAngle,
		elongation,
		phase: moonPhaseName(elongation),
		ageDays: (time - previousNew) / DAY_MS,
		lunation: lunation(instant),
		distanceKm: distanceAu * AU_KM,
		angularDiameter: 2 * Math.asin(MOON_RADIUS_KM / (distanceAu * AU_KM)),
		horizontalParallax: moonParallax(geocentricDistanceAu),
		subObserver: surfacePoint(subObserverPoint(MOON_ROTATION, instant, moonToObserver)),
		subSolar,
		colongitude: normalizeAngle(TAU / 4 - subSolar.longitude),
		poleAngle: positionAngleOfPole(MOON_ROTATION, instant, moonToObserver),
		brightLimbAngle: normalizeAngle(viewPositionAngle(matMulVec(view, moonToSun))),
		parallacticAngle: parallactic,
		bodyToCamera,
		sunDirection,
	}
}

// Returns the first event a toolkit search finds strictly after an instant (Unix milliseconds), with its
// Unix milliseconds. An event within the instant's millisecond is truncated to it, so the search starts
// again an hour after it.
function eventAfter<T extends readonly unknown[] | Time>(time: number, search: (instant: Time) => T, timeOf: (event: T) => Time) {
	let event = search(makeTime(time))
	let at = timeToUnixMillis(timeOf(event))

	if (at <= time) {
		event = search(timeShift(timeOf(event), 1 / 24))
		at = timeToUnixMillis(timeOf(event))
	}

	return { event, at }
}

// Computes the phases and apsides that follow an instant (Unix milliseconds), with the interval in which
// they stay the next ones.
export function moonCalendar(time: number): MoonCalendar {
	const instant = makeTime(time)
	const phases = PHASES.map(([phase, kind]) => ({
		kind,
		time: eventAfter(
			time,
			(t) => nearestLunarPhase(t, phase, true),
			(e) => e,
		).at,
	})).sort((a, b) => a.time - b.time)
	const apsides = (['perigee', 'apogee'] as const)
		.map((kind) => {
			const { event, at } = eventAfter(
				time,
				(t) => nearestLunarApsis(t, kind === 'perigee' ? 'PERIGEE' : 'APOGEE', true),
				(e) => e[0],
			)
			return { kind, time: at, distanceKm: event[1] * AU_KM, angularDiameter: event[2] }
		})
		.sort((a, b) => a.time - b.time)
	const from = timeToUnixMillis(nearestLunarPhase(instant, 'NEW', false))
	return { from, until: Math.min(phases[0].time, apsides[0].time), phases, apsides }
}

// Lunar almanac service, caching the calendars it computes by the interval in which they hold.
export class MoonAlmanac {
	readonly #calendars: MoonCalendar[] = []

	// Computes the almanac of a request.
	almanac({ time, observer }: MoonAlmanacRequest): MoonAlmanacResponse {
		const { phases, apsides } = this.calendar(time)
		return { time, appearance: moonAppearance(time, observer), phases, apsides, source: 'local' }
	}

	// Returns the calendar of an instant (Unix milliseconds), computing it only when no cached one holds.
	calendar(time: number): MoonCalendar {
		const index = this.#calendars.findIndex((e) => e.from <= time && time < e.until)

		if (index >= 0) {
			const [calendar] = this.#calendars.splice(index, 1)
			this.#calendars.push(calendar)
			return calendar
		}

		const calendar = moonCalendar(time)
		this.#calendars.push(calendar)
		if (this.#calendars.length > CALENDAR_CACHE_LIMIT) this.#calendars.shift()
		return calendar
	}
}

// Creates the lunar almanac routes.
export function createMoonAlmanacRoutes(service: MoonAlmanac) {
	return {
		'/api/sky/moon/almanac': {
			// Lunar almanac at the instant of the body (MoonAlmanacRequest), seen by the observer when there is one.
			POST: async (req) => Response.json(service.almanac((await req.json()) as MoonAlmanacRequest) satisfies MoonAlmanacResponse),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
