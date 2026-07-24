import { DEFAULT_CAMERA_CAPTURE_START } from '#/camera'
import type { CameraCaptureStart } from '#/camera'

export type FlatWizardState = 'idle' | 'capturing' | 'computing'

export interface FlatWizardStart {
	id: string
	readonly capture: CameraCaptureStart
	minExposure: number // ms
	maxExposure: number // ms
	meanTarget: number // [0..65535]
	meanTolerance: number // % [0..100]
	path: string
}

export interface FlatWizardEvent {
	id: string
	camera: string
	state: FlatWizardState
	median: number
	message?: string
}

export const DEFAULT_FLAT_WIZARD_START: FlatWizardStart = {
	id: '',
	capture: DEFAULT_CAMERA_CAPTURE_START,
	minExposure: 1,
	maxExposure: 2000,
	meanTarget: 32768,
	meanTolerance: 10,
	path: '',
}

export const DEFAULT_FLAT_WIZARD_EVENT: FlatWizardEvent = {
	id: '',
	camera: '',
	state: 'idle',
	median: 0,
}
