import type { Angle } from 'nebulosa/src/angle'
import type { FitsHeader } from 'nebulosa/src/fits'
import type { CfaPattern, ImageChannel, ImageFormat, ImageMetadata } from 'nebulosa/src/image'
import type { PropertyState } from 'nebulosa/src/indi'
import type { PlateSolution, PlateSolveOptions } from 'nebulosa/src/platesolver'

// Atlas

export interface PositionOfBody {
	dateTime: string
	longitude: number
	latitude: number
	elevation: number
}

export interface AltitudeChartOfBody {
	dateTime: string
	stepSize: number
}

export interface BodyPosition {
	rightAscensionJ2000: number
	declinationJ2000: number
	rightAscension: number
	declination: number
	azimuth: number
	altitude: number
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

export interface Framing {
	hipsSurvey: string
	rightAscension: string | Angle
	declination: string | Angle
	width: number
	height: number
	fov: number // deg
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

export interface ImageInfo {
	path: string
	originalPath: string
	width: number
	height: number
	mono: boolean
	metadata: ImageMetadata
	transformation: ImageTransformation
	rightAscension?: Angle
	declination?: Angle
	headers: FitsHeader
	solution?: PlateSolution
}

// INDI

export type DeviceType = 'CAMERA' | 'MOUNT' | 'WHEEL' | 'FOCUSER' | 'ROTATOR' | 'GPS' | 'DOME' | 'GUIDE_OUTPUT' | 'LIGHT_BOX' | 'DUST_CAP'

export type SubDeviceType = 'GUIDE_OUTPUT' | 'THERMOMETER' | 'GPS' | 'DEW_HEATER'

export type GuideDirection = 'NORTH' | 'SOUTH' | 'WEST' | 'EAST'

export interface DeviceAdded<T extends Lowercase<DeviceType | SubDeviceType>, D extends Device> extends WebSocketMessage {
	readonly type: `${T}.add`
	readonly device: D
}

export interface DeviceUpdated<T extends Lowercase<DeviceType | SubDeviceType>, D extends Device> extends WebSocketMessage {
	readonly type: `${T}.update`
	readonly device: string
	readonly property: keyof D
	readonly value: D[keyof D]
	readonly state?: PropertyState
}

export interface DeviceRemoved<T extends Lowercase<DeviceType | SubDeviceType>, D extends Device> extends WebSocketMessage {
	readonly type: `${T}.remove`
	readonly device: D
}

export type CameraAdded = DeviceAdded<'camera', Camera>

export type CameraUpdated = DeviceUpdated<'camera', Camera>

export type CameraRemoved = DeviceRemoved<'camera', Camera>

export type CameraEvent = CameraAdded | CameraUpdated | CameraRemoved

export type GuideOutputAdded = DeviceAdded<'guide_output', GuideOutput>

export type GuideOutputUpdated = DeviceUpdated<'guide_output', GuideOutput>

export type GuideOutputRemoved = DeviceRemoved<'guide_output', GuideOutput>

export type GuideOutputEvent = GuideOutputAdded | GuideOutputUpdated | GuideOutputRemoved

export type ThermometerAdded = DeviceAdded<'thermometer', Thermometer>

export type ThermometerUpdated = DeviceUpdated<'thermometer', Thermometer>

export type ThermometerRemoved = DeviceRemoved<'thermometer', Thermometer>

export type ThermometerEvent = ThermometerAdded | ThermometerUpdated | ThermometerRemoved

export type DeviceEvent = CameraEvent | GuideOutputEvent | ThermometerEvent

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
	client: ConnectionStatus
}

export interface Thermometer extends Device {
	hasThermometer: boolean
	temperature: number
}

export interface GuideOutput extends Device {
	canPulseGuide: boolean
	pulseGuiding: boolean
}

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

export interface GuidePulse {
	direction: GuideDirection
	duration: number
}

// Message

export interface WebSocketMessage {
	type: 'notification' | 'confirmation' | `${Lowercase<DeviceType | SubDeviceType>}.${'add' | 'update' | 'remove'}`
}

// Notification

export type Severity = 'info' | 'success' | 'warn' | 'error'

export interface Notification extends WebSocketMessage {
	readonly type: 'notification'
	target?: string
	severity?: Severity
	title?: string
	body: string
}

// Plate Solver

export type PlateSolverType = 'ASTAP' | 'PIXINSIGHT' | 'ASTROMETRY_NET' | 'NOVA_ASTROMETRY_NET' | 'SIRIL'

export interface PlateSolveStart extends Omit<PlateSolveOptions, 'ra' | 'dec' | 'radius'> {
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
	ra: string | number // hours
	dec: string | number // deg
	radius: number // deg
}

export interface PlateSolveStop {
	id: string
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
	ra: '00 00 00',
	dec: '+000 00 00',
	radius: 4,
	downsample: 0,
	timeout: 300000, // 5 minutes
	apiUrl: '',
	apiKey: '',
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

export const DEFAULT_STAR_DETECTION: StarDetection = {
	type: 'ASTAP',
	path: '',
	timeout: 30000,
	minSNR: 0,
	maxStars: 0,
	slot: 0,
}

// Misc

export interface Point {
	x: number
	y: number
}

export const X_IMAGE_INFO_HEADER = 'X-Image-Info'

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
	client: {
		id: '',
		type: 'INDI',
		host: '',
		port: 0,
	},
	hasThermometer: false,
	temperature: 0,
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
