import Elysia from 'elysia'
import { deg, parseAngle } from 'nebulosa/src/angle'
import { hips2Fits } from 'nebulosa/src/hips2fits'
import hipsSurveys from '../../data/hips-surveys.json' with { type: 'json' }
import type { Framing } from './types'

export class FramingEndpoint {
	frame(req: Framing) {
		const rightAscension = parseAngle(req.rightAscension, { isHour: true }) ?? 0
		const declination = parseAngle(req.declination) ?? 0
		req.fov = deg(req.fov || 1)
		req.rotation = deg(req.fov)
		return hips2Fits(req.hipsSurvey, rightAscension, declination, req)
	}
}

export function framing(framing: FramingEndpoint) {
	const app = new Elysia({ prefix: '/framing' })

	app.get('/hipsSurveys', hipsSurveys)

	return app
}
