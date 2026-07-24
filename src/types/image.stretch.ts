import type { SigmaClipOptions } from 'nebulosa/src/imaging/processing/computation'

export interface ImageStretch extends Pick<SigmaClipOptions, 'centerMethod' | 'dispersionMethod' | 'sigmaLower' | 'sigmaUpper'> {
	auto: boolean
	shadow: number // 0 - 65536
	highlight: number // 0 - 65536
	midtone: number // 0 - 65536
	meanBackground: number
	clippingPoint: number
	sigmaClip: boolean
	bits: number
}

export const DEFAULT_IMAGE_STRETCH: ImageStretch = {
	auto: true,
	shadow: 0,
	highlight: 65536,
	midtone: 32768,
	meanBackground: 0.25,
	clippingPoint: -2.8,
	sigmaClip: false,
	centerMethod: 'mean',
	dispersionMethod: 'std',
	sigmaLower: 3,
	sigmaUpper: 3,
	bits: 14,
}
