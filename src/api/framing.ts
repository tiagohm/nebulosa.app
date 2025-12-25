import Elysia from 'elysia'
import { arcsec, deg, PARSE_HOUR_ANGLE, parseAngle } from 'nebulosa/src/angle'
import { hips2Fits } from 'nebulosa/src/hips2fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { join } from 'path/posix'
import hipsSurveys from '../../data/hips-surveys.json' with { type: 'json' }
import type { Framing } from '../shared/types'
import type { ImageProcessor } from './image'

export class FramingHandler {
	constructor(readonly processor: ImageProcessor) {}

	async frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, PARSE_HOUR_ANGLE) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		req.fov = req.focalLength && req.pixelSize ? arcsec(angularSizeOfPixel(req.focalLength, req.pixelSize)) * Math.max(req.width, req.height) : deg(req.fov || 1)
		req.rotation = deg(req.rotation)
		const fits = await hips2Fits(req.hipsSurvey, rightAscension, declination, req)
		const buffer = Buffer.from(await fits.arrayBuffer())
		const path = join(Bun.env.tmpDir, `${req.id}.fit`)
		void Bun.write(path, buffer) // Don't wait for writing to file
		this.processor.save(buffer, path)
		return { path }
	}
}

export function framing(framing: FramingHandler) {
	const app = new Elysia({ prefix: '/framing' })
		// Endpoints!
		.get('/hips-surveys', () => hipsSurveys)
		.post('', ({ body }) => framing.frame(body as never))

	return app
}
