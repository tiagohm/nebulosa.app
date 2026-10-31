import { eraCalToJd, eraEpb, LEAP_SECOND_CHANGES } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { hourAngle } from 'nebulosa/src/astronomy/events/hourangle'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
// oxfmt-ignore
import { dut1, greenwichApparentSiderealTime, greenwichMeanSiderealTime, type Time, taiMinusUtc, time, timeBesselianYear, timeConvert, timeJulianYear, Timescale, timeToDate, timeUnix, timeYMDHMS, toJulianDay, toJulianEpoch, tt, ut1, utc, utcLeapSeconds } from 'nebulosa/src/astronomy/time/time'
import { DAYSEC, SIDEREAL_DRIFT_RATE } from 'nebulosa/src/core/constants'
import { type EarthOrientationCoverage, EarthOrientationData } from './astronomicaltime.eop'
import { errorResponse } from './http'
import { geographic, type SkyObserver } from './sky/ephemeris'
import { zoneOffset } from './sky/sun'

// Astronomical Time Converter: stateless, read-only conversions of an instant between civil calendars, Unix time, Julian
// dates, epochs, and the seven timescales of the toolkit, with sidereal time and hour angle at an observer, and the
// real-time reference of the status bar clock. The toolkit is the only source of astronomy; this module only reads
// inputs into its split `Time` and formats what it answers, so no value goes through one floating-point Julian date. The
// caller sends valid fields; the only failures are civil readings that name no single instant. Calendars are proleptic
// Gregorian with astronomical year numbering. Angles are radians, as in the sky API.

// Name of a timescale of the toolkit.
export type TimeScaleName = 'UT1' | 'UTC' | 'TAI' | 'TT' | 'TCG' | 'TDB' | 'TCB'

// What the fields of a calendar reading are read in: a timescale's own calendar, a fixed offset from UTC in minutes
// (east positive), or a named IANA zone, with the occurrence to take of a reading the clocks repeat.
export type CalendarReference = { readonly kind: 'scale'; readonly scale: TimeScaleName } | { readonly kind: 'offset'; readonly minutes: number } | { readonly kind: 'zone'; readonly timeZone: string; readonly fold?: 'earlier' | 'later' }

// Instant to convert. Julian dates are decimal text, so no digit is lost before they are split into day and fraction, and
// epochs are in TT. Unix time is POSIX seconds, tied to UTC.
export type AstronomicalTimeInput =
	| { readonly kind: 'now' }
	| {
			readonly kind: 'calendar'
			// Astronomical year, [-4712, 9999].
			readonly year: number
			// Month, 1-12.
			readonly month: number
			// Day of the month, 1-31.
			readonly day: number
			// Hour, 0-23.
			readonly hour: number
			// Minute, 0-59.
			readonly minute: number
			// Second, fractional, below 60 except for an inserted leap second.
			readonly second: number
			// What the fields are read in.
			readonly reference: CalendarReference
	  }
	| { readonly kind: 'jd' | 'mjd'; readonly value: string; readonly scale: TimeScaleName }
	| { readonly kind: 'unix'; readonly seconds: number }
	| { readonly kind: 'julianEpoch' | 'besselianEpoch'; readonly value: number }

// Conversion of one instant.
export interface AstronomicalTimeRequest {
	// Instant to convert.
	readonly input: AstronomicalTimeInput
	// Observer of the local sidereal times and the topocentric TDB; absent for Greenwich values alone.
	readonly observer?: SkyObserver
	// IANA time zone of the local calendar; the caller's, since the server does not know it.
	readonly timeZone: string
	// Apparent right ascension of date of the target of the hour angle, in radians; needs an observer.
	readonly rightAscension?: number
}

// Reading of an instant in one timescale.
export interface TimeScaleReading {
	// Calendar of the scale, such as "2026-10-31T12:00:00.000", to the millisecond.
	readonly calendar: string
	// Julian date in the scale, to nine decimals. In UTC it is the ERFA quasi-JD, whose leap-second days are stretched.
	readonly jd: string
	// Modified Julian date in the scale, to nine decimals.
	readonly mjd: string
}

