import type { Camera } from 'nebulosa/src/devices/indi/device'
import type { Point, Size } from 'nebulosa/src/math/numerical/geometry'

export type Roi = Size & Point

export interface ComputeRoi {
	readonly camera: Camera
	readonly unbinned?: boolean
}
