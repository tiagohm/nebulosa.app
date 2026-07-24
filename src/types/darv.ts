import { DEFAULT_CAMERA_CAPTURE_START } from 'src/types/camera'
import type { CameraCaptureStart } from 'src/types/camera'

export type DarvHemisphere = 'northern' | 'southern'

export type DarvState = 'idle' | 'waiting' | 'forwarding' | 'backwarding'

export interface DarvStart {
	id: string
	readonly hemisphere: DarvHemisphere
	readonly initialPause: number // seconds
	readonly duration: number // seconds
	readonly capture: CameraCaptureStart
}

export interface DarvEvent {
	id: string
	camera: string
	mount: string
	state: DarvState
	message?: string
}

export const DEFAULT_DARV_START: DarvStart = {
	id: '',
	hemisphere: 'northern',
	initialPause: 5,
	duration: 30,
	capture: DEFAULT_CAMERA_CAPTURE_START,
}

export const DEFAULT_DARV_EVENT: DarvEvent = {
	id: '',
	camera: '',
	mount: '',
	state: 'idle',
}
