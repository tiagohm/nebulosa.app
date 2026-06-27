import { mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { astapDetectStars } from 'nebulosa/src/astrometry/solvers/astap'
import { detectStars } from 'nebulosa/src/imaging/stars/detector'
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
		if (!req.path) return []

		try {
			const path = (await this.imageProcessor.store(req.path)) || req.path
			const request = { ...req, path }

			if (request.type === 'astap') {
				return await this.detectWithAstap(request)
			} else if (request.type === 'nebulosa') {
				const image = await this.imageProcessor.transform(path, STAR_DETECTION_IMAGE_TRANSFORMATION)
				if (image) return detectStars(image.image, { ...request, maxStars: normalizeMaxStars(request.maxStars) })
			}
		} catch (error) {
			console.error('star detection failed:', error)
		}

		return []
	}

	private async detectWithAstap(req: StarDetection) {
		const outputDirectory = await mkdtemp(join(Bun.env.tmpDir, 'stardetection-'))

		try {
			return await astapDetectStars(req.path, { ...req, outputDirectory })
		} finally {
			await rm(outputDirectory, { recursive: true, force: true })
		}
	}
}

function normalizeMaxStars(maxStars: number) {
	return maxStars > 0 ? maxStars : 2000
}

export function starDetection(detection: StarDetectionHandler) {
	return {
		'/stardetection': { POST: async (req) => response(await detection.detect(await req.json())) },
	} as const satisfies Endpoints
}
