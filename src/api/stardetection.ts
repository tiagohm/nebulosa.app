import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from './types'

export class StarDetectionEndpoint {
	async detectStars(req: StarDetection) {
		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}
}

export function starDetection(starDetection: StarDetectionEndpoint) {
	const app = new Elysia({ prefix: '/starDetection' })

	app.post('', ({ body }) => {
		return starDetection.detectStars(body as never)
	})

	return app
}
