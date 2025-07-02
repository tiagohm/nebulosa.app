import { molecule } from 'bunshi'
import Elysia from 'elysia'
import { astapDetectStars } from 'nebulosa/src/astap'
import type { StarDetection } from './types'

export const StarDetectionMolecule = molecule(() => {
	// Detects stars based on the request parameters
	async function detect(req: StarDetection) {
		if (req.type === 'ASTAP') {
			return await astapDetectStars(req.path, req)
		}

		return []
	}

	// The endpoints for star detection
	const app = new Elysia({ prefix: '/starDetection' })

	app.post('', ({ body }) => {
		return detect(body as never)
	})

	return { detect, app } as const
})
