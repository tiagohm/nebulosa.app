import { carringtonRotationNumber, equationOfTime, type Season, season } from 'nebulosa/src/astronomy/bodies/sun'
import { equatorial } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { equatorialFromJ2000 } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { Solar } from 'nebulosa/src/astronomy/ephemeris/meeus'
import * as vsop from 'nebulosa/src/astronomy/ephemeris/models/analytical/vsop87e'
import { ASTRONOMICAL_TWILIGHT, CIVIL_TWILIGHT, NAUTICAL_TWILIGHT, SUN_HORIZON } from 'nebulosa/src/astronomy/events/horizon'
import { searchExtrema, searchIntervals, searchRoots } from 'nebulosa/src/astronomy/events/search'
import { type GeographicPosition, localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import { type Time, time as julianTime, timeShift, timeToUnixMillis, timeUnix, toJulianDay, tt } from 'nebulosa/src/astronomy/time/time'
import { TAU } from 'nebulosa/src/core/constants'
import { vecMinus } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizePI } from 'nebulosa/src/math/units/angle'
import { geographic, LruCache, type SkyObserver } from './ephemeris'

// Solar almanac of the Sun Inspector: the Sun's day for an observer's civil date in an IANA time zone
// (sunrise, transit, sunset, daylight, civil, nautical, and astronomical twilight, astronomical night),
// the next four equinoxes and solstices, and the equation of time and Carrington rotation at an instant.
// Everything is computed locally from the toolkit, never from the network. Rise and set and the
// twilight limits use the toolkit's almanac convention: the geometric, geocentric altitude of the
// Sun's center against SUN_HORIZON (−50′: the upper limb with standard refraction) and −6°, −12°, and
// −18°. Times are Unix milliseconds (UTC, converted from the toolkit's TT), durations seconds.

// Coarse step of the event searches in days (10 minutes): finer than any two crossings of one
// threshold, except grazing ones within minutes of a polar transition.
const SEARCH_STEP = 10 / 1440

// Offset in days at which the altitude is probed on each side of a crossing to tell rising from
// setting (one minute).
const SLOPE_PROBE = 1 / 1440

// How far after the astronomical dusk the next dawn is searched, in days (36 hours).
const NIGHT_SEARCH_WINDOW = 1.5

// One day in milliseconds.
const DAY_MS = 86_400_000

// Advance of the sidereal time in one UT day, in radians (IERS ratio of sidereal to solar day).
const SIDEREAL_RATE = TAU * 1.00273781191135448

// Local days kept in memory.
const LOCAL_DAY_CACHE_LIMIT = 64

// How the Sun's center relates to a threshold over a local day: crossing it both ways, only one way,
// or staying above or below it all day.
export type SolarDailyState = 'normal' | 'continuousAbove' | 'continuousBelow' | 'partial'

// Crossings of a twilight threshold during a local day.
export interface SolarTwilightCrossings {
	// Morning crossing upward (dawn), Unix milliseconds; absent when the Sun does not cross it upward.
	readonly dawn?: number
	// Evening crossing downward (dusk), Unix milliseconds; absent when the Sun does not cross it downward.
	readonly dusk?: number
	// Relation of the Sun to the threshold over the day.
	readonly state: SolarDailyState
}

// Astronomical night beginning on a local day: from the astronomical dusk to the next astronomical dawn.
export interface SolarAstronomicalNight {
	// Astronomical dusk of the day, Unix milliseconds; absent when the Sun does not go below −18° that evening.
	readonly start?: number
	// Next astronomical dawn after the start, Unix milliseconds; absent when not within 36 hours.
	readonly end?: number
	// Length of the night in seconds; present only with both start and end.
	readonly durationSeconds?: number
	// Relation of the Sun to −18° over the day.
	readonly state: SolarDailyState
}

// The Sun's day for an observer on a civil date.
export interface SunLocalDay {
	// Civil date in the requested time zone, YYYY-MM-DD.
	readonly localDate: string
	// First instant of the civil date, Unix milliseconds.
	readonly start: number
	// First instant of the next civil date, Unix milliseconds; days of 23 or 25 hours are kept as they are.
	readonly end: number
	// Sunrise, Unix milliseconds; absent when the Sun does not rise that day.
	readonly sunrise?: number
	// Upper transit (the highest altitude of the day), Unix milliseconds.
	readonly transit?: number
	// Geometric altitude of the Sun's center at the transit, in radians.
	readonly transitAltitude?: number
	// Sunset, Unix milliseconds; absent when the Sun does not set that day.
	readonly sunset?: number
	// Time the Sun is above the sunrise threshold during the day, in seconds; absent when it stays below.
	readonly daylightSeconds?: number
	// Relation of the Sun to the sunrise threshold over the day.
	readonly daylight: SolarDailyState
	// Civil twilight (−6°).
	readonly civil: SolarTwilightCrossings
	// Nautical twilight (−12°).
	readonly nautical: SolarTwilightCrossings
	// Astronomical twilight (−18°).
	readonly astronomical: SolarTwilightCrossings
	// Astronomical night beginning that evening.
	readonly astronomicalNight: SolarAstronomicalNight
}

