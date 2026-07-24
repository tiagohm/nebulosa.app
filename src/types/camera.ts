import { DEFAULT_PHD2_SETTLE } from 'nebulosa/src/devices/guiding/phd2'
import type { FrameType, CameraTransferFormat } from 'nebulosa/src/devices/indi/device'
import type { Size } from 'recharts/types/util/types'
import type { GuiderDither } from 'src/shared/types'

export type CameraExposureTimeUnit = 'minute' | 'second' | 'millisecond' | 'microsecond'

export type CameraExposureMode = 'single' | 'fixed' | 'loop'

export type CameraAutoSubFolderMode = 'off' | 'noon' | 'midnight'

export type CameraCaptureState = 'idle' | 'exposureStarted' | 'exposing' | 'waiting' | 'settling' | 'dithering' | 'pausing' | 'paused' | 'exposureFinished' | 'error'

export interface CameraDither extends GuiderDither {
	enabled: boolean
}

export interface CameraCaptureStart extends Size {
	exposureTime: number
	exposureTimeUnit: CameraExposureTimeUnit
	frameType: FrameType
	exposureMode: CameraExposureMode
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
	autoSubFolderMode: CameraAutoSubFolderMode
	mount?: string
	wheel?: string
	focuser?: string
	rotator?: string
	dither: CameraDither
	transferFormat: CameraTransferFormat
	compressed: boolean
}

export interface CameraCaptureTime {
	remainingTime: number
	elapsedTime: number
	progress: number
}

export interface CameraCaptureEvent {
	camera: string // id
	count: number
	loop: boolean
	remainingCount: number
	elapsedCount: number
	state: CameraCaptureState
	totalExposureTime: number
	frameExposureTime: number
	totalProgress: CameraCaptureTime
	frameProgress: CameraCaptureTime
	stopped: boolean
}

export interface CameraFrameEvent {
	readonly camera: string // id
	readonly path: string
}

export const DEFAULT_CAMERA_CAPTURE_START: CameraCaptureStart = {
	exposureTime: 0,
	exposureTimeUnit: 'microsecond',
	frameType: 'LIGHT',
	exposureMode: 'single',
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
	autoSubFolderMode: 'off',
	dither: {
		enabled: false,
		amount: 5,
		raOnly: false,
		settle: DEFAULT_PHD2_SETTLE,
	},
	transferFormat: 'FITS',
	compressed: false,
}

export const DEFAULT_CAMERA_CAPTURE_EVENT: CameraCaptureEvent = {
	camera: '',
	state: 'idle',
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
	stopped: false,
}