// What the leap-second table says of an instant:
// - tabulated: the table covers it.
// - beforeUtc: before 1960, when UTC did not exist, so TAI-UTC is taken as 0.
// - assumed: in the future of the server, assuming no leap second is added after the last one known.
export type LeapSecondStatus = 'tabulated' | 'beforeUtc' | 'assumed'

// How far the values of a conversion can be trusted.
export interface AstronomicalTimeQuality {
	// Earth orientation data of the instant. Unless covered, UT1 is taken as UTC, so UT1 and every sidereal time are approximate.
	readonly eop: EarthOrientationCoverage
	// Leap-second knowledge of the instant.
	readonly leapSeconds: LeapSecondStatus
}

// Result of a conversion.
export interface AstronomicalTimeResult {
	// Civil readings of the instant.
	readonly civil: {
		// Local calendar in the requested zone.
		readonly local: string
		// Offset of the local calendar from UTC at the instant, in seconds, east positive.
		readonly offsetSeconds: number
		// POSIX Unix milliseconds; absent inside an inserted leap second, which POSIX cannot represent.
		readonly unixMillis?: number
		// Whether the instant is inside an inserted leap second.
		readonly leapSecond: boolean
		// Whether the UTC day of the instant has a leap second, so JD(UTC) is on a stretched ERFA quasi-JD day.
		readonly leapSecondDay: boolean
	}
	// The instant in each timescale.
	readonly scales: Readonly<Record<TimeScaleName, TimeScaleReading>>
	// Sidereal times in radians, [0, 2π); the local ones need an observer.
	readonly sidereal: {
		// Greenwich mean sidereal time (IAU 2006).
		readonly gmst: number
		// Greenwich apparent sidereal time (IAU 2006/2000A).
		readonly gast: number
		// Local mean sidereal time.
		readonly lmst?: number
		// Local apparent sidereal time.
		readonly last?: number
	}
	// Differences between scales in seconds; those that depend on UT1 are absent unless the EOP data cover the instant.
	readonly offsets: {
		// UT1 - UTC.
		readonly dut1?: number
		// TAI - UTC; absent before UTC existed.
		readonly taiMinusUtc?: number
		// TT - UT1.
		readonly ttMinusUt1?: number
		// TDB - TT, topocentric with an observer.
		readonly tdbMinusTt: number
	}
	// Epochs and calendar position of the instant.
	readonly epochs: {
		// Julian epoch in TT.
		readonly julian: number
		// Besselian epoch in TT.
		readonly besselian: number
		// Day of the UTC year, 1-366.
		readonly dayOfYear: number
	}
	// Signed hour angle LAST - RA in radians, (-π, π], positive west of the meridian; needs an observer and a right ascension.
	readonly hourAngle?: number
	// How far the values can be trusted.
	readonly quality: AstronomicalTimeQuality
}

// Real-time reference of the status bar clock.
export interface AstronomicalTimeReferenceRequest {
	// Observer of the local sidereal times; absent for none.
	readonly observer?: SkyObserver
}

// Real-time sample a client extrapolates between requests.
export interface AstronomicalTimeReference {
	// Real current time of the server, Unix milliseconds.
	readonly unixMillis: number
	// Julian date (UTC) of the sample.
	readonly jd: number
	// Local mean sidereal time of the sample in radians, with an observer.
	readonly lmst?: number
	// Local apparent sidereal time of the sample in radians, with an observer.
	readonly last?: number
	// Advance of sidereal time in radians per second of time.
	readonly siderealRate: number
	// How far the sample can be trusted.
	readonly quality: AstronomicalTimeQuality
}

// Stable codes of the errors of the converter: a civil reading the clocks repeat, and a reading that never existed.
export type AstronomicalTimeErrorCode = 'ambiguousLocalTime' | 'nonexistentTime'

// A reading that names no single instant.
export type AstronomicalTimeRefusal =
	// The clocks show the reading twice; the two instants are Unix milliseconds.
	| { readonly refusal: 'ambiguousLocalTime'; readonly earlier: number; readonly later: number }
	// The clocks skipped the reading, or it is a :60 on a day without a leap second.
	| { readonly refusal: 'nonexistentTime' }

