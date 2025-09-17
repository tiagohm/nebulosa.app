import type { SortDescriptor } from '@heroui/react'
import type { MoleculeOrInterface } from 'bunshi'
import { type Angle, toHour } from 'nebulosa/src/angle'
import { DEFAULT_REFRACTION_PARAMETERS, type RefractionParameters } from 'nebulosa/src/astrometry'
import type { Constellation } from 'nebulosa/src/constellation'
import type { Distance } from 'nebulosa/src/distance'
import type { FitsHeader } from 'nebulosa/src/fits'
import type { CfaPattern, ImageChannel, ImageFormat, ImageMetadata } from 'nebulosa/src/image'
import type { DefBlobVector, DefLightVector, DefNumber, DefNumberVector, DefSwitchVector, DefTextVector, PropertyState } from 'nebulosa/src/indi'
import type { LunarPhase } from 'nebulosa/src/moon'
import type { PlateSolution, PlateSolveOptions } from 'nebulosa/src/platesolver'
import type { StellariumObjectType } from 'nebulosa/src/stellarium'
import type { Temporal } from 'nebulosa/src/temporal'
import type { Velocity } from 'nebulosa/src/velocity'
import type { Required } from 'utility-types'

export type Atom<T> = T extends MoleculeOrInterface<infer X> ? X : never

export interface EquatorialCoordinate<T = Angle> {
	rightAscension: T
	declination: T
}

export interface EquatorialCoordinateJ2000<T = Angle> {
	rightAscensionJ2000: T
	declinationJ2000: T
}

export interface HorizontalCoordinate<T = Angle> {
	azimuth: T
	altitude: T
}

export interface GeographicCoordinate {
	latitude: Angle
	longitude: Angle
	elevation: Distance
}

export interface UTCTime {
	utc: number // milliseconds since epoch
	offset: number // minutes
}

