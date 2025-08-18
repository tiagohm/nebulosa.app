import Elysia from 'elysia'
import { deg, parseAngle } from 'nebulosa/src/angle'
import { astapPlateSolve } from 'nebulosa/src/astap'
import { localAstrometryNetPlateSolve, novaAstrometryNetPlateSolve } from 'nebulosa/src/astrometrynet'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { PlateSolveStart, PlateSolveStop } from '../shared/types'
import { badRequest, internalServerError } from './exceptions'

// Manager for handling plate solving operations
export class PlateSolverManager {
	private readonly tasks = new Map<string, AbortController>()

	// Starts a plate solving task based on the request parameters
	async start(req: PlateSolveStart): Promise<PlateSolution> {
		const ra = parseAngle(req.rightAscension, { isHour: true })
		const dec = parseAngle(req.declination)
		const radius = req.blind || !req.radius ? 0 : deg(req.radius)

		const aborter = new AbortController()
		this.tasks.set(req.id, aborter)

		let solver: Promise<PlateSolution | undefined> | undefined

		if (req.type === 'ASTAP') {
			solver = astapPlateSolve(req.path, { ...req, ra, dec, radius }, aborter.signal)
		} else if (req.type === 'ASTROMETRY_NET') {
			solver = localAstrometryNetPlateSolve(req.path, { ...req, ra, dec, radius }, aborter.signal)
		} else if (req.type === 'NOVA_ASTROMETRY_NET') {
			solver = novaAstrometryNetPlateSolve(
				req.path,
				{
					ra,
					dec,
					radius,
					scaleType: req.fov <= 0 ? 'ul' : 'ev',
					scaleEstimated: req.fov <= 0 ? undefined : req.fov,
					scaleError: req.fov <= 0 ? undefined : 10, // %
				},
				aborter.signal,
			)
		}

		if (solver) {
			try {
				const solution = await solver

				if (solution) {
					return solution
				}
			} catch {
				throw internalServerError('Failed to plate solve image')
			} finally {
				this.tasks.delete(req.id)
			}
		}

		throw badRequest('Invalid plate solving request type')
	}

	// Stops a plate solving task by its id
	stop(req: PlateSolveStop) {
		this.tasks.get(req.id)?.abort()
	}
}

// Endpoints for handling plate solving requests
export function plateSolver(solver: PlateSolverManager) {
	const app = new Elysia({ prefix: '/plateSolver' })
		// Endpoints!
		.post('/start', ({ body }) => solver.start(body as never))
		.post('/stop', ({ body }) => solver.stop(body as never))

	return app
}
