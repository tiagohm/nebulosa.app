import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from './types'

// Manager for handling star detection requests
export class StarDetectionManager {
	// Detects stars based on the request parameters
	async detect(req: StarDetection) {
		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}
}

// Creates an instance of Elysia for star detection endpoints
export function starDetection(starDetection: StarDetectionManager) {
	const app = new Elysia({ prefix: '/starDetection' })

	app.post('', ({ body }) => {
		return starDetection.detect(body as never)
	})

	return app
}
