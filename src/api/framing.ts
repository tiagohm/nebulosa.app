import { molecule } from 'bunshi'
import Elysia from 'elysia'
import { arcsec, deg, parseAngle } from 'nebulosa/src/angle'
import { hips2Fits } from 'nebulosa/src/hips2fits'
import { angularSizeOfPixel } from 'nebulosa/src/util'
import { join } from 'path/posix'
import hipsSurveys from '../../data/hips-surveys.json' with { type: 'json' }
import type { Framing } from './types'

// Molecule for handling framing requests
export const FramingMolecule = molecule(() => {
	// Retrieves a FITS file from a HIPS survey based on the provided parameters
	async function frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, { isHour: true }) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		req.fov = req.focalLength && req.pixelSize ? arcsec(angularSizeOfPixel(req.focalLength, req.pixelSize)) * Math.max(req.width, req.height) : deg(req.fov || 1)
		req.rotation = deg(req.rotation)
		const fits = await hips2Fits(req.hipsSurvey, rightAscension, declination, req)
		const path = join(Bun.env.framingDir, `${req.id}.fit`)
		await Bun.write(path, fits)
		return { path }
	}

	// The endpoints for framing
	const app = new Elysia({ prefix: '/framing' })

	app.get('/hipsSurveys', hipsSurveys)

	app.post('', ({ body }) => {
		return frame(body as never)
	})

	return { frame, app } as const
})
