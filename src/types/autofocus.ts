import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { AutoFocusOptions } from 'nebulosa/src/observation/focus/autofocus'
import { DEFAULT_CAMERA_CAPTURE_START } from 'src/types/camera'
import type { CameraCaptureStart } from 'src/types/camera'
import { DEFAULT_STAR_DETECTION } from 'src/types/stardetection'
import type { StarDetection } from 'src/types/stardetection'

export type AutoFocusState = 'idle' | 'moving' | 'capturing' | 'computing'

export interface AutoFocusStart extends AutoFocusOptions {
	id: string
	readonly capture: CameraCaptureStart
	readonly starDetection: StarDetection
}

export interface AutoFocusEvent {
	id: string
	state: AutoFocusState
	camera: string
	focuser: string
	starCount: number
	hfd: number
	message?: string
	x: readonly number[]
	y: readonly number[]
	left?: readonly Point[]
	right?: readonly Point[]
	parabolic?: readonly Point[]
	hyperbolic?: readonly Point[]
	minimum?: Point
	maximum?: Point
	focusPoint?: Point | null
}

export const DEFAULT_AUTO_FOCUS_START: AutoFocusStart = {
	id: '',
	capture: DEFAULT_CAMERA_CAPTURE_START,
	starDetection: DEFAULT_STAR_DETECTION,
	initialOffsetSteps: 5,
	stepSize: 50,
	fittingMode: 'TREND_PARABOLIC',
	reversed: false,
	maxPosition: 0,
	rmsdThreshold: 0.15,
}

export const DEFAULT_AUTO_FOCUS_EVENT: AutoFocusEvent = {
	id: '',
	state: 'idle',
	camera: '',
	focuser: '',
	starCount: 0,
	hfd: 0,
	x: [],
	y: [],
}
