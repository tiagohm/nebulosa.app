import { deg, parseAngle } from 'nebulosa/src/angle'
import { astapPlateSolve } from 'nebulosa/src/astap'
import { localAstrometryNetPlateSolve, novaAstrometryNetPlateSolve } from 'nebulosa/src/astrometrynet'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { PlateSolveStart, PlateSolveStop } from '../shared/types'
import { type Endpoints, response } from './http'
import type { ImageProcessor } from './image'
import type { NotificationHandler } from './notification'

export class PlateSolverHandler {
	private readonly tasks = new Map<string, AbortController>()

	constructor(
		readonly notification: NotificationHandler,
		readonly imageProcessor: ImageProcessor,
	) {}

	async start(req: PlateSolveStart): Promise<PlateSolution | undefined> {
		req.path = (await this.imageProcessor.store(req.path)) || req.path

		const rightAscension = typeof req.rightAscension === 'number' ? req.rightAscension : parseAngle(req.rightAscension, true)
		const declination = typeof req.declination === 'number' ? req.declination : parseAngle(req.declination)
		const radius = req.blind || !req.radius ? 0 : deg(req.radius)

		const aborter = new AbortController()
		this.tasks.set(req.id, aborter)

		let solver: Promise<PlateSolution | undefined> | undefined

		if (req.type === 'ASTAP') {
			solver = astapPlateSolve(req.path, { ...req, rightAscension, declination, radius }, aborter.signal)
		} else if (req.type === 'ASTROMETRY_NET') {
			solver = localAstrometryNetPlateSolve(req.path, { ...req, rightAscension, declination, radius }, aborter.signal)
		} else if (req.type === 'NOVA_ASTROMETRY_NET') {
			solver = novaAstrometryNetPlateSolve(
				req.path,
				{
					rightAscension,
					declination,
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
				} else {
					this.notification.send({ title: 'PLATE SOLVER', description: 'No solution found', color: 'warning' })
				}
			} catch (e) {
				console.error(e)
				this.notification.send({ title: 'PLATE SOLVER', description: 'Failed to plate solve', color: 'danger' })
			} finally {
				aborter.abort()
				this.tasks.delete(req.id)
			}
		}

		return undefined
	}

	stop(req: PlateSolveStop) {
		this.tasks.get(req.id)?.abort()
	}
}

export function plateSolver(solver: PlateSolverHandler): Endpoints {
	return {
		'/platesolver/start': { POST: async (req) => response(await solver.start(await req.json())) },
		'/platesolver/stop': { POST: async (req) => response(solver.stop(await req.json())) },
	}
}
