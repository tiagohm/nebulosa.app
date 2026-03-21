import { astapDetectStars } from 'nebulosa/src/astap'
import { detectStars } from 'nebulosa/src/star.detector'
import { DEFAULT_IMAGE_TRANSFORMATION, type ImageTransformation, type StarDetection } from '../shared/types'
import { type Endpoints, response } from './http'
import type { ImageProcessor } from './image'

const STAR_DETECTION_IMAGE_TRANSFORMATION: ImageTransformation = {
	...DEFAULT_IMAGE_TRANSFORMATION,
	stretch: {
		...DEFAULT_IMAGE_TRANSFORMATION.stretch,
		auto: false,
	},
}

export class StarDetectionHandler {
	constructor(readonly imageProcessor: ImageProcessor) {}

	async detect(req: StarDetection) {
		req.path = (await this.imageProcessor.store(req.path)) || req.path

		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		} else if (req.type === 'NEBULOSA') {
			const image = await this.imageProcessor.transform(req.path, STAR_DETECTION_IMAGE_TRANSFORMATION)
			if (image) return detectStars(image.image, req)
		}

		return []
	}
}

export function starDetection(detection: StarDetectionHandler): Endpoints {
	return {
		'/stardetection': { POST: async (req) => response(await detection.detect(await req.json())) },
	}
}
