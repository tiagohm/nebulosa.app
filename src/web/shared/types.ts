import type { Camera, Cover, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Thermometer, Wheel } from 'nebulosa/src/indi.device'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { Connect, ImageInfo } from 'src/shared/types'

export type FilePickerMode = 'file' | 'directory' | 'save'

export type ImageSource = 'file' | 'framing' | 'camera'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
}

export interface Image {
	readonly key: string
	readonly position: number
	readonly path: string
	readonly source: ImageSource
	readonly camera?: Camera
}

export interface ImageLoaded {
	readonly image: Image
	readonly info: ImageInfo
	readonly newImage: boolean
}

export interface ImageSolved {
	readonly image: Image
	readonly solution: PlateSolution
}

export interface DeviceTypeMap {
	readonly CAMERA: Camera
	readonly MOUNT: Mount
	readonly WHEEL: Wheel
	readonly FOCUSER: Focuser
	readonly ROTATOR: Rotator
	readonly FLAT_PANEL: FlatPanel
	readonly COVER: Cover
	readonly THERMOMETER: Thermometer
	readonly GUIDE_OUTPUT: GuideOutput
	readonly DEW_HEATER: DewHeater
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}
