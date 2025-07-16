import type { MoleculeOrInterface } from 'bunshi'
import { type Angle, toHour } from 'nebulosa/src/angle'
import type { Constellation } from 'nebulosa/src/constellation'
import type { FitsHeader } from 'nebulosa/src/fits'
import type { CfaPattern, ImageChannel, ImageFormat, ImageMetadata } from 'nebulosa/src/image'
import type { DefVector, PropertyState, VectorType } from 'nebulosa/src/indi'
import type { PlateSolution, PlateSolveOptions } from 'nebulosa/src/platesolver'
import type { PickByValue, Required } from 'utility-types'

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
	latitude: number // deg
	longitude: number // deg
	elevation: number // m
}

// Atlas

export interface PositionOfBody extends GeographicCoordinate {
	dateTime: string
}

export interface ChartOfBody {
	type: keyof PickByValue<BodyPosition, number>
	dateTime: string
	stepSize: number
}

export interface BodyPosition extends EquatorialCoordinate, EquatorialCoordinateJ2000, HorizontalCoordinate {
	magnitude: number
	constellation: string
	distance: number
	distanceUnit: string
	illuminated: number
	elongation: number
	leading: boolean
}

// Confirmation

export interface Confirm {
	key: string
	accepted: boolean
}

export interface Confirmation extends WebSocketMessage {
	readonly type: 'confirmation'
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

export type DeviceType = 'CAMERA' | 'MOUNT' | 'WHEEL' | 'FOCUSER' | 'ROTATOR' | 'GPS' | 'DOME' | 'GUIDE_OUTPUT' | 'LIGHT_BOX' | 'DUST_CAP' | 'THERMOMETER' | 'DEW_HEATER'

export type GuideDirection = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'

export interface IndiSpawn {
	port?: number
	drivers: string[]
	verbose?: number
}

export interface DeviceAdded<T extends string, D extends Device> extends WebSocketMessage {
	readonly type: `${T}:add`
	readonly device: D
}

export interface DeviceUpdated<T extends string, D extends Device> extends WebSocketMessage {
	readonly type: `${T}:update`
	readonly device: Required<Partial<D>, 'name'>
	readonly property: keyof D
	readonly state?: PropertyState
}

export interface DeviceRemoved<T extends string, D extends Device> extends WebSocketMessage {
	readonly type: `${T}:remove`
	readonly device: D
}

export type CameraAdded = DeviceAdded<'camera', Camera>

export type CameraUpdated = DeviceUpdated<'camera', Camera>

export type CameraRemoved = DeviceRemoved<'camera', Camera>

export type CameraMessageEvent = CameraAdded | CameraUpdated | CameraRemoved

export type MountAdded = DeviceAdded<'mount', Mount>

export type MountUpdated = DeviceUpdated<'mount', Mount>

export type MountRemoved = DeviceRemoved<'mount', Mount>

export type MountMessageEvent = MountAdded | MountUpdated | MountRemoved

export type GuideOutputAdded = DeviceAdded<'guideOutput', GuideOutput>

export type GuideOutputUpdated = DeviceUpdated<'guideOutput', GuideOutput>

export type GuideOutputRemoved = DeviceRemoved<'guideOutput', GuideOutput>

export type GuideOutputMessageEvent = GuideOutputAdded | GuideOutputUpdated | GuideOutputRemoved

export type ThermometerAdded = DeviceAdded<'thermometer', Thermometer>

export type ThermometerUpdated = DeviceUpdated<'thermometer', Thermometer>

export type ThermometerRemoved = DeviceRemoved<'thermometer', Thermometer>

export type ThermometerMessageEvent = ThermometerAdded | ThermometerUpdated | ThermometerRemoved

export type DeviceMessageEvent = CameraMessageEvent | MountMessageEvent | GuideOutputMessageEvent | ThermometerMessageEvent

export interface DriverInfo {
	executable: string
	version: string
}

export type DeviceProperty = DefVector & {
	type: VectorType
}

export interface Device {
	type: DeviceType
	id: string
	name: string
	connected: boolean
	driver: DriverInfo
	properties: Record<string, DeviceProperty | undefined>
}

// Thermometer

export interface Thermometer extends Device {
	hasThermometer: boolean
	temperature: number
}

// Guide Output

export interface GuideOutput extends Device {
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
	hasCoolerControl: boolean
	coolerPower: number
	cooler: boolean
	hasDewHeater: boolean
	dewHeater: boolean
	frameFormats: string[]
	canAbort: boolean
	cfa: {
		offsetX: number
		offsetY: number
		type: CfaPattern
	}
	exposure: {
		time: number
		min: number
		max: number
		state: PropertyState
	}
	hasCooler: boolean
	canSetTemperature: boolean
	canSubFrame: boolean
	frame: {
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
	bin: {
		maxX: number
		maxY: number
		x: number
		y: number
	}
	gain: {
		value: number
		min: number
		max: number
	}
	offset: {
		value: number
		min: number
		max: number
	}
	pixelSize: {
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

export interface CameraCaptureProgress {
	remainingTime: number
	elapsedTime: number
	progress: number
}

export interface CameraCaptureTaskEvent extends WebSocketMessage {
	readonly type: 'camera:capture'
	device: string
	count: number
	loop: boolean
	remainingCount: number
	elapsedCount: number
	state: CameraCaptureState
	totalExposureTime: number
	frameExposureTime: number
	totalProgress: CameraCaptureProgress
	frameProgress: CameraCaptureProgress
	savedPath?: string
}

// GPS

export interface Gps extends Device {
	hasGps: boolean
	readonly geographicCoordinate: GeographicCoordinate
}

// Mount

export type PierSide = 'EAST' | 'WEST' | 'NEITHER'

export type MountType = 'ALTAZ' | 'EQ_FORK' | 'EQ_GEM'

export type TrackMode = 'SIDEREAL' | 'SOLAR' | 'LUNAR' | 'KING' | 'CUSTOM'

export type TargetCoordinateType = 'J2000' | 'JNOW' | 'ALTAZ'

export interface Parkable {
	canPark: boolean
	parking: boolean
	parked: boolean
}

export interface SlewRate {
	name: string
	label: string
}

export interface Mount extends GuideOutput, Gps, Parkable {
	slewing: boolean
	tracking: boolean
	canAbort: boolean
	canSync: boolean
	canGoTo: boolean
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

export function expectedPierSide(rightAscension: Angle, declination: Angle, lst: Angle): PierSide {
	if (Math.abs(declination) === Math.PI / 2) return 'NEITHER'
	return (toHour(rightAscension - lst) + 24) % 24 < 12 ? 'WEST' : 'EAST'
}

// Message

export interface WebSocketMessage {
	readonly type: string
}

// Notification

export type Severity = 'info' | 'success' | 'warn' | 'error'

export interface Notification extends WebSocketMessage {
	readonly type: 'NOTIFICATION'
	target?: string
	severity?: Severity
	title?: string
	body: string
}

// Plate Solver

export type PlateSolverType = 'ASTAP' | 'PIXINSIGHT' | 'ASTROMETRY_NET' | 'NOVA_ASTROMETRY_NET' | 'SIRIL'

export interface PlateSolveStart extends Omit<PlateSolveOptions, 'ra' | 'dec' | 'radius'>, EquatorialCoordinate<string> {
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
	id: string
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

// Misc

export interface Point {
	x: number
	y: number
}

export const X_IMAGE_INFO_HEADER = 'X-Image-Info'

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
	autoSave: true,
	autoSubFolderMode: 'OFF',
}

export const DEFAULT_CAMERA_CAPTURE_TASK_EVENT: CameraCaptureTaskEvent = {
	type: 'camera:capture',
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
	properties: {},
}

export const DEFAULT_MOUNT: Mount = {
	slewing: false,
	tracking: false,
	canAbort: false,
	canSync: false,
	canGoTo: false,
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
	properties: {},
	hasGps: false,
	geographicCoordinate: {
		latitude: 0,
		longitude: 0,
		elevation: 0,
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
	meridianAt: '00:00 (00:00)',
	pierSide: 'NEITHER',
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
	properties: {},
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
	properties: {},
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

export function isCamera(device: Device): device is Camera {
	return device.type === 'CAMERA'
}

export function isThermometer(device: Device): device is Thermometer {
	return 'hasThermometer' in device && device.hasThermometer !== undefined
}

export function isGuideOutput(device: Device): device is GuideOutput {
	return 'canPulseGuide' in device && device.canPulseGuide !== undefined
}

export function isGPS(device: Device): device is Gps {
	return 'hasGPS' in device && device.hasGPS !== undefined
}