// Timescale of the toolkit of each name, in display order.
const TIME_SCALES: Readonly<Record<TimeScaleName, Timescale>> = { UT1: Timescale.UT1, UTC: Timescale.UTC, TAI: Timescale.TAI, TT: Timescale.TT, TCG: Timescale.TCG, TDB: Timescale.TDB, TCB: Timescale.TCB }

// Decimals of a Julian date: 1e-9 day is 86 µs, the same order as the representation of a day fraction near 1 for a value
// that is still meaningful after rounding.
const JULIAN_DECIMALS = 9

// Milliseconds in one day.
const DAY_MS = DAYSEC * 1000

// Julian date of MJD 0, as the integer day and fraction that keep it exact.
const MJD_DAY = 2400000
const MJD_FRACTION = 0.5

// Unix milliseconds of 0100-01-01, the earliest instant `zoneOffset` reads: `Intl` loses the sign of years BCE and
// `Date.UTC` remaps years below 100. Every IANA zone keeps its constant local mean time long before this date.
const EARLIEST_ZONE_TIME = -59011459200000

// Returns the Unix milliseconds of a proleptic Gregorian civil reading. Unlike Date.UTC, it takes years below 100 as they are.
function civilMillis(year: number, month: number, day: number, hour: number = 0, minute: number = 0) {
	const date = new Date(0)
	date.setUTCFullYear(year, month - 1, day)
	date.setUTCHours(hour, minute)
	return date.getTime()
}

// Returns the offset of a zone at an instant (Unix milliseconds), in milliseconds, east positive.
function offsetAt(time: number, timeZone: string) {
	return zoneOffset(Math.max(time, EARLIEST_ZONE_TIME), timeZone)
}

// Splits decimal text into a whole and a fraction of the same sign, so no digit is lost to a single float.
function splitDecimal(value: string): readonly [number, number] {
	const negative = value.startsWith('-')
	const [whole, digits = ''] = value.replace('-', '').split('.')
	const sign = negative ? -1 : 1
	return [sign * Number(whole), sign * Number(`0.${digits}`)]
}

// Formats a whole and a fraction as decimal text with JULIAN_DECIMALS decimals, carrying a fraction that rounds up.
function formatDecimal(whole: number, fraction: number) {
	const carry = Math.floor(fraction)
	let day = whole + carry
	let part = fraction - carry
	let sign = ''

	if (day < 0 && part > 0) {
		sign = '-'
		day = -day - 1
		part = 1 - part
	} else if (day < 0) {
		sign = '-'
		day = -day
	}

	const text = part.toFixed(JULIAN_DECIMALS)
	return `${sign}${text.startsWith('1') ? day + 1 : day}${text.slice(1)}`
}

// Formats civil fields, with the year in astronomical numbering of at least four digits.
function formatCalendar(year: number, month: number, day: number, hour: number, minute: number, second: number, millisecond: number) {
	const yearText = `${year < 0 ? '-' : ''}${String(Math.abs(year)).padStart(4, '0')}`
	const pad = (value: number, length: number = 2) => String(value).padStart(length, '0')
	return `${yearText}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}.${pad(millisecond, 3)}`
}

// Reading of an instant in one scale.
function scaleReading(instant: Time, scale: Timescale): TimeScaleReading {
	const value = timeConvert(instant, scale)
	return { calendar: formatCalendar(...timeToDate(value)), jd: formatDecimal(value.day, value.fraction), mjd: formatDecimal(value.day - MJD_DAY - 1, value.fraction + MJD_FRACTION) }
}

// Seconds from b to a, read through their Julian dates in their own scales.
function secondsBetween(a: Time, b: Time) {
	return (a.day - b.day + (a.fraction - b.fraction)) * DAYSEC
}

// Returns a UTC instant of civil fields already in UTC. The minute fields come from `millis` and the seconds are added to
// them, so an inserted :60 is kept; a second that no day has is refused.
function utcInstant(millis: number, second: number): Time | undefined {
	const date = new Date(millis)
	const [year, month, day, hour, minute] = [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes()]
	const total = date.getUTCSeconds() + second
	const allowed = hour === 23 && minute === 59 ? 60 + Math.max(0, utcLeapSeconds(year, month, day)) : 60
	return total < allowed ? timeYMDHMS(year, month, day, hour, minute, total, Timescale.UTC) : undefined
}

