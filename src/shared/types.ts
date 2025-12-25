import type { SortDescriptor } from '@heroui/react'
import type { MoleculeOrInterface } from 'bunshi'
import { type Angle, normalizeAngle, toHour } from 'nebulosa/src/angle'
import { DEFAULT_REFRACTION_PARAMETERS, type RefractionParameters } from 'nebulosa/src/astrometry'
import { DAYSEC, SIDEREAL_DAYSEC } from 'nebulosa/src/constants'
import type { Constellation } from 'nebulosa/src/constellation'
import type { EquatorialCoordinate, EquatorialCoordinateJ2000, HorizontalCoordinate } from 'nebulosa/src/coordinate'
import type { Distance } from 'nebulosa/src/distance'
import type { FitsHeader } from 'nebulosa/src/fits'
import type { Rect } from 'nebulosa/src/geometry'
import type { ObserverWithTLE } from 'nebulosa/src/horizons'
import type { ImageChannel, ImageChannelOrGray, ImageFormat, ImageMetadata, WriteImageToFormatOptions } from 'nebulosa/src/image.types'
import type { PropertyState } from 'nebulosa/src/indi'
// biome-ignore format: too long!
import type { Camera, Cover, Device, DeviceProperty, DewHeater, FlatPanel, Focuser, FrameType, GuideDirection, GuideOutput, Mount, PierSide, Thermometer, UTCTime, Wheel } from 'nebulosa/src/indi.device'
import type { GeographicCoordinate } from 'nebulosa/src/location'
import type { LunarEclipse, LunarPhase } from 'nebulosa/src/moon'
import type { PlateSolution, PlateSolveOptions } from 'nebulosa/src/platesolver'
import type { SmallBodySearchListItem, SmallBodySearchObject } from 'nebulosa/src/sbd'
import type { StellariumObjectType } from 'nebulosa/src/stellarium'
import type { SolarEclipse } from 'nebulosa/src/sun'
import type { Temporal } from 'nebulosa/src/temporal'
import type { Velocity } from 'nebulosa/src/velocity'
import type { DeepRequired, Required } from 'utility-types'

export type Atom<T> = T extends MoleculeOrInterface<infer X> ? X : never

export interface LocationAndTime {
	readonly location: GeographicCoordinate
	readonly time: UTCTime
}

export interface Size {
	width: number
	height: number
}

// Atlas

export type TwilightType = 'CIVIL' | 'NAUTICAL' | 'ASTRONOMICAL'

export type TwilightTime = readonly [Temporal, number]

export const SOLAR_IMAGE_SOURCES = ['AIA_193', 'AIA_304', 'AIA_171', 'AIA_211', 'AIA_131', 'AIA_335', 'AIA_094', 'AIA_1600', 'AIA_1700', 'AIA_171_HMIB', 'HMI_MAGNETOGRAM', 'HMI_COLORIZED_MAGNETOGRAM', 'HMI_INTENSITYGRAM', 'HMI_INTENSITYGRAM_COLORED', 'HMI_INTENSITYGRAM_FLATTENED', 'HMI_DOPPLERGRAM'] as const

