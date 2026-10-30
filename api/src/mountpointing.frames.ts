import { icrsToObserved } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { eraEpv00 } from 'nebulosa/src/astronomy/coordinates/erfa/earth'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { tdb, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { type Angle, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'

// Coordinate frame of the mount pointing models: true apparent topocentric position of date, without refraction.
// A plate solution gives the catalog direction at the image center, which is reduced here to that frame at the instant
// of the exposure. The command sent to the driver is never reduced: its JNOW values are opaque coordinates of the
// driver, and a model is the mapping from them to the apparent direction reached, so refraction, the semantics of the
// driver, and the mechanics of the mount all end up in the fit. A corrected GoTo reduces its target the same way, so
// aberration stays out of the coefficients instead of drifting through them over the year (about 20″); the
// bias-precession-nutation reduction of the mount commander leaves it in. Pure, and needs no data file: without Earth
// orientation data the toolkit takes UT1 as UTC, which only moves the hour angle of the basis, by a negligible amount.

// Frame every sample and model of the mount pointing models is declared in.
export const POINTING_MODEL_FRAME = 'apparentTopocentric'

// Equatorial position, in radians.
export interface EquatorialPosition {
	// Right ascension in radians, in [0, 2π).
	readonly rightAscension: Angle
	// Declination in radians.
	readonly declination: Angle
}

// Site of a mount as a model stores it.
export interface PointingSite {
	// Geodetic latitude in radians, north positive.
	readonly latitude: Angle
	// Longitude in radians, east positive.
	readonly longitude: Angle
	// Elevation above the ellipsoid in meters.
	readonly elevation: number
}

// Reduces an ICRS direction to the true apparent topocentric place at an instant (Unix milliseconds) and site, without
// refraction. Returns a right ascension counted from the equinox of date.
export function apparentFromIcrs({ rightAscension, declination }: EquatorialPosition, time: number, { latitude, longitude, elevation }: PointingSite): EquatorialPosition {
	const instant = timeUnix(time / 1000, true)
	const { day, fraction } = tdb(instant)
	const [barycentric, heliocentric] = eraEpv00(day, fraction)
	const location = geodeticLocation(longitude, latitude, meter(elevation))
	const observed = icrsToObserved([rightAscension, declination], instant, barycentric, heliocentric[0], false, location)
	return { rightAscension: normalizeAngle(observed.rightAscension - observed.equationOfOrigins), declination: observed.declination }
}