// An equinox or solstice, named by its month so the name holds in both hemispheres.
export type SolarSeasonKind = 'marchEquinox' | 'juneSolstice' | 'septemberEquinox' | 'decemberSolstice'

// Instant of an equinox or solstice.
export interface SolarSeasonEvent {
	// Equinox or solstice.
	readonly kind: SolarSeasonKind
	// Instant, Unix milliseconds.
	readonly time: number
}

// Physical data of the Sun at an instant.
export interface SunPhysicalData {
	// Equation of time (apparent minus mean solar time) in seconds, positive when a sundial is ahead of the clock.
	readonly equationOfTimeSeconds: number
	// Carrington rotation in progress.
	readonly carringtonRotation: number
	// Where the values come from: the toolkit's local models.
	readonly source: 'local'
}

// Body of POST /api/sky/sun/almanac.
export interface SunAlmanacRequest {
	// Instant, Unix milliseconds: the instant the Sky clock shows.
	readonly time: number
	// Observer whose day is computed; without one there is no local day.
	readonly observer?: SkyObserver
	// IANA time zone that defines the civil date.
	readonly timeZone: string
}

// Solar almanac at an instant.
export interface SunAlmanacResponse {
	// Instant of the request, Unix milliseconds.
	readonly time: number
	// The Sun's day on the civil date of the instant; absent without an observer.
	readonly localDay?: SunLocalDay
	// The next four equinoxes and solstices strictly after the instant, in time order.
	readonly seasons: readonly SolarSeasonEvent[]
	// Physical data at the instant.
	readonly physical: SunPhysicalData
}

// Toolkit seasons in calendar order, with the month names used by the API.
const SEASONS: readonly (readonly [Season, SolarSeasonKind])[] = [
	['spring', 'marchEquinox'],
	['summer', 'juneSolstice'],
	['autumn', 'septemberEquinox'],
	['winter', 'decemberSolstice'],
]

// Civil date of a time zone: its YYYY-MM-DD name and its first and last-plus-one instants.
export interface ZonedDay {
	// Civil date, YYYY-MM-DD.
	readonly localDate: string
	// First instant of the date, Unix milliseconds.
	readonly start: number
	// First instant of the next date, Unix milliseconds.
	readonly end: number
}

// Formatters of wall-clock parts by time zone.
const partFormatters = new Map<string, Intl.DateTimeFormat>()

// Returns the wall-clock year, month (1–12), day, hour, minute, and second of an instant (Unix
// milliseconds) in a time zone. Seconds are truncated.
function wallParts(time: number, timeZone: string) {
	let formatter = partFormatters.get(timeZone)

	if (!formatter) {
		formatter = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
		partFormatters.set(timeZone, formatter)
	}

	const parts: Record<string, number> = {}
	for (const part of formatter.formatToParts(time)) if (part.type !== 'literal') parts[part.type] = +part.value
	return parts as Record<'year' | 'month' | 'day' | 'hour' | 'minute' | 'second', number>
}

// Returns the offset of a time zone from UTC at an instant, in milliseconds (east positive).
export function zoneOffset(time: number, timeZone: string) {
	const whole = Math.floor(time / 1000) * 1000
	const { year, month, day, hour, minute, second } = wallParts(whole, timeZone)
	return Date.UTC(year, month - 1, day, hour, minute, second) - whole
}

// Returns the first instant (Unix milliseconds) of a civil date in a time zone: its midnight, or the
// instant the clocks jump past a skipped midnight. `month` is 1–12; days past the month's end roll over.
function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
	const local = Date.UTC(year, month - 1, day)
	const candidates = [local - zoneOffset(local - DAY_MS, timeZone), local - zoneOffset(local + DAY_MS, timeZone)]
	const date = new Date(local)
	const valid = candidates.filter((time) => {
		const wall = wallParts(time, timeZone)
		return wall.year === date.getUTCFullYear() && wall.month === date.getUTCMonth() + 1 && wall.day === date.getUTCDate()
	})
	return Math.min(...(valid.length > 0 ? valid : candidates))
}

