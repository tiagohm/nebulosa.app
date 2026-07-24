import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Constellation } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { EquatorialCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import type { DeepRequired, RequiredOnly } from 'nebulosa/src/core/types'
import { DEFAULT_PHD2_SETTLE, type PHD2Settle } from 'nebulosa/src/devices/guiding/phd2'
import type { Camera, Cover, Device, DeviceProperty, DeviceType, DewHeater, FlatPanel, Focuser, GuideDirection, GuideOutput, Mount, PierSide, Power, Rotator, Thermometer, Wheel } from 'nebulosa/src/devices/indi/device'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import type { CfaPattern, ImageChannel, ImageChannelOrGray, ImageFormat, ImageMetadata, WriteImageToFormatOptions } from 'nebulosa/src/imaging/model/types'
import type { SigmaClipOptions } from 'nebulosa/src/imaging/processing/computation'
import type { FFTFilterType } from 'nebulosa/src/imaging/processing/fft'
import type { SCNRProtectionMethod } from 'nebulosa/src/imaging/processing/scnr'
import type { FitsHeader } from 'nebulosa/src/io/formats/fits/fits'
import type { Point, Rect, Size } from 'nebulosa/src/math/numerical/geometry'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Messager } from 'src/api/message'
import { DEFAULT_CAMERA_CAPTURE_START, type CameraCaptureStart } from 'src/types/camera'
import type { HostAndPort } from 'src/types/connection'

// Atlas

export interface PlanetariumRequest {
	readonly types: readonly StellariumObjectType[]
	readonly magnitudeLimit: number
}

// File System

export interface ListDirectory {
	path?: string
	filter?: string
	directoryOnly?: boolean
}

export interface DirectoryEntry {
	name: string
	path: string
}

