import type { ImageChannel } from 'nebulosa/src/imaging/model/types'
import type { SCNRProtectionMethod } from 'nebulosa/src/imaging/processing/scnr'

export interface ImageScnr {
	channel?: ImageChannel
	amount: number
	method: SCNRProtectionMethod
}

export const DEFAULT_IMAGE_SCNR: ImageScnr = {
	channel: undefined,
	amount: 0.5,
	method: 'AVERAGE_NEUTRAL',
}
