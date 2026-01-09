import { type Angle, parseAngle } from 'nebulosa/src/angle'
import { cirsToObserved, observedToCirs } from 'nebulosa/src/astrometry'
import { constellation } from 'nebulosa/src/constellation'
import { type EquatorialCoordinate, eclipticToEquatorial, equatorialFromJ2000, equatorialToEcliptic, equatorialToGalatic, equatorialToJ2000, galacticToEquatorial } from 'nebulosa/src/coordinate'
import { expectedPierSide, type MountTargetCoordinate, meridianTimeIn } from 'nebulosa/src/indi.device'
import { localSiderealTime } from 'nebulosa/src/location'
import type { Time } from 'nebulosa/src/time'
import type { Mutable } from 'utility-types'
import type { CoordinateInfo, ExposureTimeUnit } from './types'

// Unsubscribes all provided unsubscribers
export function unsubscribe(unsubscribers?: readonly (VoidFunction | undefined)[]) {
	unsubscribers?.forEach((e) => e?.())
}

// Returns a factor to convert exposure time to minutes
export function exposureTimeUnitFactor(unit: ExposureTimeUnit) {
	switch (unit) {
		case 'MINUTE':
			return 1
		case 'SECOND':
			return 60
		case 'MILLISECOND':
			return 60000
		case 'MICROSECOND':
			return 60000000
	}
}

// Converts exposure time in given unit to minutes
export function exposureTimeInMinutes(time: number, unit: ExposureTimeUnit) {
	return unit === 'MINUTE' ? time : time / exposureTimeUnitFactor(unit)
}

// Converts exposure time in given unit to seconds
export function exposureTimeInSeconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'SECOND' ? time : time * (60 / exposureTimeUnitFactor(unit))
}

// Converts exposure time in given unit to milliseconds
export function exposureTimeInMilliseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MILLISECOND' ? time : time * (60000 / exposureTimeUnitFactor(unit))
}

// Converts exposure time in given unit to microseconds
export function exposureTimeInMicroseconds(time: number, unit: ExposureTimeUnit) {
	return unit === 'MICROSECOND' ? time : time * (60000000 / exposureTimeUnitFactor(unit))
}

// Converts exposure time from one unit to another
export function exposureTimeIn(time: number, from: ExposureTimeUnit, to: ExposureTimeUnit) {
	return from === to ? time : time * (exposureTimeUnitFactor(to) / exposureTimeUnitFactor(from))
}

export function coordinateInfo(time: Time, longitude: Angle, target: EquatorialCoordinate | MountTargetCoordinate<string | Angle>) {
	const equatorial: Mutable<CoordinateInfo['equatorial']> = [0, 0]
	const equatorialJ2000: Mutable<CoordinateInfo['equatorialJ2000']> = [0, 0]
	const horizontal: Mutable<CoordinateInfo['horizontal']> = [0, 0]
	const ecliptic: Mutable<CoordinateInfo['ecliptic']> = [0, 0]
	const galactic: Mutable<CoordinateInfo['galactic']> = [0, 0]
	let observed: ReturnType<typeof cirsToObserved> | undefined

	const x = 'type' in target ? target[target.type]!.x : target.rightAscension
	const y = 'type' in target ? target[target.type]!.y : target.declination

	// JNOW equatorial coordinate
	if (!('type' in target) || target.type === 'JNOW') {
		equatorial[0] = parseAngle(x, true)!
		equatorial[1] = parseAngle(y)!

		observed = cirsToObserved(equatorial, time)
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// J2000 equatorial coordinate
	else if (target.type === 'J2000') {
		equatorialJ2000[0] = parseAngle(x, true)!
		equatorialJ2000[1] = parseAngle(y)!

		Object.assign(equatorial, equatorialFromJ2000(...equatorialJ2000, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		observed = cirsToObserved(equatorial, time)
	}
	// Local horizontal coordinate
	else if (target.type === 'ALTAZ') {
		horizontal[0] = parseAngle(x)!
		horizontal[1] = parseAngle(y)!

		Object.assign(equatorial, observedToCirs(...horizontal, time))
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// Ecliptic (at date) coordinate
	else if (target.type === 'ECLIPTIC') {
		ecliptic[0] = parseAngle(x)!
		ecliptic[1] = parseAngle(y)!

		Object.assign(equatorial, eclipticToEquatorial(...ecliptic, time))
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		observed = cirsToObserved(equatorial, time)
	}
	// Galactic coordinate
	else if (target.type === 'GALACTIC') {
		galactic[0] = parseAngle(x)!
		galactic[1] = parseAngle(y)!

		Object.assign(equatorialJ2000, galacticToEquatorial(...galactic))
		Object.assign(equatorial, equatorialFromJ2000(...equatorialJ2000, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		observed = cirsToObserved(equatorial, time)
	}

	if (observed) {
		horizontal[0] = observed.azimuth
		horizontal[1] = observed.altitude
	}

	const lst = localSiderealTime(time, longitude, true)

	return {
		equatorial,
		equatorialJ2000,
		horizontal,
		ecliptic,
		galactic,
		constellation: constellation(...equatorial, time),
		lst,
		meridianIn: meridianTimeIn(equatorial[0], lst),
		pierSide: expectedPierSide(...equatorial, lst),
	} as CoordinateInfo
}
