import { cirsToObserved, observedToCirs } from 'nebulosa/src/astronomy/coordinates/astrometry'
import { constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { Constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import { equatorialToJ2000, equatorialToEcliptic, equatorialToGalatic, equatorialFromJ2000, eclipticToEquatorial, galacticToEquatorial } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import type { Time } from 'nebulosa/src/astronomy/time/time'
import type { Writable } from 'nebulosa/src/core/types'
import { expectedPierSide, meridianTimeIn } from 'nebulosa/src/devices/indi/device'
import type { Mount, MountTargetCoordinate, PierSide } from 'nebulosa/src/devices/indi/device'
import { parseAngle } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { HostAndPort } from 'src/types/connection'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from 'src/types/device'

export type MountAdded = DeviceAdded<Mount>

export type MountUpdated = DeviceUpdated<Mount>

export type MountRemoved = DeviceRemoved<Mount>

export type MountRemoteControlProtocol = 'lx200' | 'stellarium'

export type CoordinateType = 'equatorial' | 'equatorialJ2000' | 'horizontal' | 'ecliptic' | 'galactic'

export type MountRemoteControlStatus = Record<MountRemoteControlProtocol, Omit<MountRemoteControlStart, 'protocol'> | false>

export interface CoordinateInfo extends Record<CoordinateType, readonly [Angle, Angle]> {
	readonly lst: Angle
	readonly constellation: Constellation
	readonly meridianTimeIn: number // seconds
	readonly pierSide: PierSide
}

export interface MountRemoteControlStart extends Readonly<HostAndPort> {
	readonly protocol: MountRemoteControlProtocol
}

export const DEFAULT_COORDINATE_INFO: CoordinateInfo = {
	equatorial: [0, 0],
	equatorialJ2000: [0, 0],
	horizontal: [0, 0],
	ecliptic: [0, 0],
	galactic: [0, 0],
	lst: 0,
	constellation: 'AND',
	meridianTimeIn: 0,
	pierSide: 'NEITHER',
}

export function coordinateInfo(time: Time, longitude: Angle, target: EquatorialCoordinate | MountTargetCoordinate<string | Angle>) {
	const equatorial: Writable<CoordinateInfo['equatorial']> = [0, 0]
	const equatorialJ2000: Writable<CoordinateInfo['equatorialJ2000']> = [0, 0]
	const horizontal: Writable<CoordinateInfo['horizontal']> = [0, 0]
	const ecliptic: Writable<CoordinateInfo['ecliptic']> = [0, 0]
	const galactic: Writable<CoordinateInfo['galactic']> = [0, 0]
	let observed: ReturnType<typeof cirsToObserved> | undefined

	const type = 'type' in target ? target.type : 'JNOW'
	const x = 'type' in target ? parseAngle(target[type]!.x, type === 'JNOW' || type === 'J2000' ? true : undefined)! : target.rightAscension
	const y = 'type' in target ? parseAngle(target[type]!.y)! : target.declination

	// JNOW equatorial coordinate
	if (type === 'JNOW') {
		equatorial[0] = x
		equatorial[1] = y

		observed = cirsToObserved(equatorial, time)
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// J2000 equatorial coordinate
	else if (type === 'J2000') {
		equatorialJ2000[0] = x
		equatorialJ2000[1] = y

		Object.assign(equatorial, equatorialFromJ2000(...equatorialJ2000, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		observed = cirsToObserved(equatorial, time)
	}
	// Local horizontal coordinate
	else if (type === 'ALTAZ') {
		horizontal[0] = x
		horizontal[1] = y

		Object.assign(equatorial, observedToCirs(...horizontal, time))
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// Ecliptic (at date) coordinate
	else if (type === 'ECLIPTIC') {
		ecliptic[0] = x
		ecliptic[1] = y

		Object.assign(equatorial, eclipticToEquatorial(...ecliptic, time))
		Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		observed = cirsToObserved(equatorial, time)
	}
	// Galactic coordinate
	else if (type === 'GALACTIC') {
		galactic[0] = x
		galactic[1] = y

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
		meridianTimeIn: meridianTimeIn(equatorial[0], lst),
		pierSide: expectedPierSide(...equatorial, lst),
	} as CoordinateInfo
}
