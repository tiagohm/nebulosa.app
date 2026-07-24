import type { FFTFilterType } from 'nebulosa/src/imaging/processing/fft'

export interface ImageFFT {
	enabled: boolean
	readonly type: FFTFilterType
	readonly cutoff: number
	readonly weight: number
}

export const DEFAULT_IMAGE_FFT: ImageFFT = {
	enabled: false,
	type: 'lowPass',
	cutoff: 0.015,
	weight: 0.5,
}
