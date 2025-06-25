import Elysia from 'elysia'
import { writeFile } from 'fs/promises'
import { arcsec, deg, parseAngle } from 'nebulosa/src/angle'
import { hips2Fits } from 'nebulosa/src/hips2fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { join } from 'path/posix'
import hipsSurveys from '../../data/hips-surveys.json' with { type: 'json' }
import type { Framing } from './types'

// Manager for handling framing requests
export class FramingManager {
	async frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, { isHour: true }) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		req.fov = req.focalLength && req.pixelSize ? arcsec(angularSizeOfPixel(req.focalLength, req.pixelSize)) * Math.max(req.width, req.height) : deg(req.fov || 1)
		req.rotation = deg(req.rotation)
		const fits = await hips2Fits(req.hipsSurvey, rightAscension, declination, req)
		const path = join(Bun.env.framingDir, `${req.id || Bun.randomUUIDv7()}.fit`)
		await writeFile(path, new Uint8Array(fits))
		return { path }
	}
}

// Creates an instance of Elysia for framing endpoints
export function framing(framing: FramingManager) {
	const app = new Elysia({ prefix: '/framing' })

	app.get('/hipsSurveys', hipsSurveys)

	app.post('', ({ body }) => {
		return framing.frame(body as never)
	})

	return app
}