export interface LocationAndTime {
	readonly location: GeographicCoordinate
	readonly time: UTCTime
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

export type SolarImageSource = (typeof SOLAR_IMAGE_SOURCES)[number]

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

export interface SkyObjectSearch extends LocationAndTime {
	readonly name: string
	readonly nameType: number
	readonly constellations: number[]
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
}

export interface BodyPosition extends Readonly<EquatorialCoordinate>, Readonly<EquatorialCoordinateJ2000>, Readonly<HorizontalCoordinate> {
	readonly magnitude: number
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

export interface Framing extends EquatorialCoordinate<string> {
	id: number
	hipsSurvey: string
	width: number
	height: number
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
	normalize: boolean
	brightness: number
	contrast: number
	gamma: number
	saturation: number
}

export interface ImageFilter {
	enabled: boolean
	blur: boolean
	median: boolean
	sharpen: boolean
}

export interface ImageTransformation {
	calibrationGroup?: string
	debayer: boolean
	stretch: ImageStretch
	horizontalMirror: boolean
	verticalMirror: boolean
	invert: boolean
	scnr: ImageScnr
	format: ImageFormat
	adjustment: ImageAdjustment
	filter: ImageFilter
}

export interface OpenImage {
	path?: string
	camera?: string
	transformation: ImageTransformation
}

export interface CloseImage {
	id: string
}

export interface ImageInfo extends Partial<EquatorialCoordinate> {
	path: string
	originalPath: string
	width: number
	height: number
	mono: boolean
	metadata: ImageMetadata
	transformation: ImageTransformation
	headers: FitsHeader
	solution?: PlateSolution
}

// INDI

export type DeviceType = 'CAMERA' | 'MOUNT' | 'WHEEL' | 'FOCUSER' | 'ROTATOR' | 'GPS' | 'DOME' | 'GUIDE_OUTPUT' | 'FLAT_PANEL' | 'COVER' | 'THERMOMETER' | 'DEW_HEATER'

export type GuideDirection = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'

export interface IndiServerStart {
	port?: number
	drivers: string[]
	verbose?: number
	repeat?: number
}

export interface IndiServerStatus {
	readonly enabled: boolean
	readonly running: boolean
	readonly drivers: string[]
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

export type DeviceProperty = (DefTextVector & { type: 'TEXT' }) | (DefNumberVector & { type: 'NUMBER' }) | (DefSwitchVector & { type: 'SWITCH' }) | (DefLightVector & { type: 'LIGHT' }) | (DefBlobVector & { type: 'BLOB' })

export type DeviceProperties = Record<string, DeviceProperty>

export interface DriverInfo {
	executable: string
	version: string
}

export interface Device {
	type: DeviceType
	id: string
	name: string
	connected: boolean
	driver: DriverInfo
	// properties: DeviceProperties
}

// Thermometer

export interface Thermometer extends Device {
	readonly type: 'THERMOMETER' | 'CAMERA' | 'FOCUSER'
	hasThermometer: boolean
	temperature: number
}

// Guide Output

export interface GuideOutput extends Device {
	readonly type: 'GUIDE_OUTPUT' | 'MOUNT' | 'CAMERA'
	canPulseGuide: boolean
	pulseGuiding: boolean
}

export interface GuidePulse {
	direction: GuideDirection
	duration: number
}

// Camera

export type FrameType = 'LIGHT' | 'DARK' | 'FLAT' | 'BIAS'

export type ExposureTimeUnit = 'MINUTE' | 'SECOND' | 'MILLISECOND' | 'MICROSECOND'

export type ExposureMode = 'SINGLE' | 'FIXED' | 'LOOP'

export type AutoSubFolderMode = 'OFF' | 'NOON' | 'MIDNIGHT'

export type CameraCaptureState = 'IDLE' | 'EXPOSURE_STARTED' | 'EXPOSING' | 'WAITING' | 'SETTLING' | 'DITHERING' | 'PAUSING' | 'PAUSED' | 'EXPOSURE_FINISHED'

export interface Camera extends GuideOutput, Thermometer {
	readonly type: 'CAMERA'
	hasCoolerControl: boolean
	coolerPower: number
	cooler: boolean
	hasDewHeater: boolean
	dewHeater: boolean
	frameFormats: string[]
	canAbort: boolean
	readonly cfa: {
		offsetX: number
		offsetY: number
		type: CfaPattern
	}
	readonly exposure: {
		time: number
		min: number
		max: number
		state: PropertyState
	}
	hasCooler: boolean
	canSetTemperature: boolean
	canSubFrame: boolean
	readonly frame: {
		x: number
		minX: number
		maxX: number
		y: number
		minY: number
		maxY: number
		width: number
		minWidth: number
		maxWidth: number
		height: number
		minHeight: number
		maxHeight: number
	}
	canBin: boolean
	readonly bin: {
		maxX: number
		maxY: number
		x: number
		y: number
	}
	readonly gain: Pick<DefNumber, 'min' | 'max' | 'value'>
	readonly offset: Pick<DefNumber, 'min' | 'max' | 'value'>
	readonly pixelSize: {
		x: number
		y: number
	}
}

export interface CameraCaptureStart {
	exposureTime: number
	exposureTimeUnit: ExposureTimeUnit
	frameType: FrameType
	exposureMode: ExposureMode
	delay: number
	count: number
	x: number
	y: number
	width: number
	height: number
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

// GPS

export interface GPS extends Device {
	readonly type: 'GPS' | 'MOUNT'
	hasGPS: boolean
	readonly geographicCoordinate: GeographicCoordinate
	readonly time: UTCTime
}

// Mount

export type PierSide = 'EAST' | 'WEST' | 'NEITHER'

export type MountType = 'ALTAZ' | 'EQ_FORK' | 'EQ_GEM'

export type TrackMode = 'SIDEREAL' | 'SOLAR' | 'LUNAR' | 'KING' | 'CUSTOM'

export type TargetCoordinateType = 'J2000' | 'JNOW' | 'ALTAZ'

export type MountRemoteControlProtocol = 'LX200' | 'STELLARIUM'

export interface Parkable {
	canPark: boolean
	parking: boolean
	parked: boolean
}

export interface SlewRate {
	name: string
	label: string
}

export interface Mount extends GuideOutput, GPS, Parkable {
	readonly type: 'MOUNT'
	slewing: boolean
	tracking: boolean
	canAbort: boolean
	canSync: boolean
	canGoTo: boolean
	canSlew: boolean
	canHome: boolean
	slewRates: SlewRate[]
	slewRate?: SlewRate['name']
	mountType: MountType
	trackModes: TrackMode[]
	trackMode: TrackMode
	pierSide: PierSide
	guideRateWE: number
	guideRateNS: number
	readonly equatorialCoordinate: EquatorialCoordinate
}

export interface MountEquatorialCoordinatePosition extends Readonly<EquatorialCoordinate>, Readonly<EquatorialCoordinateJ2000>, Readonly<HorizontalCoordinate> {
	readonly lst: string
	readonly constellation: Constellation
	readonly meridianAt: string
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

// Focuser

export interface Focuser extends Device, Thermometer {
	readonly type: 'FOCUSER'
	moving: boolean
	readonly position: Pick<DefNumber, 'min' | 'max' | 'value'>
	canAbsoluteMove: boolean
	canRelativeMove: boolean
	canAbort: boolean
	canReverse: boolean
	reversed: boolean
	canSync: boolean
	hasBacklash: boolean
}

// Cover

export interface Cover extends Device, Parkable, DewHeater {
	readonly type: 'COVER'
}

// Flat Panel

export interface FlatPanel extends Device {
	readonly type: 'FLAT_PANEL'
	enabled: boolean
	readonly intensity: Pick<DefNumber, 'min' | 'max' | 'value'>
}

// DEW_HEATER

export interface DewHeater extends Device {
	readonly type: 'DEW_HEATER' | 'CAMERA' | 'COVER'
	hasDewHeater: boolean
	readonly pwm: Pick<DefNumber, 'min' | 'max' | 'value'>
}

// Notification

export type Severity = 'info' | 'success' | 'warn' | 'error'

export interface Notification {
	target?: string
	severity?: Severity
	title?: string
	body: string
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

export type TppaState = 'IDLE' | 'MOVING' | 'CAPTURING' | 'SOLVING' | 'ALIGNING'

export interface TppaStart {
	id: string
	readonly direction: 'EAST' | 'WEST'
	readonly moveDuration: number // seconds
	readonly settleDuration: number // seconds
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
export const X_IMAGE_PATH_HEADER = 'X-Image-Path'

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
	id: 0,
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

export const DEFAULT_CAMERA: Camera = {
	hasCoolerControl: false,
	coolerPower: 0,
	cooler: false,
	hasDewHeater: false,
	dewHeater: false,
	frameFormats: [],
	canAbort: false,
	cfa: {
		offsetX: 0,
		offsetY: 0,
		type: 'RGGB',
	},
	exposure: {
		time: 0,
		min: 0,
		max: 0,
		state: 'Idle',
	},
	hasCooler: false,
	canSetTemperature: false,
	canSubFrame: false,
	frame: {
		x: 0,
		minX: 0,
		maxX: 0,
		y: 0,
		minY: 0,
		maxY: 0,
		width: 0,
		minWidth: 0,
		maxWidth: 0,
		height: 0,
		minHeight: 0,
		maxHeight: 0,
	},
	canBin: false,
	bin: {
		maxX: 0,
		maxY: 0,
		x: 0,
		y: 0,
	},
	gain: {
		value: 0,
		min: 0,
		max: 0,
	},
	offset: {
		value: 0,
		min: 0,
		max: 0,
	},
	pixelSize: {
		x: 0,
		y: 0,
	},
	canPulseGuide: false,
	pulseGuiding: false,
	type: 'CAMERA',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	hasThermometer: false,
	temperature: 0,
	// properties: {},
}

export const DEFAULT_MOUNT: Mount = {
	slewing: false,
	tracking: false,
	canAbort: false,
	canSync: false,
	canGoTo: false,
	canSlew: false,
	canHome: false,
	canPark: false,
	slewRates: [],
	mountType: 'EQ_GEM',
	trackModes: [],
	trackMode: 'SIDEREAL',
	pierSide: 'NEITHER',
	guideRateWE: 0,
	guideRateNS: 0,
	equatorialCoordinate: {
		rightAscension: 0,
		declination: 0,
	},
	canPulseGuide: false,
	pulseGuiding: false,
	type: 'MOUNT',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
	hasGPS: false,
	geographicCoordinate: {
		latitude: 0,
		longitude: 0,
		elevation: 0,
	},
	time: {
		utc: 0,
		offset: 0,
	},
	parking: false,
	parked: false,
}

export const DEFAULT_MOUNT_EQUATORIAL_COORDINATE_POSITION: MountEquatorialCoordinatePosition = {
	rightAscension: 0,
	declination: 0,
	rightAscensionJ2000: 0,
	declinationJ2000: 0,
	azimuth: 0,
	altitude: 0,
	lst: '00:00',
	constellation: 'AND',
	meridianAt: '00:00',
	pierSide: 'NEITHER',
}

export const DEFAULT_FOCUSER: Focuser = {
	type: 'FOCUSER',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
	moving: false,
	position: {
		value: 0,
		min: 0,
		max: 100,
	},
	canAbsoluteMove: false,
	canRelativeMove: false,
	canAbort: false,
	canReverse: false,
	reversed: false,
	canSync: false,
	hasBacklash: false,
	hasThermometer: false,
	temperature: 0,
}

export const DEFAULT_THERMOMETER: Thermometer = {
	hasThermometer: true,
	temperature: 0,
	type: 'THERMOMETER',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
}

export const DEFAULT_GUIDE_OUTPUT: GuideOutput = {
	canPulseGuide: false,
	pulseGuiding: false,
	type: 'GUIDE_OUTPUT',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
}

export const DEFAULT_COVER: Cover = {
	canPark: false,
	parking: false,
	parked: false,
	hasDewHeater: false,
	pwm: {
		value: 0,
		min: 0,
		max: 100,
	},
	type: 'COVER',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
}

export const DEFAULT_FLAT_PANEL: FlatPanel = {
	enabled: false,
	intensity: {
		value: 0,
		min: 0,
		max: 100,
	},
	type: 'FLAT_PANEL',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
}

export const DEFAULT_DEW_HEATER: DewHeater = {
	hasDewHeater: false,
	pwm: {
		value: 0,
		min: 0,
		max: 100,
	},
	type: 'DEW_HEATER',
	id: '',
	name: '',
	connected: false,
	driver: {
		executable: '',
		version: '',
	},
	// properties: {},
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
	normalize: false,
	brightness: 1,
	contrast: 1,
	gamma: 1,
	saturation: 1,
}

export const DEFAULT_IMAGE_FILTER: ImageFilter = {
	enabled: false,
	blur: false,
	median: false,
	sharpen: false,
}

export const DEFAULT_IMAGE_TRANSFORMATION: ImageTransformation = {
	debayer: true,
	stretch: DEFAULT_IMAGE_STRETCH,
	horizontalMirror: false,
	verticalMirror: false,
	invert: false,
	scnr: DEFAULT_IMAGE_SCNR,
	format: 'jpeg',
	adjustment: DEFAULT_IMAGE_ADJUSTMENT,
	filter: DEFAULT_IMAGE_FILTER,
}

export const DEFAULT_POSITION_OF_BODY: PositionOfBody = {
	location: {
		latitude: 0,
		longitude: 0,
		elevation: 0,
	},
	time: {
		utc: 0,
		offset: 0,
	},
}

export const DEFAULT_SKY_OBJECT_SEARCH: SkyObjectSearch = {
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
	limit: 5,
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

export const DEFAULT_SKY_OBJECT_SEARCH_ITEM: SkyObjectSearchItem = {
	id: 0,
	type: 0,
	constellation: 0,
	magnitude: 0,
	name: '',
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
	settleDuration: 2,
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

export function isCamera(device: Device): device is Camera {
	return device.type === 'CAMERA'
}

export function isMount(device: Device): device is Mount {
	return device.type === 'MOUNT'
}

export function isThermometer(device: Device): device is Thermometer {
	return 'hasThermometer' in device && device.hasThermometer !== undefined
}

export function isGuideOutput(device: Device): device is GuideOutput {
	return 'canPulseGuide' in device && device.canPulseGuide !== undefined
}

export function isDewHeater(device: Device): device is DewHeater {
	return 'hasDewHeater' in device && device.hasDewHeater !== undefined
}

export function isGPS(device: Device): device is GPS {
	return 'hasGPS' in device && device.hasGPS !== undefined
}
