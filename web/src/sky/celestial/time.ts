import { ASEC2RAD, DAYSEC, DAYSPERJC, J2000, TAU } from 'nebulosa/src/core/constants'
import { type Angle, normalizeAngle } from 'nebulosa/src/math/units/angle'

// Browser-side sky time for the star map: an observation instant is a Unix time in milliseconds (UTC), and
// the sidereal and obliquity quantities the projection needs come from closed-form IAU 2006 expressions. It
// replaces the toolkit's time scales, which depend on IERS tables and the filesystem, so UT1 is taken as
// UTC and TT as UTC plus a fixed offset; the resulting error (below 1 arcminute) is invisible on the map.

// Observation instant accepted by the star map: a Date or a Unix time in milliseconds (UTC).
export type CelestialTime = Date | number

// Julian Date of the Unix epoch (1970-01-01T00:00:00Z), in days.
const UNIX_EPOCH_JULIAN_DAY = 2440587.5

// Milliseconds in one day.
const DAY_MS = DAYSEC * 1000

// TT minus UTC in seconds: TAI−UTC (37 s since 2017-01-01) plus TT−TAI (32.184 s). It drifts only with
// future leap seconds, a negligible error for the map.
const TT_MINUS_UTC = 69.184

// Converts an observation instant into a Unix time in milliseconds (UTC).
export function unixTimeOf(time: CelestialTime) {
	return typeof time === 'number' ? time : time.getTime()
}

// Returns the days elapsed since J2000.0 (2000-01-01T12:00 in the same scale) for a Unix time in milliseconds,
// optionally shifted by an offset in seconds to move from UTC to another scale.
function daysSinceJ2000(unixTime: number, offsetSeconds = 0) {
	return (unixTime + offsetSeconds * 1000) / DAY_MS + (UNIX_EPOCH_JULIAN_DAY - J2000)
}

// Computes the Greenwich mean sidereal time (IAU 2006, as ERFA eraGmst06) in radians [0, 2π) for a Unix time
// in milliseconds (UTC).
export function greenwichMeanSiderealTime(unixTime: number): Angle {
	const ut = daysSinceJ2000(unixTime)
	const t = daysSinceJ2000(unixTime, TT_MINUS_UTC) / DAYSPERJC
	const earthRotationAngle = TAU * ((ut % 1) + 0.779057273264 + 0.00273781191135448 * ut)
	const polynomial = (0.014506 + (4612.156534 + (1.3915817 + (-0.00000044 + (-0.000029956 + -0.0000000368 * t) * t) * t) * t) * t) * ASEC2RAD
	return normalizeAngle(earthRotationAngle + polynomial)
}

// Computes the local mean sidereal time in radians [0, 2π) for a Unix time in milliseconds (UTC) and an
// east-positive geodetic longitude in radians.
export function localSiderealTime(unixTime: number, longitude: Angle): Angle {
	return normalizeAngle(greenwichMeanSiderealTime(unixTime) + longitude)
}

// Computes the mean obliquity of the ecliptic of date (IAU 2006, as ERFA eraObl06) in radians for a Unix time
// in milliseconds (UTC).
export function meanObliquity(unixTime: number): Angle {
	const t = daysSinceJ2000(unixTime, TT_MINUS_UTC) / DAYSPERJC
	return (84381.406 + (-46.836769 + (-0.0001831 + (0.0020034 + (-0.000000576 + -0.0000000434 * t) * t) * t) * t) * t) * ASEC2RAD
}