export interface CreateDirectory extends DirectoryEntry {
	recursive?: boolean | undefined
	mode?: string | number | undefined
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

// Image

export type ImageKernelFilterType = 'sharpen' | 'mean' | 'blur' | 'gaussianBlur'

export interface ImageStretch extends Pick<SigmaClipOptions, 'centerMethod' | 'dispersionMethod' | 'sigmaLower' | 'sigmaUpper'> {
	auto: boolean
	shadow: number // 0 - 65536
	highlight: number // 0 - 65536
	midtone: number // 0 - 65536
	meanBackground: number
	clippingPoint: number
	sigmaClip: boolean
	bits: number
}

export interface ImageScnr {
	channel?: ImageChannel
	amount: number
	method: SCNRProtectionMethod
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
	type: ImageKernelFilterType
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

export type ImageCalibrationFileType = Exclude<keyof ImageCalibration, 'enabled'>

export interface ImageCalibrationFile {
	enabled: boolean
	path?: string
}

export interface ImageCalibration {
	enabled: boolean
	readonly dark: ImageCalibrationFile
	readonly flat: ImageCalibrationFile
	readonly bias: ImageCalibrationFile
	readonly darkFlat: ImageCalibrationFile
}

export interface ImageFFT {
	enabled: boolean
	readonly type: FFTFilterType
	readonly cutoff: number
	readonly weight: number
}

export interface ImageTransformation {
	enabled: boolean
	debayer: boolean
	cfaPattern: CfaPattern | 'AUTO'
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
	calibration: ImageCalibration
	fft: ImageFFT
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
}

export interface AnnotateImage {
	readonly solution: PlateSolution
	readonly stars: boolean
	readonly dsos: boolean
	readonly useSimbad: boolean
	readonly minorPlanets: boolean
	readonly minorPlanetsMagnitudeLimit: number
	readonly includeMinorPlanetsWithoutMagnitude: boolean
}

export interface StatisticImage extends Omit<OpenImage, 'statistics'> {
	readonly area?: Rect | Roi
	readonly bits: number
	readonly transformed: boolean
}

export type Roi = Size & Point

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
	readonly width: number
	readonly height: number
	readonly delta: number
}

export type ImageCoordinateGridAxis = 'rightAscension' | 'declination'

export type ImageCoordinateGridPoint = Point

export interface ImageCoordinateGridLine {
	readonly axis: ImageCoordinateGridAxis
	readonly value: Angle
	readonly points: readonly ImageCoordinateGridPoint[]
	readonly labels?: readonly ImageCoordinateGridPoint[]
}

export interface ImageCoordinateGrid {
	readonly lines: readonly ImageCoordinateGridLine[]
}

export const CROSSHAIR_PRESETS = ['crosshair', 'bullseye'] as const

export type CrosshairPreset = (typeof CROSSHAIR_PRESETS)[number]

export type ImageCrosshairProjectionAnchor = { readonly space: 'image'; readonly point: Point } | { readonly space: 'sky'; readonly coordinate: EquatorialCoordinate }

export interface ImageCrosshairProjectionRequest {
	readonly solution: PlateSolution
	readonly anchor: ImageCrosshairProjectionAnchor
	readonly preset: CrosshairPreset
	readonly angularSpacing?: {
		readonly automatic: boolean
		readonly value: Angle
	}
}

export type ImageCrosshairPolyline = readonly Point[]

export type ImageCrosshairProjection =
	| { readonly status: 'unprojectable' }
	| {
			readonly status: 'ready'
			readonly width: number
			readonly height: number
			readonly center: Point & EquatorialCoordinate & { readonly inside: boolean }
			readonly spacing?: Angle
			readonly directions: {
				readonly north: Point
				readonly east: Point
			}
			readonly axes: readonly ImageCrosshairPolyline[]
			readonly rings: readonly ImageCrosshairPolyline[]
			readonly ringIntersections: readonly (Point & { readonly radius: Angle })[]
			readonly cardinals: readonly Point[]
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
	id: string
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
	drivers: readonly string[]
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
	readonly client: string
	readonly device: string
	readonly name: string
	readonly property: DeviceProperty
}

export interface IndiPropertyListenEvent {
	readonly id: string
	readonly socket: Messager
}

export interface DeviceAdded<D extends Device = Device> {
	readonly device: D
}

export interface DeviceUpdated<D extends Device = Device> {
	readonly device: RequiredOnly<Partial<D>, 'name' | 'id'>
	readonly property: keyof D & string
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

export type PowerAdded = DeviceAdded<Power>

export type PowerUpdated = DeviceUpdated<Power>

export type PowerRemoved = DeviceRemoved<Power>

export type PowerMessageEvent = PowerAdded | PowerUpdated | PowerRemoved

export type RotatorAdded = DeviceAdded<Rotator>

export type RotatorUpdated = DeviceUpdated<Rotator>

export type RotatorRemoved = DeviceRemoved<Rotator>

export type RotatorMessageEvent = RotatorAdded | RotatorUpdated | RotatorRemoved

export type DewHeaterAdded = DeviceAdded<DewHeater>

export type DewHeaterUpdated = DeviceUpdated<DewHeater>

export type DewHeaterRemoved = DeviceRemoved<DewHeater>

export type DewHeaterMessageEvent = DewHeaterAdded | DewHeaterUpdated | DewHeaterRemoved

export type DeviceMessageEvent = CameraMessageEvent | MountMessageEvent | FocuserMessageEvent | GuideOutputMessageEvent | ThermometerMessageEvent | CoverMessageEvent | FlatPanelMessageEvent | PowerMessageEvent | RotatorMessageEvent | DewHeaterMessageEvent

export interface GuidePulse {
	direction: GuideDirection
	duration: number
}

export const DEVICE_TYPES = new Set<DeviceType>(['camera', 'mount', 'focuser', 'wheel', 'cover', 'flatPanel', 'rotator', 'guideOutput', 'thermometer', 'dewHeater'])

// Camera

// Mount

export type MountRemoteControlProtocol = 'lx200' | 'stellarium'

export type CoordinateType = 'equatorial' | 'equatorialJ2000' | 'horizontal' | 'ecliptic' | 'galactic'

export interface CoordinateInfo extends Record<CoordinateType, readonly [Angle, Angle]> {
	readonly lst: Angle
	readonly constellation: Constellation
	readonly meridianTimeIn: number // seconds
	readonly pierSide: PierSide
}

export interface MountRemoteControlStart extends Readonly<HostAndPort> {
	readonly protocol: MountRemoteControlProtocol
}

export type MountRemoteControlStatus = Record<MountRemoteControlProtocol, Omit<MountRemoteControlStart, 'protocol'> | false>

// Notification

// Plate Solver

// Star Detection

// Tppa

// Darv

// Auto Focus

// Alpaca

// Guider

export type GuiderClientMode = 'local' | 'remote'

export type GuiderState = 'idle' | 'calibrating' | 'settling' | 'guiding' | 'looping' | 'starLost' | 'paused'

export interface GuiderRemoteConnect extends Readonly<HostAndPort> {
	readonly dither: GuiderDither
	readonly mode: 'remote'
}

export interface GuiderLocalConnect {
	readonly dither: GuiderDither
	readonly focalLength: number
	readonly camera: string
	readonly guideOutput: string
	readonly capture: Omit<CameraCaptureStart, 'dither'>
	readonly mode: 'local'
}

export type GuiderConnect = GuiderRemoteConnect | GuiderLocalConnect

export interface GuiderEvent {
	state: GuiderState
	rmsRA: number
	rmsDEC: number
	starMass: number
	snr: number
	hfd: number
	readonly step: {
		ra: number | null
		dec: number | null
		raCorrection: number | null
		decCorrection: number | null
		dx: number | null
		dy: number | null
	}
}

export interface GuiderDither {
	readonly amount: number
	readonly raOnly: boolean
	readonly settle: PHD2Settle
}

export interface GuiderStatus {
	connected: boolean
	looping: boolean
	running: boolean
	profile?: string
}

export const X_IMAGE_INFO_HEADER = 'X-Image-Info'

export const DEFAULT_SIZE: Size = {
	width: 0,
	height: 0,
}

export const DEFAULT_GUIDER_DITHER: Required<GuiderDither> = {
	amount: 5,
	raOnly: false,
	settle: DEFAULT_PHD2_SETTLE,
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

export const DEFAULT_IMAGE_STRETCH: ImageStretch = {
	auto: true,
	shadow: 0,
	highlight: 65536,
	midtone: 32768,
	meanBackground: 0.25,
	clippingPoint: -2.8,
	sigmaClip: false,
	centerMethod: 'mean',
	dispersionMethod: 'std',
	sigmaLower: 3,
	sigmaUpper: 3,
	bits: 14,
}

export const DEFAULT_IMAGE_SCNR: ImageScnr = {
	channel: undefined,
	amount: 0.5,
	method: 'AVERAGE_NEUTRAL',
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

export const DEFAULT_IMAGE_CALIBRATION: ImageCalibration = {
	enabled: false,
	dark: {
		enabled: false,
	},
	flat: {
		enabled: false,
	},
	bias: {
		enabled: false,
	},
	darkFlat: {
		enabled: false,
	},
}

export const DEFAULT_IMAGE_FFT: ImageFFT = {
	enabled: false,
	type: 'lowPass',
	cutoff: 0.015,
	weight: 0.5,
}

export const DEFAULT_IMAGE_TRANSFORMATION: ImageTransformation = {
	enabled: true,
	debayer: true,
	cfaPattern: 'AUTO',
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
	calibration: DEFAULT_IMAGE_CALIBRATION,
	fft: DEFAULT_IMAGE_FFT,
}

export const DEFAULT_FOV_ITEM: FovItem = {
	id: '',
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

export const DEFAULT_INDI_SERVER_START: Required<IndiServerStart> = {
	port: 7624,
	repeat: 1,
	verbose: 0,
	drivers: [],
}

export const DEFAULT_GUIDER_EVENT: GuiderEvent = {
	state: 'idle',
	rmsRA: 0,
	rmsDEC: 0,
	starMass: 0,
	snr: 0,
	hfd: 0,
	step: {
		ra: null,
		dec: null,
		raCorrection: null,
		decCorrection: null,
		dx: null,
		dy: null,
	},
}

export const DEFAULT_GUIDER_REMOTE_CONNECT: GuiderRemoteConnect = {
	mode: 'remote',
	host: 'localhost',
	port: 4400,
	dither: DEFAULT_GUIDER_DITHER,
}

export const DEFAULT_GUIDER_INTERNAL_CONNECT: GuiderLocalConnect = {
	mode: 'local',
	focalLength: 0,
	camera: '',
	guideOutput: '',
	capture: structuredClone(DEFAULT_CAMERA_CAPTURE_START),
	dither: DEFAULT_GUIDER_DITHER,
}