// Returns the Unix milliseconds of a local reading in an IANA zone, or why it names no single instant. `local` holds the
// fields read as if they were UTC.
function zonedMillis(local: number, timeZone: string, fold: 'earlier' | 'later' | undefined): number | AstronomicalTimeRefusal {
	const before = local - offsetAt(local - DAY_MS, timeZone)
	const after = local - offsetAt(local + DAY_MS, timeZone)
	const valid = [...new Set([before, after])].filter((time) => time + offsetAt(time, timeZone) === local)
	if (valid.length === 0) return { refusal: 'nonexistentTime' }
	if (valid.length === 1) return valid[0]
	const earlier = Math.min(...valid)
	const later = Math.max(...valid)
	return fold === undefined ? { refusal: 'ambiguousLocalTime', earlier, later } : fold === 'earlier' ? earlier : later
}

// Returns the instant of a calendar reading, or why it names no single instant.
function calendarInstant(input: Extract<AstronomicalTimeInput, { kind: 'calendar' }>): Time | AstronomicalTimeRefusal {
	const { year, month, day, hour, minute, second, reference } = input

	if (reference.kind === 'scale') {
		if (reference.scale === 'UTC') return utcInstant(civilMillis(year, month, day, hour, minute), second) ?? { refusal: 'nonexistentTime' }
		return second < 60 ? timeYMDHMS(year, month, day, hour, minute, second, TIME_SCALES[reference.scale]) : { refusal: 'nonexistentTime' }
	}

	const local = civilMillis(year, month, day, hour, minute)
	const millis = reference.kind === 'offset' ? local - reference.minutes * 60000 : zonedMillis(local, reference.timeZone, reference.fold)
	if (typeof millis !== 'number') return millis
	return utcInstant(millis, second) ?? { refusal: 'nonexistentTime' }
}

// Astronomical Time Converter.
export class AstronomicalTimeService {
	// Creates the converter over its Earth orientation data and its clock (Unix milliseconds).
	constructor(
		private readonly eop: EarthOrientationData = new EarthOrientationData(),
		private readonly now: () => number = Date.now,
	) {}

