import { join } from 'path'
import { arcsec, deg, parseAngle } from 'nebulosa/src/angle'
import { pixelScale } from 'nebulosa/src/formulas'
import { HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL, hips2Fits, type Hips2FitsOptions } from 'nebulosa/src/hips2fits'
import { normalizeTimeout } from 'src/shared/normalizer'
import type { Framing } from '../shared/types'
import { type Endpoints, response } from './http'
import type { ImageProcessor } from './image'

const URLS = [HIPS2FITS_ALTERNATIVE_URL, HIPS2FITS_BASE_URL]

export class FramingHandler {
	constructor(readonly imageProcessor: ImageProcessor) {}

	async frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, true) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		const width = normalizeDimension(req.width, 800)
		const height = normalizeDimension(req.height, 600)
		const fov = computeFieldOfView(req, width, height)
		const rotation = deg(finiteNumber(req.rotation) ? req.rotation : 0)

		for (const baseUrl of URLS) {
			try {
				const options: Hips2FitsOptions = { baseUrl, width, height, fov, rotation, projection: req.projection, coordSystem: 'icrs', format: 'fits', timeout: normalizeTimeout(req.timeout) }
				const fits = await hips2Fits(req.hipsSurvey, rightAscension, declination, options)

				if (!fits) continue

				const buffer = Buffer.from(await fits.arrayBuffer())
				const path = join(Bun.env.tmpDir, `${fileId(req.id)}.fit`)
				this.imageProcessor.save(buffer, path)
				return { path }
			} catch (e) {
				console.error('failed to fetch framing image from hips2fits', baseUrl, e)
			}
		}

		return undefined
	}
}

function finiteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value)
}

function normalizeDimension(value: unknown, fallback: number) {
	return finiteNumber(value) && value > 0 ? Math.trunc(value) : fallback
}

function computeFieldOfView(req: Framing, width: number, height: number) {
	if (finiteNumber(req.focalLength) && req.focalLength > 0 && finiteNumber(req.pixelSize) && req.pixelSize > 0) {
		return arcsec(pixelScale(req.pixelSize, req.focalLength)) * Math.max(width, height)
	}

	return deg(finiteNumber(req.fov) && req.fov > 0 ? req.fov : 1)
}

function fileId(id: unknown) {
	if (typeof id !== 'string') return Bun.randomUUIDv7()
	const normalized = id.trim().replaceAll(/[^\w-]/g, '_')
	return normalized || Bun.randomUUIDv7()
}

export function framing(framing: FramingHandler) {
	return {
		'/framing': { POST: async (req) => response(await framing.frame(await req.json())) },
	} as const satisfies Endpoints
}
