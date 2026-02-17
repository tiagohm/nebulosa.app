import { arcsec, deg, parseAngle } from 'nebulosa/src/angle'
import { HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL, hips2Fits } from 'nebulosa/src/hips2fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { join } from 'path/posix'
import hipsSurveys from '../../data/hips-surveys.json' with { type: 'json' }
import type { Framing } from '../shared/types'
import { type Endpoints, response } from './http'
import type { ImageProcessor } from './image'

const URLS = [HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL]

export class FramingHandler {
	constructor(readonly imageProcessor: ImageProcessor) {}

	async frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, true) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		req.fov = req.focalLength && req.pixelSize ? arcsec(angularSizeOfPixel(req.focalLength, req.pixelSize)) * Math.max(req.width, req.height) : deg(req.fov || 1)
		req.rotation = deg(req.rotation)
		req.coordSystem = 'icrs'
		req.format = 'fits'

		for (const baseUrl of URLS) {
			req.baseUrl = baseUrl
			const fits = await hips2Fits(req.hipsSurvey, rightAscension, declination, req)
			if (!fits) continue
			const buffer = Buffer.from(await fits.arrayBuffer())
			const path = join(Bun.env.tmpDir, `${req.id}.fit`)
			// void Bun.write(path, buffer)
			this.imageProcessor.save(buffer, path)
			return { path }
		}

		return undefined
	}
}

export function framing(framing: FramingHandler): Endpoints {
	return {
		'/framing/hips-surveys': { GET: response(hipsSurveys) },
		'/framing': { POST: async (req) => response(await framing.frame(await req.json())) },
	}
}
