import { deg, parseAngle } from 'nebulosa/src/angle'
import { astapPlateSolve } from 'nebulosa/src/astap'
import { localAstrometryNetPlateSolve, novaAstrometryNetPlateSolve } from 'nebulosa/src/astrometrynet'
import type { PlateSolution } from 'nebulosa/src/platesolver'
import type { PlateSolveStart } from '../shared/types'
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
		this.stop(req.id)

		const aborter = new AbortController()
		this.tasks.set(req.id, aborter)

		try {
			const path = (await this.imageProcessor.store(req.path)) || req.path
			const rightAscension = typeof req.rightAscension === 'number' ? req.rightAscension : parseAngle(req.rightAscension, true)
			const declination = typeof req.declination === 'number' ? req.declination : parseAngle(req.declination)
			const radius = req.blind || !req.radius ? 0 : deg(req.radius)

			let solver: Promise<PlateSolution | undefined> | undefined

			if (req.type === 'astap') {
				solver = astapPlateSolve(path, { ...req, rightAscension, declination, radius }, aborter.signal)
			} else if (req.type === 'astrometryNet') {
				solver = localAstrometryNetPlateSolve(path, { ...req, rightAscension, declination, radius }, aborter.signal)
			} else if (req.type === 'novaAstrometryNet') {
				solver = novaAstrometryNetPlateSolve(
					path,
					{
						apiKey: req.apiKey,
						apiUrl: req.apiUrl,
						downsample: req.downsample,
						rightAscension,
						declination,
						radius,
						scaleType: req.fov <= 0 ? 'ul' : 'ev',
						scaleEstimated: req.fov <= 0 ? undefined : req.fov,
						scaleError: req.fov <= 0 ? undefined : 10, // %
						timeout: req.timeout,
					},
					aborter.signal,
				)
			}

			if (!solver) return undefined

			const solution = await solver

			if (solution) {
				return solution
			}

			if (!aborter.signal.aborted) {
				this.notification.send({ title: 'PLATE SOLVER', description: 'No solution found', color: 'warning' })
			}
		} catch (e) {
			if (!aborter.signal.aborted) {
				console.error(e)
				this.notification.send({ title: 'PLATE SOLVER', description: 'Failed to plate solve', color: 'danger' })
			}
		} finally {
			aborter.abort()

			if (this.tasks.get(req.id) === aborter) {
				this.tasks.delete(req.id)
			}
		}

		return undefined
	}

	stop(id: string) {
		const aborter = this.tasks.get(id)

		if (aborter) {
			this.tasks.delete(id)
			aborter.abort()
		}
	}
}

export function plateSolver(solver: PlateSolverHandler) {
	return {
		'/platesolver/start': { POST: async (req) => response(await solver.start(await req.json())) },
		'/platesolver/:id/stop': { POST: (req) => response(solver.stop(req.params.id)) },
	} as const satisfies Endpoints
}