// Returns the civil date of an instant (Unix milliseconds) in an IANA time zone, with its real
// bounds: a day the clocks change is 23 or 25 hours long.
export function zonedDay(time: number, timeZone: string): ZonedDay {
	const { year, month, day } = wallParts(time, timeZone)
	const localDate = `${year}-${`${month}`.padStart(2, '0')}-${`${day}`.padStart(2, '0')}`
	return { localDate, start: zonedMidnight(year, month, day, timeZone), end: zonedMidnight(year, month, day + 1, timeZone) }
}

// Toolkit time of a Unix instant in milliseconds.
function toolkitTime(time: number) {
	return timeUnix(time / 1000, true)
}

// Geometric, geocentric altitude in radians of the Sun's center for a place, as altitudeOf computes
// it. The Sun's right ascension and declination of date and the local apparent sidereal time are
// computed exactly at whole UTC hours and interpolated in between (the sidereal time at the sidereal
// rate), which keeps the error far below a second of time while evaluating the ephemeris once per hour.
function sunAltitude(location: GeographicPosition) {
	const nodes = new Map<number, readonly [number, number, number]>()
	const sinLatitude = Math.sin(location.latitude)
	const cosLatitude = Math.cos(location.latitude)

	function node(hour: number) {
		let result = nodes.get(hour)

		if (!result) {
			const instant = julianTime(Math.floor(hour / 24), (hour % 24) / 24)
			const [ra2000, dec2000] = equatorial(vecMinus(vsop.sun(instant)[0], vsop.earth(instant)[0]))
			const [rightAscension, declination] = equatorialFromJ2000(ra2000, dec2000, instant)
			result = [rightAscension, declination, localSiderealTime(instant, location, false)]
			nodes.set(hour, result)
		}

		return result
	}

	return (instant: Time) => {
		const hours = (instant.day + instant.fraction) * 24
		const hour = Math.floor(hours)
		const f = hours - hour
		const [ra0, dec0, lst0] = node(hour)
		const [ra1, dec1] = node(hour + 1)
		const rightAscension = ra0 + normalizePI(ra1 - ra0) * f
		const declination = dec0 + (dec1 - dec0) * f
		const hourAngle = lst0 + (SIDEREAL_RATE * f) / 24 - rightAscension
		return Math.asin(sinLatitude * Math.sin(declination) + cosLatitude * Math.cos(declination) * Math.cos(hourAngle))
	}
}

// Upward and downward crossings of a threshold (radians) between two instants, in time order.
function crossingsOf(altitude: (time: Time) => number, threshold: number, start: Time, stop: Time) {
	const result: { readonly time: number; readonly rising: boolean }[] = []

	for (const root of searchRoots((time) => altitude(time) - threshold, start, stop, { step: SEARCH_STEP })) {
		const rising = altitude(timeShift(root, SLOPE_PROBE)) > altitude(timeShift(root, -SLOPE_PROBE))
		result.push({ time: timeToUnixMillis(root), rising })
	}

	return result
}

// Morning upward and evening downward crossings of a threshold (radians) during a day, with the
// state of the day: the first upward and the last downward crossing are kept, and a day without any
// is above or below the threshold at its middle.
function dailyCrossings(altitude: (time: Time) => number, threshold: number, start: Time, stop: Time, middle: Time) {
	const crossings = crossingsOf(altitude, threshold, start, stop)
	const up = crossings.find((e) => e.rising)?.time
	const down = crossings.findLast((e) => !e.rising)?.time
	const state: SolarDailyState = up !== undefined && down !== undefined ? 'normal' : up !== undefined || down !== undefined ? 'partial' : altitude(middle) >= threshold ? 'continuousAbove' : 'continuousBelow'
	return { up, down, state }
}

// Twilight crossings of a day for one threshold (radians).
function twilight(altitude: (time: Time) => number, threshold: number, start: Time, stop: Time, middle: Time): SolarTwilightCrossings {
	const { up, down, state } = dailyCrossings(altitude, threshold, start, stop, middle)
	return { dawn: up, dusk: down, state }
}

