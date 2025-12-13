import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from '../shared/types'
import type { ImageProcessor } from './image'

export class StarDetectionHandler {
	constructor(readonly processor: ImageProcessor) {}

	async detect(req: StarDetection) {
		const [path] = this.processor.extractIdFromCameraOrPath(req.path)

		if (req.type === 'ASTAP') {
			return await astapDetectStars(path, req)
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
