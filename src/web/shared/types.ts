import type { Camera } from 'nebulosa/src/indi.device'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { Connect, ConnectionStatus, ImageInfo } from 'src/shared/types'

export type FilePickerMode = 'file' | 'directory' | 'save'

export type ImageSource = 'file' | 'framing' | 'camera'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
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

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}
