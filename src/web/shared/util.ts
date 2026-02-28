import { type ClassValue, clsx } from 'clsx'
import { ONE_GIGAPARSEC, ONE_KILOPARSEC, ONE_MEGAPARSEC } from 'nebulosa/src/constants'
import { CONSTELLATION_LIST, CONSTELLATIONS, type Constellation } from 'nebulosa/src/constellation'
import { type Distance, toKilometer, toLightYear } from 'nebulosa/src/distance'
import type { SkyObjectSearchItem } from 'src/shared/types'
import { twMerge } from 'tailwind-merge'
import { SKY_OBJECT_NAME_TYPES } from './types'

export const isMousePresent = isMouseDeviceSupported()

export function tw(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs))
}

// Stops the propagation of an event to parent elements
export function stopPropagation(event: Event | React.BaseSyntheticEvent<Event>) {
	event.stopPropagation()
}

export function stopPropagationDesktopOnly(event: Event | React.BaseSyntheticEvent<Event>) {
	if (isMousePresent === true) event.stopPropagation()
}

export function stopPropagationMobileOnly(event: Event | React.BaseSyntheticEvent<Event>) {
	if (isMousePresent === false) event.stopPropagation()
}

// Prevents the default action of an event if it is cancelable
export function preventDefault(event: Event | React.BaseSyntheticEvent<Event>) {
	event.cancelable && event.preventDefault()
}

// Checks if the Wake Lock API is supported
export function isWakeLockSupported() {
	return 'wakeLock' in navigator
}

// Checks if device like a mouse or a similar accurate pointing device is present.
export function isMouseDeviceSupported() {
	return matchMedia('(pointer:fine)').matches
}

// Deletes undefined or null properties
export function deleteUndefinedOrNull<T extends object>(o: T): T {
	for (const [key, value] of Object.entries(o)) {
		if (value === undefined || value === null) {
			delete (o as Record<string, unknown>)[key]
		}
	}

	return o
}

// Formats the name of a sky object based on its catalog ID and constellation
export function skyObjectName(id: string, constellation: Constellation | number) {
	const index = id.indexOf(':')

	if (index === -1) return id

	const catalog = +id.substring(0, index)
	const name = id.substring(index + 1)

	if (catalog === 0) return name
	if (catalog === 3 || catalog === 4) return `${name} ${CONSTELLATIONS[typeof constellation === 'number' ? CONSTELLATION_LIST[constellation] : constellation].iau}`
	if (catalog === 8) return `M ${name}`
	if (catalog === 9) return `C ${name}`
	if (catalog === 10) return `B ${name}`
	if (catalog === 11) return `SH 2-${name}`
	if (catalog === 14) return `Mel ${name}`
	if (catalog === 15) return `Cr ${name}`
	if (catalog === 16) return `Arp ${name}`
	if (catalog === 17) return `Abell ${name}`
	if (catalog === 19) return `Tr ${name}`
	if (catalog === 20) return `St ${name}`
	if (catalog === 21) return `Ru ${name}`
	if (catalog === 33) return `Bennett ${name}`
	if (catalog === 34) return `Dunlop ${name}`
	if (catalog === 35) return `Hershel ${name}`
	if (catalog === 36) return `Gum ${name}`
	if (catalog === 37) return `Bochum ${name}`
	if (catalog === 38) return `Alessi ${name}`
	if (catalog === 39) return `Alicante ${name}`
	if (catalog === 40) return `Alter ${name}`
	if (catalog === 41) return `Antalova ${name}`
	if (catalog === 42) return `Apriamaswili ${name}`
	if (catalog === 43) return `Arp ${name}`
	if (catalog === 44) return `Barhatova ${name}`
	if (catalog === 45) return `Basel ${name}`
	if (catalog === 46) return `Berkeley ${name}`
	if (catalog === 47) return `Bica ${name}`
	if (catalog === 48) return `Biurakan ${name}`
	if (catalog === 49) return `Blanco ${name}`
	if (catalog === 50) return `Chupina ${name}`
	if (catalog === 51) return `Czernik ${name}`
	if (catalog === 52) return `Danks ${name}`
	if (catalog === 53) return `Dias ${name}`
	if (catalog === 54) return `Djorg ${name}`
	if (catalog === 55) return `Dolidze-Dzim ${name}`
	if (catalog === 56) return `Dolidze ${name}`
	if (catalog === 57) return `Dufay ${name}`
	if (catalog === 58) return `Feinstein ${name}`
	if (catalog === 59) return `Ferrero ${name}`
	if (catalog === 60) return `Graff ${name}`
	if (catalog === 61) return `Gulliver ${name}`
	if (catalog === 62) return `Haffner ${name}`
	if (catalog === 63) return `Harvard ${name}`
	if (catalog === 64) return `Haute-Provence ${name}`
	if (catalog === 65) return `Hogg ${name}`
	if (catalog === 66) return `Iskurzdajan ${name}`
	if (catalog === 67) return `Johansson ${name}`
	if (catalog === 68) return `Kharchenko ${name}`
	if (catalog === 69) return `King ${name}`
	if (catalog === 70) return `Kron ${name}`
	if (catalog === 71) return `Lindsay ${name}`
	if (catalog === 72) return `Loden ${name}`
	if (catalog === 73) return `Lynga ${name}`
	if (catalog === 74) return `Mamajek ${name}`
	if (catalog === 75) return `Moffat ${name}`
	if (catalog === 76) return `Mrk ${name}`
	if (catalog === 77) return `Pal ${name}`
	if (catalog === 78) return `Pismis ${name}`
	if (catalog === 79) return `Platais ${name}`
	if (catalog === 80) return `Roslund ${name}`
	if (catalog === 81) return `Saurer ${name}`
	if (catalog === 82) return `Sher ${name}`
	if (catalog === 83) return `Skiff ${name}`
	if (catalog === 84) return `Stephenson ${name}`
	if (catalog === 85) return `Terzan ${name}`
	if (catalog === 86) return `Tombaugh ${name}`
	if (catalog === 87) return `Turner ${name}`
	if (catalog === 88) return `Upgren ${name}`
	if (catalog === 89) return `Waterloo ${name}`
	if (catalog === 90) return `Westerlund ${name}`
	if (catalog === 91) return `Zwicky ${name}`
	return `${SKY_OBJECT_NAME_TYPES[catalog + 1]} ${name}`
}

