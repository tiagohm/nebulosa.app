import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from '../shared/types'
import type { ImageProcessor } from './image'

export class StarDetectionHandler {
	constructor(readonly imageProcessor: ImageProcessor) {}

	async detect(req: StarDetection) {
		req.path = (await this.imageProcessor.store(req.path)) || req.path

		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}
}

export function starDetection(detection: StarDetectionHandler) {
	const app = new Elysia({ prefix: '/stardetection' })
		// Endpoints!
		.post('', ({ body }) => detection.detect(body as never))

	return app
}
