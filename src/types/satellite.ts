import type { ObserverWithTLE } from 'nebulosa/src/adapters/ephemeris/horizons'

export type SatelliteGroupType = keyof typeof SATELLITE_GROUP_TYPES

export type SatelliteType = (typeof SATELLITE_GROUP_TYPES)[SatelliteGroupType]['type']

export type SatelliteCategory = (typeof SATELLITE_GROUP_TYPES)[SatelliteGroupType]['category']

export interface Satellite extends ObserverWithTLE {
	readonly id: number
	readonly name: string
	groups: SatelliteGroupType[]
}

export interface SearchSatellite {
	readonly text: string
	readonly groups: readonly SatelliteGroupType[]
	readonly page: number
	readonly limit: number
	readonly category: readonly SatelliteCategory[]
}

export const SATELLITE_GROUP_TYPES = {
	// Special-Interest Satellites
	LAST_30_DAYS: { description: "Last 30 Days' Launches", type: 'last-30-days', category: 'SPECIAL' },
	STATIONS: { description: 'Space Stations', type: 'stations', category: 'SPECIAL' },
	VISUAL: { description: '100 (or so) Brightest', type: 'visual', category: 'SPECIAL' },
	ACTIVE: { description: 'Active Satellites', type: 'active', category: 'SPECIAL' },
	ANALYST: { description: 'Analyst Satellites', type: 'analyst', category: 'SPECIAL' },
	COSMOS_1408_DEBRIS: { description: 'Russian ASAT Test Debris (COSMOS 1408)', type: 'cosmos-1408-debris', category: 'SPECIAL' },
	FENGYUN_1C_DEBRIS: { description: 'Chinese ASAT Test Debris (FENGYUN 1C)', type: 'fengyun-1c-debris', category: 'SPECIAL' },
	IRIDIUM_33_DEBRIS: { description: 'IRIDIUM 33 Debris', type: 'iridium-33-debris', category: 'SPECIAL' },
	COSMOS_2251_DEBRIS: { description: 'COSMOS 2251 Debris', type: 'cosmos-2251-debris', category: 'SPECIAL' },
	// Weather & Earth Resources Satellites
	WEATHER: { description: 'Weather', type: 'weather', category: 'WEATHER' },
	NOAA: { description: 'NOAA', type: 'noaa', category: 'WEATHER' },
	GOES: { description: 'GOES', type: 'goes', category: 'WEATHER' },
	RESOURCE: { description: 'Earth Resources', type: 'resource', category: 'WEATHER' },
	SARSAT: { description: 'Search & Rescue (SARSAT)', type: 'sarsat', category: 'WEATHER' },
	DMC: { description: 'Disaster Monitoring', type: 'dmc', category: 'WEATHER' },
	TDRSS: { description: 'Tracking and Data Relay Satellite System (TDRSS)', type: 'tdrss', category: 'WEATHER' },
	ARGOS: { description: 'ARGOS Data Collection System', type: 'argos', category: 'WEATHER' },
	PLANET: { description: 'Planet', type: 'planet', category: 'WEATHER' },
	SPIRE: { description: 'Spire', type: 'spire', category: 'WEATHER' },
	// Communications Satellites
	GEO: { description: 'Active Geosynchronous', type: 'geo', category: 'COMMUNICATION' },
	// GPZ: { description: 'GEO Protected Zone', type: 'gpz', category: 'COMMUNICATION' }, // SPECIAL
	// GPZ_PLUS: { description: 'GEO Protected Zone Plus', type: 'gpz-plus', category: 'COMMUNICATION' }, // SPECIAL
	INTELSAT: { description: 'Intelsat', type: 'intelsat', category: 'COMMUNICATION' },
	SES: { description: 'SES', type: 'ses', category: 'COMMUNICATION' },
	EUTELSAT: { description: 'Eutelsat', type: 'eutelsat', category: 'COMMUNICATION' },
	TELESAT: { description: 'Telesat', type: 'telesat', category: 'COMMUNICATION' },
	STARLINK: { description: 'Starlink', type: 'starlink', category: 'COMMUNICATION' },
	ONEWEB: { description: 'OneWeb', type: 'oneweb', category: 'COMMUNICATION' },
	QIANFAN: { description: 'Qianfan', type: 'qianfan', category: 'COMMUNICATION' },
	HULIANWANG: { description: 'Hulianwang Digui', type: 'hulianwang', category: 'COMMUNICATION' },
	KUIPER: { description: 'Kuiper', type: 'kuiper', category: 'COMMUNICATION' },
	IRIDIUM_NEXT: { description: 'Iridium NEXT', type: 'iridium-NEXT', category: 'COMMUNICATION' },
	ORBCOMM: { description: 'Orbcomm', type: 'orbcomm', category: 'COMMUNICATION' },
	GLOBALSTAR: { description: 'Globalstar', type: 'globalstar', category: 'COMMUNICATION' },
	AMATEUR: { description: 'Amateur Radio', type: 'amateur', category: 'COMMUNICATION' },
	SATNOGS: { description: 'SatNOGS', type: 'satnogs', category: 'COMMUNICATION' },
	X_COMM: { description: 'Experimental Comm', type: 'x-comm', category: 'COMMUNICATION' },
	OTHER_COMM: { description: 'Other Comm', type: 'other-comm', category: 'COMMUNICATION' },
	// Navigation Satellites
	GNSS: { description: 'GNSS', type: 'gnss', category: 'NAVIGATION' },
	GPS: { description: 'GPS Operational', type: 'gps-ops', category: 'NAVIGATION' },
	GLONASS: { description: 'GLONASS Operational', type: 'glo-ops', category: 'NAVIGATION' },
	GALILEO: { description: 'Galileo', type: 'galileo', category: 'NAVIGATION' },
	BEIDOU: { description: 'Beidou', type: 'beidou', category: 'NAVIGATION' },
	SBAS: { description: 'Satellite-Based Augmentation System (WAAS/EGNOS/MSAS)', type: 'sbas', category: 'NAVIGATION' },
	NNSS: { description: 'Navy Navigation Satellite System (NNSS)', type: 'nnss', category: 'NAVIGATION' },
	MUSSON: { description: 'Russian LEO Navigation', type: 'musson', category: 'NAVIGATION' },
	// Scientific Satellites
	SCIENCE: { description: 'Space & Earth Science', type: 'science', category: 'SCIENTIFIC' },
	GEODETIC: { description: 'Geodetic', type: 'geodetic', category: 'SCIENTIFIC' },
	ENGINEERING: { description: 'Engineering', type: 'engineering', category: 'SCIENTIFIC' },
	EDUCATION: { description: 'Education', type: 'education', category: 'SCIENTIFIC' },
	// Miscellaneous Satellites
	MILITARY: { description: 'Miscellaneous Military', type: 'military', category: 'MISCELLANEOUS' },
	RADAR: { description: 'Radar Calibration', type: 'radar', category: 'MISCELLANEOUS' },
	CUBESAT: { description: 'CubeSats', type: 'cubesat', category: 'MISCELLANEOUS' },
	OTHER: { description: 'Other Satellites', type: 'other', category: 'MISCELLANEOUS' },
} as const

export const DEFAULT_SEARCH_SATELLITE: SearchSatellite = {
	text: '',
	groups: ['SCIENCE', 'STATIONS', 'VISUAL'],
	category: ['SPECIAL', 'WEATHER', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC'],
	page: 1,
	limit: 4,
}

export const DEFAULT_SATELLITE: Satellite = {
	id: 0,
	name: '',
	groups: [],
	line1: '',
	line2: '',
}
