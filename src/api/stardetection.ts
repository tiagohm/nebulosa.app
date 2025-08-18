import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from '../shared/types'

// Manager for handling star detection operations
export class StarDetectionManager {
	// Detects stars based on the request parameters
	async detect(req: StarDetection) {
		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}
}

// Endpoints for handling star detection requests
export function starDetection(detection: StarDetectionManager) {
	const app = new Elysia({ prefix: '/starDetection' })
		// Endpoints!
		.post('', ({ body }) => detection.detect(body as never))

	return app
}
