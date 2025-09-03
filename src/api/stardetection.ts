import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from '../shared/types'

export class StarDetectionManager {
	async detect(req: StarDetection) {
		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}
}

export function starDetection(detection: StarDetectionManager) {
	const app = new Elysia({ prefix: '/stardetection' })
		// Endpoints!
		.post('', ({ body }) => detection.detect(body as never))

	return app
}