export const SOLAR_IMAGE_SOURCE_URLS: Record<SolarImageSource, string> = {
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

export type SatelliteGroupType = keyof typeof SATELLITE_GROUP_TYPES

export type SatelliteType = (typeof SATELLITE_GROUP_TYPES)[SatelliteGroupType]['type']

export type SatelliteCategory = (typeof SATELLITE_GROUP_TYPES)[SatelliteGroupType]['category']

export type SolarImageSource = (typeof SOLAR_IMAGE_SOURCES)[number]

export type PlanetType =
	| 'PLANET'
	| 'DWARF_PLANET'
	| 'ASTEROID'
	| 'COMET'
	| 'MARTIAN_SATELLITE'
	| 'MARTIAN_SATELLITE'
	| 'JOVIAN_REGULAR_SATELLITE'
	| 'JOVIAN_IRREGULAR_SATELLITE'
	| 'SATURNIAN_REGULAR_SATELLITE'
	| 'SATURNIAN_INNER_SATELLITE'
	| 'SATURNIAN_IRREGULAR_SATELLITE'
	| 'URANIAN_REGULAR_SATELLITE'
	| 'URANIAN_INNER_SATELLITE'
	| 'URANIAN_IRREGULAR_SATELLITE'
	| 'NEPTUNIAN_SATELLITE'
	| 'NEPTUNIAN_IRREGULAR_SATELLITE'
	| 'PLUTO_SATELLITE'

export interface PositionOfBody extends LocationAndTime {}

export interface ChartOfBody extends PositionOfBody {}

export interface Twilight {
	start: TwilightTime
	readonly dawn: Record<Lowercase<TwilightType>, TwilightTime>
	readonly dusk: Record<Lowercase<TwilightType>, TwilightTime>
	day: TwilightTime
	night: TwilightTime
	end: TwilightTime
}

export interface FindNextSolarEclipse extends LocationAndTime {
	count: number
}

export interface NextSolarEclipse extends Omit<SolarEclipse, 'maximalTime'> {
	time: Temporal
}

export interface FindNextLunarEclipse extends LocationAndTime {
	count: number
}

export interface NextLunarEclipse extends Pick<LunarEclipse, 'type'> {
	startTime: Temporal
	endTime: Temporal
	time: Temporal
}

export interface SearchMinorPlanet {
	readonly text: string
}

export interface MinorPlanetParameter {
	readonly name: string
	readonly description: string
	readonly value: string
}

export interface FindCloseApproaches {
	days: number
	distance: number // in LD (Lunar Distance)
}

export interface CloseApproach {
	readonly name: string
	readonly distance: number // in LD (Lunar Distance)
	readonly date: Temporal
}

export interface MinorPlanet {
	readonly name: string
	readonly id: string
	readonly kind?: SmallBodySearchObject['kind']
	readonly pha: boolean
	readonly neo: boolean
	readonly orbitType: string
	readonly parameters?: MinorPlanetParameter[]
	readonly list?: SmallBodySearchListItem[]
}

export interface SearchSkyObject extends LocationAndTime {
	readonly name: string
	readonly nameType: number
	readonly constellations: Constellation[]
	readonly types: StellariumObjectType[]
	readonly magnitudeMin: number
	readonly magnitudeMax: number
	readonly rightAscension: string // hour
	readonly declination: string // deg
	readonly radius: number // deg
	readonly visible: boolean
	readonly visibleAbove: number // deg
	page: number
	readonly limit: number
	readonly sort: SortDescriptor
}

export interface SkyObjectSearchItem {
	readonly id: number
	readonly magnitude: number
	readonly type: StellariumObjectType
	readonly constellation: number
	readonly name: string
}

export interface SkyObject extends EquatorialCoordinate {
	readonly id: number
	readonly type: StellariumObjectType
	readonly magnitude: number
	readonly pmRa: Angle
	readonly pmDec: Angle
	readonly distance: Distance
	readonly rv: Velocity
	readonly constellation: number
	readonly spmType?: string
	readonly name?: string
}

export interface AnnotatedSkyObject extends Required<Omit<SkyObject, 'type' | 'spmType'>>, Point {
	type: StellariumObjectType | 'MINOR_PLANET'
}

export interface BodyPosition extends Readonly<EquatorialCoordinate>, Readonly<EquatorialCoordinateJ2000>, Readonly<HorizontalCoordinate> {
	readonly magnitude: number | null
	readonly constellation: Constellation
	readonly distance: Distance
	readonly illuminated: number
	readonly elongation: number
	readonly leading: boolean
	readonly names?: readonly string[]
	pierSide: PierSide
}

export interface SolarSeasons {
	readonly spring: number
	readonly summer: number
	readonly autumn: number
	readonly winter: number
}

export type LunarPhaseTime = readonly [LunarPhase, number]

export interface Satellite extends ObserverWithTLE {
	readonly id: number
	readonly name: string
	groups: SatelliteGroupType[]
}

export interface SearchSatellite {
	readonly text: string
	groups: SatelliteGroupType[]
	page: number
	readonly limit?: number
	category: SatelliteCategory[]
	readonly sort: SortDescriptor
}

// Confirmation

export interface Confirm {
	readonly key: string
	readonly accepted: boolean
}

export interface Confirmation {
	key: string
	message: string
}

// Connection

export type ConnectionType = 'INDI' | 'ALPACA'

export interface Connect {
	host: string
	port: number
	type: ConnectionType
}

export interface ConnectionStatus extends Connect {
	id: string
	ip?: string
}

export interface ConnectionEvent {
	readonly status: ConnectionStatus
}

// File System

export interface ListDirectory {
	path?: string
	filter?: string
	directoryOnly?: boolean
}

export interface CreateDirectory {
	path: string
	name: string
	recursive?: boolean | undefined
	mode?: string | number | undefined
}

export interface DirectoryEntry {
	name: string
	path: string
}

export interface FileEntry extends DirectoryEntry {
	directory: boolean
	size: number
	updatedAt: number
}

export interface FileSystem {
	path: string
	tree: DirectoryEntry[]
	entries: FileEntry[]
}

// Framing

export interface Framing extends EquatorialCoordinate<string>, Size {
	id: string
	hipsSurvey: string
	fov?: number // deg
	focalLength: number // mm
	pixelSize: number // µm
	rotation: number // deg
}

// Image

export interface ImageStretch {
	auto: boolean
	shadow: number // 0 - 65536
	highlight: number // 0 - 65536
	midtone: number // 0 - 65536
	meanBackground: number
}

export interface ImageScnr {
	channel?: ImageChannel
	amount: number
	method: 'MAXIMUM_MASK' | 'ADDITIVE_MASK' | 'AVERAGE_NEUTRAL' | 'MAXIMUM_NEUTRAL' | 'MINIMUM_NEUTRAL'
}

export interface ImageAdjustment {
	enabled: boolean
	brightness: {
		value: number
	}
	contrast: {
		value: number
	}
	gamma: {
		value: number
	}
	saturation: {
		value: number
		channel: ImageChannelOrGray
	}
}

export interface ImageFilter {
	enabled: boolean
	type: 'sharpen' | 'mean' | 'blur' | 'gaussianBlur'
	readonly mean: {
		size: number
	}
	readonly blur: {
		size: number
	}
	readonly gaussianBlur: {
		sigma: number
		size: number
	}
}

export interface ImageTransformation {
	enabled: boolean
	calibrationGroup?: string
	debayer: boolean
	stretch: ImageStretch
	horizontalMirror: boolean
	verticalMirror: boolean
	invert: boolean
	scnr: ImageScnr
	format: {
		type: ImageFormat
	} & DeepRequired<WriteImageToFormatOptions>
	adjustment: ImageAdjustment
	filter: ImageFilter
}

export interface OpenImage {
	readonly path: string
	readonly camera?: string
	readonly transformation: ImageTransformation
}

export interface CloseImage {
	readonly path: string
	readonly hash?: string
	readonly camera?: string
}

export interface SaveImage extends OpenImage {
	readonly saveAt: string
	readonly transformed: boolean
}

export interface AnnotateImage {
	readonly solution: PlateSolution
}

export interface StatisticImage extends Omit<OpenImage, 'statistics'> {
	readonly area?: Rect
	readonly bits: number
	readonly transformed: boolean
}

export interface ImageHistogram {
	readonly standardDeviation: number
	readonly variance: number
	readonly count: readonly [number, number]
	readonly mean: number
	readonly median: number
	readonly maximum: readonly [number, number]
	readonly minimum: readonly [number, number]
	readonly data: readonly number[]
}

export interface ImageCoordinateInterpolation {
	readonly ma: number[]
	readonly md: number[]
	readonly x0: number
	readonly y0: number
	readonly x1: number
	readonly y1: number
	readonly delta: number
}

export interface ImageInfo extends Partial<EquatorialCoordinate>, Size {
	readonly path: string
	readonly mono: boolean
	readonly metadata: ImageMetadata
	readonly transformation: ImageTransformation
	readonly headers: FitsHeader
	readonly solution?: PlateSolution
	readonly hash: string
}

export interface FovItem {
	id: number
	visible: boolean
	focalLength: number // mm
	aperture: number // mm
	readonly cameraWidth: number // px
	readonly cameraHeight: number // px
	readonly pixelWidth: number // μm
	readonly pixelHeight: number // μm
	barlowReducer: number
	bin: number
	rotation: number // deg
	color: string
}

export interface ComputedFov {
	focalRatio: number
	readonly resolution: Size // Camera resolution in arcsec/pixel
	readonly field: Size // FOV in arcmin
	readonly svg: Size // SVG dimensions in % of the image
}

// INDI

export interface IndiServerStart {
	port?: number
	drivers: string[]
	verbose?: number
	repeat?: number
}

export interface IndiServerStatus {
	readonly enabled: boolean
	readonly running: boolean
}

export interface IndiServerEvent {
	readonly pid: number
	readonly code?: number
}

export interface IndiDevicePropertyEvent {
	readonly device: string
	readonly name: string
	readonly property: DeviceProperty
}

export interface DeviceAdded<D extends Device = Device> {
	readonly device: D
}

export interface DeviceUpdated<D extends Device = Device> {
	readonly device: Required<Partial<D>, 'name'>
	readonly property: keyof D
	readonly state?: PropertyState
}

export interface DeviceRemoved<D extends Device = Device> {
	readonly device: D
}

export type CameraAdded = DeviceAdded<Camera>

export type CameraUpdated = DeviceUpdated<Camera>

export type CameraRemoved = DeviceRemoved<Camera>

export type CameraMessageEvent = CameraAdded | CameraUpdated | CameraRemoved

export type MountAdded = DeviceAdded<Mount>

export type MountUpdated = DeviceUpdated<Mount>

export type MountRemoved = DeviceRemoved<Mount>

export type MountMessageEvent = MountAdded | MountUpdated | MountRemoved

export type FocuserAdded = DeviceAdded<Focuser>

export type FocuserUpdated = DeviceUpdated<Focuser>

export type FocuserRemoved = DeviceRemoved<Focuser>

export type WheelAdded = DeviceAdded<Wheel>

export type WheelUpdated = DeviceUpdated<Wheel>

export type WheelRemoved = DeviceRemoved<Wheel>

export type FocuserMessageEvent = FocuserAdded | FocuserUpdated | FocuserRemoved

export type GuideOutputAdded = DeviceAdded<GuideOutput>

export type GuideOutputUpdated = DeviceUpdated<GuideOutput>

export type GuideOutputRemoved = DeviceRemoved<GuideOutput>

export type GuideOutputMessageEvent = GuideOutputAdded | GuideOutputUpdated | GuideOutputRemoved

export type ThermometerAdded = DeviceAdded<Thermometer>

export type ThermometerUpdated = DeviceUpdated<Thermometer>

export type ThermometerRemoved = DeviceRemoved<Thermometer>

export type ThermometerMessageEvent = ThermometerAdded | ThermometerUpdated | ThermometerRemoved

export type CoverAdded = DeviceAdded<Cover>

export type CoverUpdated = DeviceUpdated<Cover>

export type CoverRemoved = DeviceRemoved<Cover>

export type CoverMessageEvent = CoverAdded | CoverUpdated | CoverRemoved

export type FlatPanelAdded = DeviceAdded<FlatPanel>

export type FlatPanelUpdated = DeviceUpdated<FlatPanel>

export type FlatPanelRemoved = DeviceRemoved<FlatPanel>

export type FlatPanelMessageEvent = FlatPanelAdded | FlatPanelUpdated | FlatPanelRemoved

export type DewHeaterAdded = DeviceAdded<DewHeater>

export type DewHeaterUpdated = DeviceUpdated<DewHeater>

export type DewHeaterRemoved = DeviceRemoved<DewHeater>

export type DewHeaterMessageEvent = DewHeaterAdded | DewHeaterUpdated | DewHeaterRemoved

export type DeviceMessageEvent = CameraMessageEvent | MountMessageEvent | FocuserMessageEvent | GuideOutputMessageEvent | ThermometerMessageEvent | CoverMessageEvent | FlatPanelMessageEvent | DewHeaterMessageEvent

export interface GuidePulse {
	direction: GuideDirection
	duration: number
}

// Camera

export type ExposureTimeUnit = 'MINUTE' | 'SECOND' | 'MILLISECOND' | 'MICROSECOND'

export type ExposureMode = 'SINGLE' | 'FIXED' | 'LOOP'

export type AutoSubFolderMode = 'OFF' | 'NOON' | 'MIDNIGHT'

export type CameraCaptureState = 'IDLE' | 'EXPOSURE_STARTED' | 'EXPOSING' | 'WAITING' | 'SETTLING' | 'DITHERING' | 'PAUSING' | 'PAUSED' | 'EXPOSURE_FINISHED'

export interface CameraCaptureStart extends Size {
	exposureTime: number
	exposureTimeUnit: ExposureTimeUnit
	frameType: FrameType
	exposureMode: ExposureMode
	delay: number
	count: number
	x: number
	y: number
	subframe: boolean
	binX: number
	binY: number
	frameFormat: string
	gain: number
	offset: number
	autoSave: boolean
	savePath?: string
	autoSubFolderMode: AutoSubFolderMode
	mount?: string
	wheel?: string
	focuser?: string
}

export interface CameraCaptureTime {
	remainingTime: number
	elapsedTime: number
	progress: number
}

export interface CameraCaptureEvent {
	device: string
	count: number
	loop: boolean
	remainingCount: number
	elapsedCount: number
	state: CameraCaptureState
	totalExposureTime: number
	frameExposureTime: number
	totalProgress: CameraCaptureTime
	frameProgress: CameraCaptureTime
	savedPath?: string
}

// Mount

export type MountRemoteControlProtocol = 'LX200' | 'STELLARIUM'

export interface MountEquatorialCoordinatePosition extends Readonly<EquatorialCoordinate>, Readonly<EquatorialCoordinateJ2000>, Readonly<HorizontalCoordinate> {
	readonly lst: Angle
	readonly constellation: Constellation
	readonly meridianIn: Angle
	readonly pierSide: PierSide
}

export type MountTargetCoordinate<T = string> = (EquatorialCoordinate<T> & { type: 'J2000' | 'JNOW' }) | (HorizontalCoordinate<T> & { type: 'ALTAZ' })

export interface MountRemoteControlStart {
	readonly protocol: MountRemoteControlProtocol
	readonly host: string
	readonly port: number
}

export type MountRemoteControlStatus = Record<MountRemoteControlProtocol, Omit<MountRemoteControlStart, 'protocol'> | false>

export function expectedPierSide(rightAscension: Angle, declination: Angle, lst: Angle): PierSide {
	if (Math.abs(declination) === Math.PI / 2) return 'NEITHER'
	return (toHour(rightAscension - lst) + 24) % 24 < 12 ? 'WEST' : 'EAST'
}

export function computeMeridianTime(rightAscension: Angle, lst: Angle) {
	return normalizeAngle(rightAscension - lst) * (SIDEREAL_DAYSEC / DAYSEC)
}

// Notification

export type Severity = 'info' | 'success' | 'warn' | 'error'

export interface Notification {
	target?: string
	color: 'success' | 'default' | 'foreground' | 'primary' | 'secondary' | 'warning' | 'danger'
	title: string
	description: string
}

// Plate Solver

export type PlateSolverType = 'ASTAP' | 'ASTROMETRY_NET' | 'NOVA_ASTROMETRY_NET'

export interface PlateSolveStart extends Omit<PlateSolveOptions, 'rightAscension' | 'declination' | 'radius'>, EquatorialCoordinate<string | Angle> {
	id: string
	type: PlateSolverType
	executable: string
	path: string
	focalLength: number
	pixelSize: number
	fov: number
	apiUrl?: string
	apiKey?: string
	slot?: number
	blind: boolean
	radius: number // deg
}

export interface PlateSolveStop {
	readonly id: string
}

// Star Detection

export type StarDetectionType = 'ASTAP'

export interface StarDetection {
	type: StarDetectionType
	executable?: string
	path: string
	timeout: number
	minSNR: number
	maxStars: number
	slot: number
}

// Tppa

export type TppaState = 'IDLE' | 'WAITING' | 'MOVING' | 'CAPTURING' | 'SOLVING' | 'ALIGNING' | 'SETTLING'

export interface TppaStart {
	id: string
	readonly direction: 'EAST' | 'WEST'
	readonly moveDuration: number // seconds
	readonly delayBeforeCapture: number // seconds
	readonly maxAttempts: number
	readonly solver: Omit<PlateSolveStart, 'id' | 'path' | 'blind'>
	readonly capture: CameraCaptureStart
	readonly refraction: RefractionParameters
	readonly stopTrackingWhenDone: boolean
	readonly compensateRefraction: boolean
}

export interface TppaStop {
	readonly id: string
}

export interface TppaEvent {
	id: string
	step: number
	state: TppaState
	attempts: number
	solved: boolean
	readonly solver: EquatorialCoordinate
	aligned: boolean
	readonly error: HorizontalCoordinate
	failed: boolean
}

// Darv

export type Hemisphere = 'NORTHERN' | 'SOUTHERN'

export type DarvState = 'IDLE' | 'WAITING' | 'FORWARDING' | 'BACKWARDING'

export interface DarvStart {
	id: string
	readonly hemisphere: Hemisphere
	readonly initialPause: number // seconds
	readonly duration: number // seconds
	readonly capture: CameraCaptureStart
}

export interface DarvStop {
	readonly id: string
}

export interface DarvEvent {
	id: string
	state: DarvState
}

// Misc

export interface Point {
	x: number
	y: number
}

export const X_IMAGE_INFO_HEADER = 'X-Image-Info'

export const DEFAULT_SIZE: Size = {
	width: 0,
	height: 0,
}

export const DEFAULT_CAMERA_CAPTURE_START: CameraCaptureStart = {
	exposureTime: 0,
	exposureTimeUnit: 'MICROSECOND',
	frameType: 'LIGHT',
	exposureMode: 'SINGLE',
	delay: 0,
	count: 1,
	x: 0,
	y: 0,
	width: 0,
	height: 0,
	subframe: false,
	binX: 1,
	binY: 1,
	frameFormat: '',
	gain: 0,
	offset: 0,
	autoSave: false,
	autoSubFolderMode: 'OFF',
}

export const DEFAULT_CAMERA_CAPTURE_EVENT: CameraCaptureEvent = {
	device: '',
	state: 'IDLE',
	count: 0,
	remainingCount: 0,
	elapsedCount: 0,
	loop: false,
	totalExposureTime: 0,
	frameExposureTime: 0,
	totalProgress: {
		remainingTime: 0,
		elapsedTime: 0,
		progress: 0,
	},
	frameProgress: {
		remainingTime: 0,
		elapsedTime: 0,
		progress: 0,
	},
	savedPath: undefined,
}

export const DEFAULT_PLATE_SOLVE_START: PlateSolveStart = {
	id: '',
	type: 'ASTAP',
	executable: '',
	path: '',
	focalLength: 0,
	pixelSize: 0,
	fov: 0,
	blind: true,
	rightAscension: '00 00 00',
	declination: '+00 00 00',
	radius: 4,
	downsample: 0,
	timeout: 300000, // 5 minutes
	apiUrl: '',
	apiKey: '',
}

export const DEFAULT_FRAMING: Framing = {
	id: '0',
	hipsSurvey: 'CDS/P/DSS2/color',
	rightAscension: '00 00 00.00',
	declination: '+00 00 00.00',
	width: 800,
	height: 600,
	fov: 1,
	focalLength: 500,
	pixelSize: 3.5,
	rotation: 0,
}

export const DEFAULT_STAR_DETECTION: StarDetection = {
	type: 'ASTAP',
	path: '',
	timeout: 30000,
	minSNR: 0,
	maxStars: 0,
	slot: 0,
}

export const DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION: MountEquatorialCoordinatePosition = {
	rightAscension: 0,
	declination: 0,
	rightAscensionJ2000: 0,
	declinationJ2000: 0,
	azimuth: 0,
	altitude: 0,
	lst: 0,
	constellation: 'AND',
	meridianIn: 0,
	pierSide: 'NEITHER',
}

export const DEFAULT_IMAGE_STRETCH: ImageStretch = {
	auto: true,
	shadow: 0,
	highlight: 65536,
	midtone: 32768,
	meanBackground: 0.25,
}

export const DEFAULT_IMAGE_SCNR: ImageScnr = {
	channel: undefined,
	amount: 0.5,
	method: 'MAXIMUM_MASK',
}

export const DEFAULT_IMAGE_ADJUSTMENT: ImageAdjustment = {
	enabled: false,
	brightness: {
		value: 1,
	},
	contrast: {
		value: 1,
	},
	gamma: {
		value: 1,
	},
	saturation: {
		value: 1,
		channel: 'BT709',
	},
}

export const DEFAULT_IMAGE_FILTER: ImageFilter = {
	enabled: false,
	type: 'sharpen',
	mean: {
		size: 3,
	},
	blur: {
		size: 3,
	},
	gaussianBlur: {
		sigma: 1.4,
		size: 5,
	},
}

export const DEFAULT_IMAGE_TRANSFORMATION: ImageTransformation = {
	enabled: true,
	debayer: true,
	stretch: DEFAULT_IMAGE_STRETCH,
	horizontalMirror: false,
	verticalMirror: false,
	invert: false,
	scnr: DEFAULT_IMAGE_SCNR,
	format: {
		type: 'jpeg',
		jpeg: {
			quality: 90,
			chrominanceSubsampling: '4:2:0',
		},
	},
	adjustment: DEFAULT_IMAGE_ADJUSTMENT,
	filter: DEFAULT_IMAGE_FILTER,
}

export const DEFAULT_FOV_ITEM: FovItem = {
	id: 0,
	visible: true,
	// William Optics RedCat 51
	focalLength: 250,
	aperture: 51,
	// ZWO ASI2600MM
	cameraWidth: 6248,
	cameraHeight: 4176,
	pixelWidth: 3.76,
	pixelHeight: 3.76,
	barlowReducer: 1,
	bin: 1,
	rotation: 0,
	color: '#fff',
}

export const DEFAULT_COMPUTED_FOV: ComputedFov = {
	focalRatio: 0,
	resolution: DEFAULT_SIZE,
	field: DEFAULT_SIZE,
	svg: DEFAULT_SIZE,
}

export const DEFAULT_GEOGRAPHIC_COORDINATE: GeographicCoordinate = {
	latitude: 0,
	longitude: 0,
	elevation: 0,
}

export const DEFAULT_TIME: UTCTime = {
	utc: 0,
	offset: 0,
}

export const DEFAULT_POSITION_OF_BODY: PositionOfBody = {
	location: DEFAULT_GEOGRAPHIC_COORDINATE,
	time: DEFAULT_TIME,
}

export const DEFAULT_SKY_OBJECT_SEARCH: SearchSkyObject = {
	name: '',
	nameType: -1,
	constellations: [],
	types: [],
	magnitudeMin: -30,
	magnitudeMax: 30,
	rightAscension: '00 00 00.00',
	declination: '+00 00 00.00',
	radius: 0,
	visible: false,
	visibleAbove: 0,
	...DEFAULT_POSITION_OF_BODY,
	page: 1,
	limit: 4,
	sort: {
		column: 'magnitude',
		direction: 'ascending',
	},
}

export const DEFAULT_BODY_POSITION: BodyPosition = {
	magnitude: 0,
	constellation: 'AND',
	distance: 0,
	illuminated: 0,
	elongation: 0,
	leading: false,
	rightAscension: 0,
	declination: 0,
	rightAscensionJ2000: 0,
	declinationJ2000: 0,
	azimuth: 0,
	altitude: 0,
	names: [],
	pierSide: 'NEITHER',
}

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

export const DEFAULT_MINOR_PLANET: MinorPlanet = {
	name: '',
	id: '',
	pha: false,
	neo: false,
	orbitType: '',
}

export const DEFAULT_SKY_OBJECT_SEARCH_ITEM: SkyObjectSearchItem = {
	id: 0,
	type: 0,
	constellation: 0,
	magnitude: 0,
	name: '',
}

export const DEFAULT_SEARCH_SATELLITE: SearchSatellite = {
	text: '',
	groups: ['AMATEUR', 'BEIDOU', 'GALILEO', 'GLONASS', 'GNSS', 'GPS', 'ONEWEB', 'SCIENCE', 'STARLINK', 'STATIONS', 'VISUAL'],
	category: ['SPECIAL', 'WEATHER', 'COMMUNICATION', 'NAVIGATION', 'SCIENTIFIC'],
	page: 1,
	limit: 4,
	sort: {
		column: 'name',
		direction: 'ascending',
	},
}

export const DEFAULT_SATELLITE: Satellite = {
	id: 0,
	name: '',
	groups: [],
	line1: '',
	line2: '',
	line3: '',
}

export const DEFAULT_INDI_SERVER_START: Required<IndiServerStart> = {
	port: 7624,
	repeat: 1,
	verbose: 0,
	drivers: [],
}

export const DEFAULT_TPPA_START: TppaStart = {
	id: '',
	direction: 'EAST',
	moveDuration: 5,
	delayBeforeCapture: 5,
	maxAttempts: 15,
	solver: DEFAULT_PLATE_SOLVE_START,
	capture: DEFAULT_CAMERA_CAPTURE_START,
	refraction: DEFAULT_REFRACTION_PARAMETERS,
	stopTrackingWhenDone: true,
	compensateRefraction: true,
}

export const DEFAULT_TPPA_EVENT: TppaEvent = {
	id: '',
	step: 0,
	state: 'IDLE',
	attempts: 0,
	solved: false,
	aligned: false,
	failed: false,
	solver: {
		rightAscension: 0,
		declination: 0,
	},
	error: {
		azimuth: 0,
		altitude: 0,
	},
}

export const DEFAULT_DARV_START: DarvStart = {
	id: '',
	hemisphere: 'NORTHERN',
	initialPause: 5,
	duration: 30,
	capture: DEFAULT_CAMERA_CAPTURE_START,
}

export const DEFAULT_DARV_EVENT: DarvEvent = {
	id: '',
	state: 'IDLE',
}
