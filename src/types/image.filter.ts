export type ImageKernelFilterType = 'sharpen' | 'mean' | 'blur' | 'gaussianBlur'

export interface ImageFilter {
	enabled: boolean
	type: ImageKernelFilterType
	readonly mean: {
		size: number
	}
	readonly blur: {
		size: number
	}
	readonly gaussianBlur: {
		sigma: number
		size: number
	}
}

export const DEFAULT_IMAGE_FILTER: ImageFilter = {
	enabled: false,
	type: 'sharpen',
	mean: {
		size: 3,
	},
	blur: {
		size: 3,
	},
	gaussianBlur: {
		sigma: 1.4,
		size: 5,
	},
}
