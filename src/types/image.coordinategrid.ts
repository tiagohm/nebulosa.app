import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { Angle } from 'nebulosa/src/math/units/angle'

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
