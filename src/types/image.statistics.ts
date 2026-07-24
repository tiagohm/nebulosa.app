import type { Rect } from 'nebulosa/src/math/numerical/geometry'
import type { OpenImage } from '#/image'
import type { Roi } from '#/image.roi'

export interface StatisticImage extends Omit<OpenImage, 'statistics'> {
	readonly area?: Rect | Roi
	readonly bits: number
	readonly transformed: boolean
}

export interface ImageHistogram {
	readonly standardDeviation: number
	readonly variance: number
	readonly count: readonly [number, number]
	readonly mean: number
	readonly median: number
	readonly maximum: readonly [number, number]
	readonly minimum: readonly [number, number]
	readonly data: readonly number[]
}
