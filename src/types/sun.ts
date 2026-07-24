import type { SolarEclipse } from 'nebulosa/src/astronomy/bodies/sun'
import type { LocalSolarEclipseCircumstances, LocalSolarEclipseViewOptions } from 'nebulosa/src/astronomy/events/eclipse/solar/local'
import type { PolynomialBesselianElements, SolarEclipseContactPoints, SolarEclipseMapSvgPaths } from 'nebulosa/src/astronomy/events/eclipse/solar/map'
import type { GeographicCoordinate } from 'nebulosa/src/astronomy/observer/location'
import type { LocationAndTime } from 'src/types/atlas'

export type SolarImageSource = (typeof SOLAR_IMAGE_SOURCES)[number]

export type TwilightType = 'civil' | 'nautical' | 'astronomical'

export type TwilightTime = readonly [number, number]

export interface Twilight {
	start: TwilightTime
	readonly dawn: Record<TwilightType, TwilightTime>
	readonly dusk: Record<TwilightType, TwilightTime>
	day: TwilightTime
	night: TwilightTime
	end: TwilightTime
}

export interface SolarSeasons {
	readonly spring: number
	readonly summer: number
	readonly autumn: number
	readonly winter: number
}

export interface FindSolarEclipse extends LocationAndTime {
	count: number
	next: boolean
}

export interface SolarEclipseMap {
	readonly elements: PolynomialBesselianElements
	readonly points: SolarEclipseContactPoints
	readonly paths: SolarEclipseMapSvgPaths
}

export interface ComputeSolarEclipseLocalCircumstances {
	readonly eclipse: SolarEclipse
	readonly location: GeographicCoordinate
}

export interface ComputeSolarEclipseLocalView {
	readonly events: LocalSolarEclipseCircumstances['events']
	readonly options: LocalSolarEclipseViewOptions
}

export const SOLAR_IMAGE_SOURCES = ['AIA_193', 'AIA_304', 'AIA_171', 'AIA_211', 'AIA_131', 'AIA_335', 'AIA_094', 'AIA_1600', 'AIA_1700', 'AIA_171_HMIB', 'HMI_MAGNETOGRAM', 'HMI_COLORIZED_MAGNETOGRAM', 'HMI_INTENSITYGRAM', 'HMI_INTENSITYGRAM_COLORED', 'HMI_INTENSITYGRAM_FLATTENED', 'HMI_DOPPLERGRAM'] as const

export const SOLAR_IMAGE_SOURCE_URLS = {
	AIA_193: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0193.jpg',
	AIA_304: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0304.jpg',
	AIA_171: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0171.jpg',
	AIA_211: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0211.jpg',
	AIA_131: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0131.jpg',
	AIA_335: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0335.jpg',
	AIA_094: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_0094.jpg',
	AIA_1600: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_1600.jpg',
	AIA_1700: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_1700.jpg',
	AIA_171_HMIB: 'https://sdo.gsfc.nasa.gov/assets/img/latest/f_HMImag_171_256.jpg',
	HMI_MAGNETOGRAM: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMIB.jpg',
	HMI_COLORIZED_MAGNETOGRAM: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMIBC.jpg',
	HMI_INTENSITYGRAM_COLORED: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMIIC.jpg',
	HMI_INTENSITYGRAM_FLATTENED: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMIIF.jpg',
	HMI_INTENSITYGRAM: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMII.jpg',
	HMI_DOPPLERGRAM: 'https://sdo.gsfc.nasa.gov/assets/img/latest/latest_256_HMID.jpg',
} as const satisfies Record<SolarImageSource, string>

export const EMPTY_TWILIGHT: Twilight = {
	start: [0, 0],
	dawn: {
		civil: [0, 0],
		nautical: [0, 0],
		astronomical: [0, 0],
	},
	dusk: {
		civil: [0, 0],
		nautical: [0, 0],
		astronomical: [0, 0],
	},
	day: [0, 0],
	night: [0, 0],
	end: [0, 0],
}
