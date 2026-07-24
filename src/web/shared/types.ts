import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Camera, Cover, DewHeater, FlatPanel, Focuser, GuideOutput, Mount, Rotator, Thermometer, Wheel } from 'nebulosa/src/devices/indi/device'
import type { ImageInfo } from 'src/shared/types'

export type FilePickerMode = 'file' | 'directory' | 'save'

export type ImageSource = 'file' | 'framing' | 'camera'

export interface Image {
	readonly id: string
	readonly path: string
	readonly source: ImageSource
	readonly camera?: Camera
}

export interface ImageLoaded {
	readonly image: Image
	readonly info: ImageInfo
	readonly first: boolean
	readonly refreshed: boolean
}

export interface ImageSolved {
	readonly image: Image
	readonly solution: PlateSolution
}

export interface ImageRoiRequest {
	readonly camera: Camera
	readonly unbinned?: boolean
}

export interface DeviceTypeMap {
	readonly camera: Camera
	readonly mount: Mount
	readonly wheel: Wheel
	readonly focuser: Focuser
	readonly rotator: Rotator
	readonly flatPanel: FlatPanel
	readonly cover: Cover
	readonly thermometer: Thermometer
	readonly guideOutput: GuideOutput
	readonly dewHeater: DewHeater
}
