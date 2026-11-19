import { icrsToObserved } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { EphemerisSource } from 'nebulosa/src/astronomy/ephemeris/source'
import { geodeticLocation } from 'nebulosa/src/astronomy/observer/location'
import { timeUnix } from 'nebulosa/src/astronomy/time/time'
import { type Angle, normalizeAngle } from 'nebulosa/src/math/units/angle'
import { meter } from 'nebulosa/src/math/units/distance'
import type { EphemerisKernels } from './ephemeris.chain'
import { solarSystemSource } from './sky/ephemeris'

// Coordinate frame of the mount pointing models: true apparent topocentric position of date, without refraction.
// A plate solution gives the catalog direction at the image center, which is reduced here to that frame at the instant
// of the exposure. The command sent to the driver is never reduced: its JNOW values are opaque coordinates of the
// driver, and a model is the mapping from them to the apparent direction reached, so refraction, the semantics of the
// driver, and the mechanics of the mount all end up in the fit. A corrected GoTo reduces its target the same way, so
// aberration stays out of the coefficients instead of drifting through them over the year (about 20″); the
// bias-precession-nutation reduction of the mount commander leaves it in. The Earth and the Sun of the aberration and the
// deflection come from one source of the fast ephemeris chain (ephemeris.chain.ts): the SPK kernels of the SPICE Kernel
// Library when they resolve them at the instant, else the analytical theories. Without Earth orientation data the toolkit
// takes UT1 as UTC, which only moves the hour angle of the basis, by a negligible amount.

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

// Source of the Earth and the Sun of a reduction at an instant (Unix milliseconds): the SPK kernels of the current snapshot
// of kernels when they resolve both there, else the analytical theories.
export function pointingEphemeris(kernels: EphemerisKernels, time: number): EphemerisSource {
	return solarSystemSource(kernels.current(), [], [time]).source
}

// Reduces an ICRS direction to the true apparent topocentric place at an instant (Unix milliseconds) and site, without
// refraction, taking the barycentric state of the Earth and the position of the Sun from source. Returns a right ascension
// counted from the equinox of date.
export function apparentFromIcrs({ rightAscension, declination }: EquatorialPosition, time: number, { latitude, longitude, elevation }: PointingSite, source: EphemerisSource): EquatorialPosition {
	const instant = timeUnix(time / 1000, true)
	const earth = source.state(399, instant)
	const sun = source.state(10, instant)[0]
	const heliocentric: readonly [number, number, number] = [earth[0][0] - sun[0], earth[0][1] - sun[1], earth[0][2] - sun[2]]
	const location = geodeticLocation(longitude, latitude, meter(elevation))
	const observed = icrsToObserved([rightAscension, declination], instant, earth, heliocentric, false, location)
	return { rightAscension: normalizeAngle(observed.rightAscension - observed.equationOfOrigins), declination: observed.declination }
}