// Formats the type of a sky object based on its type code
export function skyObjectType(type: SkyObjectSearchItem['type']) {
	if (type === 1) return 'Galaxy'
	if (type === 2) return 'Active Galaxy'
	if (type === 3) return 'Radio Galaxy'
	if (type === 4) return 'Interacting Galaxy'
	if (type === 5) return 'Quasar'
	if (type === 6) return 'Star Cluster'
	if (type === 7) return 'Open Star Cluster'
	if (type === 8) return 'Globular Star Cluster'
	if (type === 9) return 'Stellar Association'
	if (type === 10) return 'Star Cloud'
	if (type === 11) return 'Nebula'
	if (type === 12) return 'Planetary Nebula'
	if (type === 13) return 'Dark Nebula'
	if (type === 14) return 'Reflection Nebula'
	if (type === 15) return 'Bipolar Nebula'
	if (type === 16) return 'Emission Nebula'
	if (type === 17) return 'Cluster Associated With Nebulosity'
	if (type === 18) return 'HII Region'
	if (type === 19) return 'Supernova Remnant'
	if (type === 20) return 'Interstellar Matter'
	if (type === 21) return 'Emission Object'
	if (type === 22) return 'Bl Lacertae Object'
	if (type === 23) return 'Blazar'
	if (type === 24) return 'Molecular Cloud'
	if (type === 25) return 'Young Stellar Object'
	if (type === 26) return 'Possible Quasar'
	if (type === 27) return 'Possible Planetary Nebula'
	if (type === 28) return 'Protoplanetary Nebula'
	if (type === 29) return 'Star'
	if (type === 30) return 'Symbiotic Star'
	if (type === 31) return 'Emission Line Star'
	if (type === 32) return 'Supernova Candidate'
	if (type === 33) return 'Super Nova Remnant Candidate'
	if (type === 34) return 'Cluster of Galaxies'
	if (type === 35) return 'Part of Galaxy'
	if (type === 36) return 'Region of the Sky'
	return 'Unknown'
}

// Formats a distance value into a human-readable string with appropriate units
export function formatDistance(distance: Distance) {
	if (distance <= 0) return '0'
	if (distance >= ONE_GIGAPARSEC) return `${(distance / ONE_GIGAPARSEC).toFixed(2)} Gpc`
	if (distance >= ONE_MEGAPARSEC) return `${(distance / ONE_MEGAPARSEC).toFixed(2)} Mpc`
	if (distance >= ONE_KILOPARSEC) return `${(distance / ONE_KILOPARSEC).toFixed(2)} kpc`
	if (distance >= 63241.077084266280268653583182) return `${toLightYear(distance).toFixed(2)} ly`
	if (distance >= 1) return `${distance.toFixed(3)} AU`
	return `${(toKilometer(distance)).toFixed(0)} km`
}