// Computes the Sun's day for a place over a civil date.
export function sunLocalDay(location: GeographicPosition, day: ZonedDay): SunLocalDay {
	const altitude = sunAltitude(location)
	const start = toolkitTime(day.start)
	const stop = toolkitTime(day.end)
	const middle = toolkitTime((day.start + day.end) / 2)

	const { up: sunrise, down: sunset, state: daylight } = dailyCrossings(altitude, SUN_HORIZON, start, stop, middle)

	let transit: number | undefined
	let transitAltitude: number | undefined

	for (const extremum of searchExtrema(altitude, start, stop, { step: SEARCH_STEP })) {
		if (extremum.kind === 'maximum' && (transitAltitude === undefined || extremum.value > transitAltitude)) {
			transit = timeToUnixMillis(extremum.time)
			transitAltitude = extremum.value
		}
	}

	let daylightSeconds: number | undefined

	if (daylight !== 'continuousBelow') {
		daylightSeconds = 0
		for (const interval of searchIntervals([(time) => altitude(time) - SUN_HORIZON], start, stop, { step: SEARCH_STEP })) {
			daylightSeconds += (timeToUnixMillis(interval.end) - timeToUnixMillis(interval.start)) / 1000
		}
	}

	const astronomical = twilight(altitude, ASTRONOMICAL_TWILIGHT, start, stop, middle)

	return {
		...day,
		sunrise,
		transit,
		transitAltitude,
		sunset,
		daylightSeconds,
		daylight,
		civil: twilight(altitude, CIVIL_TWILIGHT, start, stop, middle),
		nautical: twilight(altitude, NAUTICAL_TWILIGHT, start, stop, middle),
		astronomical,
		astronomicalNight: astronomicalNight(altitude, astronomical),
	}
}

// Astronomical night beginning with the day's astronomical dusk: the first upward crossing of −18°
// within 36 hours ends it.
function astronomicalNight(altitude: (time: Time) => number, { dusk, state }: SolarTwilightCrossings): SolarAstronomicalNight {
	if (dusk === undefined) return { state }

	const start = toolkitTime(dusk)
	const end = crossingsOf(altitude, ASTRONOMICAL_TWILIGHT, timeShift(start, SLOPE_PROBE), timeShift(start, NIGHT_SEARCH_WINDOW)).find((e) => e.rising)?.time
	return { start: dusk, end, durationSeconds: end === undefined ? undefined : (end - dusk) / 1000, state }
}

// Returns the next four equinoxes and solstices strictly after an instant (Unix milliseconds).
export function nextSeasons(time: number): SolarSeasonEvent[] {
	const year = new Date(time).getUTCFullYear()
	const events: SolarSeasonEvent[] = []

	for (const y of [year, year + 1]) {
		for (const [name, kind] of SEASONS) {
			const instant = timeToUnixMillis(season(y, name))
			if (instant > time) events.push({ kind, time: instant })
		}
	}

	return events.sort((a, b) => a.time - b.time).slice(0, 4)
}

// Returns the equation of time and the Carrington rotation at an instant (Unix milliseconds). The
// equation of time takes the Sun's apparent geocentric right ascension of date, with nutation and
// aberration, never the observer's topocentric one.
export function sunPhysicalData(time: number): SunPhysicalData {
	const instant = toolkitTime(time)
	const dynamical = tt(instant)
	const [rightAscension] = Solar.apparentEquatorialVSOP87(toJulianDay(dynamical))
	const equationOfTimeSeconds = (equationOfTime(instant, rightAscension) / TAU) * 86_400
	return { equationOfTimeSeconds, carringtonRotation: carringtonRotationNumber(dynamical), source: 'local' }
}

// Solar almanac service, caching the local days it computes.
export class SunAlmanac {
	readonly #days = new LruCache<SunLocalDay>(LOCAL_DAY_CACHE_LIMIT)

	// Computes the almanac of a request.
	almanac({ time, observer, timeZone }: SunAlmanacRequest): SunAlmanacResponse {
		return { time, localDay: observer && this.localDay(time, observer, timeZone), seasons: nextSeasons(time), physical: sunPhysicalData(time) }
	}

	// Returns the Sun's day of an observer on the civil date of an instant (Unix milliseconds) in a time zone.
	localDay(time: number, observer: SkyObserver, timeZone: string) {
		const day = zonedDay(time, timeZone)
		const key = `${day.localDate}|${timeZone}|${observer.latitude}|${observer.longitude}|${observer.elevation}`
		let result = this.#days.get(key)

		if (!result) {
			result = sunLocalDay(geographic(observer), day)
			this.#days.set(key, result)
		}

		return result
	}
}

// Creates the solar almanac routes.
export function createSunAlmanacRoutes(service: SunAlmanac) {
	return {
		'/api/sky/sun/almanac': {
			// Solar almanac at the instant of the body (SunAlmanacRequest), with the observer's day when there is one.
			POST: async (req) => Response.json(service.almanac((await req.json()) as SunAlmanacRequest) satisfies SunAlmanacResponse),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
