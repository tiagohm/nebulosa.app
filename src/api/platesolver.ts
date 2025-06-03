import Elysia from 'elysia'
import { arcsec, deg, parseAngle } from 'nebulosa/src/angle'
import { astapPlateSolve } from 'nebulosa/src/astap'
import { localAstrometryNetPlateSolve, novaAstrometryNetPlateSolve } from 'nebulosa/src/astrometrynet'
import { type PlateSolution, fovFrom } from 'nebulosa/src/platesolver'
import type { PlateSolveStart, PlateSolveStop } from './types'

export class PlateSolverEndpoint {
	private readonly tasks = new Map<string, AbortController>()

	async start(req: PlateSolveStart): Promise<PlateSolution | undefined> {
		const ra = parseAngle(req.ra, { isHour: true })
		const dec = parseAngle(req.dec)
		const radius = req.blind || !req.radius ? 0 : deg(req.radius)
		const fov = arcsec(fovFrom(req.focalLength, req.pixelSize))

		const aborter = new AbortController()
		this.tasks.set(req.id, aborter)

		let solver: Promise<PlateSolution | undefined> | undefined

		if (req.type === 'ASTAP') {
			solver = astapPlateSolve(
				req.path,
				{
					...req,
					fov,
					ra,
					dec,
					radius,
				},
				aborter.signal,
			)
		} else if (req.type === 'NOVA_ASTROMETRY_NET') {
			solver = novaAstrometryNetPlateSolve(
				req.path,
				{
					ra,
					dec,
					radius,
					scaleType: fov <= 0 ? 'ul' : 'ev',
					scaleEstimated: fov <= 0 ? undefined : fov,
					scaleError: fov <= 0 ? undefined : 10, // %
				},
				aborter.signal,
			)
		} else if (req.type === 'ASTROMETRY_NET') {
			solver = localAstrometryNetPlateSolve(
				req.path,
				{
					...req,
					fov,
					ra,
					dec,
					radius,
				},
				aborter.signal,
			)
		}

		if (solver) {
			try {
				const solution = await solver

				if (solution?.solved) {
					return solution
				}
			} finally {
				this.tasks.delete(req.id)
			}
		}

		return undefined
	}

	stop(req: PlateSolveStop) {
		this.tasks.get(req.id)?.abort()
	}
}

export function plateSolver(plateSolver: PlateSolverEndpoint) {
	const app = new Elysia({ prefix: '/plateSolver' })

	app.post('/start', ({ body }) => {
		return plateSolver.start(body as never)
	})

	app.post('/stop', ({ body }) => {
		return plateSolver.stop(body as never)
	})

	return app
}
