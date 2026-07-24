import { DEFAULT_REFRACTION_PARAMETERS } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { RefractionParameters } from 'nebulosa/src/astronomy/coordinates/astrometry'
import type { EquatorialCoordinate, HorizontalCoordinate } from 'nebulosa/src/astronomy/coordinates/coordinate'
import { DEFAULT_CAMERA_CAPTURE_START } from 'src/types/camera'
import type { CameraCaptureStart } from 'src/types/camera'
import { DEFAULT_PLATE_SOLVE_START } from 'src/types/platesolver'
import type { PlateSolveStart } from 'src/types/platesolver'

export type TppaState = 'idle' | 'waiting' | 'moving' | 'capturing' | 'solving' | 'aligning' | 'settling'

export type TppaDirection = 'east' | 'west'

export interface TppaStart {
	id: string
	readonly direction: TppaDirection
	readonly moveDuration: number // seconds
	readonly delayBeforeCapture: number // seconds
	readonly maxAttempts: number
	readonly solver: Omit<PlateSolveStart, 'id' | 'path' | 'blind'>
	readonly capture: CameraCaptureStart
	readonly refraction: RefractionParameters
	readonly compensateRefraction: boolean
}

export interface TppaEvent {
	id: string
	camera: string
	mount: string
	step: number
	state: TppaState
	message?: string
	attempts: number
	solved: boolean
	readonly solver: EquatorialCoordinate
	aligned: boolean
	readonly error: HorizontalCoordinate
	count: number
}

export const DEFAULT_TPPA_START: TppaStart = {
	id: '',
	direction: 'east',
	moveDuration: 5,
	delayBeforeCapture: 5,
	maxAttempts: 15,
	solver: DEFAULT_PLATE_SOLVE_START,
	capture: DEFAULT_CAMERA_CAPTURE_START,
	refraction: DEFAULT_REFRACTION_PARAMETERS,
	compensateRefraction: true,
}

export const DEFAULT_TPPA_EVENT: TppaEvent = {
	id: '',
	camera: '',
	mount: '',
	step: 0,
	state: 'idle',
	attempts: 0,
	solved: false,
	aligned: false,
	count: 0,
	solver: {
		rightAscension: 0,
		declination: 0,
	},
	error: {
		azimuth: 0,
		altitude: 0,
	},
}