	// Returns the toolkit instant of an input, or why it names no single instant.
	#instant(input: AstronomicalTimeInput): Time | AstronomicalTimeRefusal {
		switch (input.kind) {
			case 'now':
				return timeUnix(this.now() / 1000)
			case 'calendar':
				return calendarInstant(input)
			case 'jd': {
				const [day, fraction] = splitDecimal(input.value)
				return time(day, fraction, TIME_SCALES[input.scale])
			}
			case 'mjd': {
				const [day, fraction] = splitDecimal(input.value)
				return time(day + MJD_DAY, fraction + MJD_FRACTION, TIME_SCALES[input.scale])
			}
			case 'unix':
				return timeUnix(input.seconds)
			case 'julianEpoch':
				return timeJulianYear(input.value)
			case 'besselianEpoch':
				return timeBesselianYear(input.value)
		}
	}

	// Binds an instant to the Earth orientation data of the converter and to the observer's site.
	#bind(instant: Time, observer: SkyObserver | undefined) {
		instant.providers = this.eop.providers
		if (observer) instant.location = geographic(observer)
		return instant
	}

	// Returns how far the values of an instant can be trusted.
	#quality(instant: Time): AstronomicalTimeQuality {
		const [year] = timeToDate(utc(instant))
		const leapSeconds = year < LEAP_SECOND_CHANGES[0][0] ? 'beforeUtc' : toJulianDay(utc(instant)) > toJulianDay(timeUnix(this.now() / 1000)) ? 'assumed' : 'tabulated'
		return { eop: this.eop.coverage(utc(instant)), leapSeconds }
	}

	// Converts an instant, or answers why its reading names no single instant.
	async convert({ input, observer, timeZone, rightAscension }: AstronomicalTimeRequest): Promise<AstronomicalTimeResult | AstronomicalTimeRefusal> {
		await this.eop.prepare()

		const unbound = this.#instant(input)
		if ('refusal' in unbound) return unbound

		const instant = this.#bind(unbound, observer)
		const utcTime = utc(instant)
		const location = instant.location
		const [year, month, day, hour, minute, second, millisecond] = timeToDate(utcTime)
		const leapSecond = second >= 60
		const base = civilMillis(year, month, day, hour, minute)
		const unixMillis = base + second * 1000 + millisecond
		const offset = offsetAt(unixMillis, timeZone)
		const wall = new Date((leapSecond ? base : unixMillis) + offset)
		const local = formatCalendar(wall.getUTCFullYear(), wall.getUTCMonth() + 1, wall.getUTCDate(), wall.getUTCHours(), wall.getUTCMinutes(), leapSecond ? second : wall.getUTCSeconds(), leapSecond ? millisecond : wall.getUTCMilliseconds())
		const quality = this.#quality(instant)
		const covered = quality.eop.status === 'covered'
		const last = location && localSiderealTime(instant, location)
		const terrestrial = tt(instant)

		return {
			civil: { local, offsetSeconds: offset / 1000, unixMillis: leapSecond ? undefined : unixMillis, leapSecond, leapSecondDay: utcLeapSeconds(year, month, day) !== 0 },
			scales: Object.fromEntries(Object.entries(TIME_SCALES).map(([name, scale]) => [name, scaleReading(instant, scale)])) as Record<TimeScaleName, TimeScaleReading>,
			sidereal: { gmst: greenwichMeanSiderealTime(instant), gast: greenwichApparentSiderealTime(instant), lmst: location && localSiderealTime(instant, location, true), last },
			offsets: {
				dut1: covered ? dut1(instant) : undefined,
				taiMinusUtc: quality.leapSeconds === 'beforeUtc' ? undefined : taiMinusUtc(instant),
				ttMinusUt1: covered ? secondsBetween(terrestrial, ut1(instant)) : undefined,
				tdbMinusTt: secondsBetween(timeConvert(instant, Timescale.TDB), terrestrial),
			},
			epochs: { julian: toJulianEpoch(instant), besselian: eraEpb(terrestrial.day, terrestrial.fraction), dayOfYear: eraCalToJd(year, month, day) - eraCalToJd(year, 1, 1) + 1 },
			hourAngle: last !== undefined && rightAscension !== undefined ? hourAngle(last, rightAscension) : undefined,
			quality,
		}
	}

	// Samples the real current time for the clock of the status bar, never the simulation clock of the Sky.
	async reference({ observer }: AstronomicalTimeReferenceRequest): Promise<AstronomicalTimeReference> {
		await this.eop.prepare()

		const unixMillis = this.now()
		const instant = this.#bind(timeUnix(unixMillis / 1000), observer)
		const location = instant.location

		return {
			unixMillis,
			jd: toJulianDay(instant),
			lmst: location && localSiderealTime(instant, location, true),
			last: location && localSiderealTime(instant, location),
			siderealRate: SIDEREAL_DRIFT_RATE,
			quality: this.#quality(instant),
		}
	}
}

// Creates the routes of the converter.
export function createAstronomicalTimeRoutes(service: AstronomicalTimeService) {
	return {
		'/api/astronomical-time/convert': {
			// Conversion of an instant (AstronomicalTimeRequest); 422 for a reading that names no single instant.
			POST: async (req) => {
				const result = await service.convert((await req.json()) as AstronomicalTimeRequest)
				if (!('refusal' in result)) return Response.json(result satisfies AstronomicalTimeResult)
				if (result.refusal === 'nonexistentTime') return errorResponse('That reading does not exist on this date', 422, result.refusal satisfies AstronomicalTimeErrorCode)
				return errorResponse('The clocks show that reading twice on this date', 422, result.refusal satisfies AstronomicalTimeErrorCode, { earlier: result.earlier, later: result.later })
			},
		},
		'/api/astronomical-time/reference': {
			// Real-time sample of the status bar clock (AstronomicalTimeReferenceRequest).
			POST: async (req) => Response.json((await service.reference((await req.json()) as AstronomicalTimeReferenceRequest)) satisfies AstronomicalTimeReference),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
