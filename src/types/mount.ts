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
import { normalizeAngle, parseAngle } from 'nebulosa/src/math/units/angle'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { HostAndPort } from '#/connection'
import type { DeviceAdded, DeviceUpdated, DeviceRemoved } from '#/device'

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

export interface CoordinateInfoFlags {
	readonly equatorial?: boolean
	readonly equatorialJ2000?: boolean
	readonly horizontal?: boolean
	readonly ecliptic?: boolean
	readonly galactic?: boolean
	readonly constellation?: boolean
	readonly lst?: boolean
}

const DEFAULT_COORDINATE_INFO_FLAGS: Required<CoordinateInfoFlags> = {
	equatorial: true,
	equatorialJ2000: true,
	horizontal: true,
	ecliptic: true,
	galactic: true,
	constellation: true,
	lst: true,
}

export function coordinateInfo(time: Time, longitude: Angle, target: EquatorialCoordinate | MountTargetCoordinate<string | Angle>, flags: CoordinateInfoFlags = DEFAULT_COORDINATE_INFO_FLAGS) {
	const equatorial: Writable<CoordinateInfo['equatorial']> = [0, 0]
	const equatorialJ2000: Writable<CoordinateInfo['equatorialJ2000']> = [0, 0]
	const horizontal: Writable<CoordinateInfo['horizontal']> = [0, 0]
	const ecliptic: Writable<CoordinateInfo['ecliptic']> = [0, 0]
	const galactic: Writable<CoordinateInfo['galactic']> = [0, 0]
	let observed: ReturnType<typeof cirsToObserved> | undefined
	let hasEquatorial = flags.equatorial === true

	const coordinate: [number, number] = [0, 0]
	let type: MountTargetCoordinate['type'] = 'JNOW'

	if ('type' in target) {
		type = target.type
		const { x, y } = target[type]!

		if (typeof x === 'string') coordinate[0] = parseAngle(x, type === 'JNOW' || type === 'J2000' ? true : undefined)!
		else coordinate[0] = x

		if (typeof y === 'string') coordinate[0] = parseAngle(y)!
		else coordinate[1] = y
	} else {
		coordinate[0] = target.rightAscension
		coordinate[1] = target.declination
	}

	// JNOW equatorial coordinate
	if (type === 'JNOW') {
		Object.assign(equatorial, coordinate)

		hasEquatorial = true

		if (flags.horizontal) observed = cirsToObserved(equatorial, time)
		if (flags.equatorialJ2000 || flags.galactic) Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		if (flags.ecliptic) Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		if (flags.galactic) Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// J2000 equatorial coordinate
	else if (type === 'J2000') {
		Object.assign(equatorialJ2000, coordinate)

		hasEquatorial ||= flags.ecliptic === true || flags.horizontal === true

		if (hasEquatorial) Object.assign(equatorial, equatorialFromJ2000(...equatorialJ2000, time))
		if (flags.ecliptic) Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		if (flags.galactic) Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		if (flags.horizontal) observed = cirsToObserved(equatorial, time)
	}
	// Local horizontal coordinate
	else if (type === 'ALTAZ') {
		Object.assign(horizontal, coordinate)

		hasEquatorial ||= flags.equatorialJ2000 === true || flags.ecliptic === true || flags.galactic === true

		if (hasEquatorial) Object.assign(equatorial, observedToCirs(...horizontal, time))
		if (flags.equatorialJ2000 || flags.galactic) Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		if (flags.ecliptic) Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		if (flags.galactic) Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
	}
	// Ecliptic (at date) coordinate
	else if (type === 'ECLIPTIC') {
		Object.assign(ecliptic, coordinate)

		hasEquatorial ||= flags.equatorialJ2000 === true || flags.horizontal === true || flags.galactic === true

		if (hasEquatorial) Object.assign(equatorial, eclipticToEquatorial(...ecliptic, time))
		if (flags.equatorialJ2000 || flags.galactic) Object.assign(equatorialJ2000, equatorialToJ2000(...equatorial, time))
		if (flags.galactic) Object.assign(galactic, equatorialToGalatic(...equatorialJ2000))
		if (flags.horizontal) observed = cirsToObserved(equatorial, time)
	}
	// Galactic coordinate
	else if (type === 'GALACTIC') {
		Object.assign(galactic, coordinate)

		hasEquatorial ||= flags.ecliptic === true || flags.horizontal === true

		if (flags.equatorialJ2000 || hasEquatorial) Object.assign(equatorialJ2000, galacticToEquatorial(...galactic))
		if (hasEquatorial) Object.assign(equatorial, equatorialFromJ2000(...equatorialJ2000, time))
		if (flags.ecliptic) Object.assign(ecliptic, equatorialToEcliptic(...equatorial, time))
		if (flags.horizontal) observed = cirsToObserved(equatorial, time)
	}

	if (observed !== undefined) {
		horizontal[0] = observed.azimuth
		horizontal[1] = observed.altitude
	}

	if (hasEquatorial) equatorial[0] = normalizeAngle(equatorial[0])
	if (flags.equatorialJ2000) equatorialJ2000[0] = normalizeAngle(equatorialJ2000[0])

	const lst = flags.lst ? localSiderealTime(time, longitude, true) : 0

	return {
		equatorial,
		equatorialJ2000,
		horizontal,
		ecliptic,
		galactic,
		// Use default constellation when disabled
		constellation: flags.constellation && hasEquatorial ? constellation(equatorial[0], equatorial[1], time) : 'AND',
		lst,
		meridianTimeIn: flags.lst && hasEquatorial ? meridianTimeIn(equatorial[0], lst) : 0,
		// Use NEITHER pier side when disabled
		pierSide: flags.lst && hasEquatorial ? expectedPierSide(equatorial[0], equatorial[1], lst) : 'NEITHER',
	} as CoordinateInfo
}
