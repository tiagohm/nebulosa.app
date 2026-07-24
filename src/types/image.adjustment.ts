import type { ImageChannelOrGray } from 'nebulosa/src/imaging/model/types'

export interface ImageAdjustment {
	enabled: boolean
	brightness: {
		value: number
	}
	contrast: {
		value: number
	}
	gamma: {
		value: number
	}
	saturation: {
		value: number
		channel: ImageChannelOrGray
	}
}

export const DEFAULT_IMAGE_ADJUSTMENT: ImageAdjustment = {
	enabled: false,
	brightness: {
		value: 1,
	},
	contrast: {
		value: 1,
	},
	gamma: {
		value: 1,
	},
	saturation: {
		value: 1,
		channel: 'BT709',
	},
}
