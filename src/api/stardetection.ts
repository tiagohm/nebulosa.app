import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from '../shared/types'
import { decodePath } from './camera'

export class StarDetectionHandler {
	async detect(req: StarDetection) {
		const [path] = decodePath(req.path)

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
