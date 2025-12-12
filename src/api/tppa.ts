import Elysia from 'elysia'
import { ThreePointPolarAlignment } from 'nebulosa/src/alignment'
import { deg } from 'nebulosa/src/angle'
import type { IndiClient } from 'nebulosa/src/indi'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import type { MountManager } from 'nebulosa/src/indi.manager'
import bus from 'src/shared/bus'
import { type CameraCaptureEvent, type CameraCaptureStart, DEFAULT_TPPA_EVENT, type TppaEvent, type TppaStart, type TppaStop } from 'src/shared/types'
import type { CacheManager } from './cache'
import { type CameraHandler, decodePath } from './camera'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'
import type { PlateSolverHandler } from './platesolver'

export class TppaHandler {
	private readonly tasks = new Map<string, TppaTask>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly camera: CameraHandler,
		readonly mount: MountManager,
		readonly solver: PlateSolverHandler,
		readonly cache: CacheManager,
	) {
		bus.subscribe<CameraCaptureEvent>('camera:capture', (event) => {
			this.tasks.forEach((task) => task.camera.name === event.device && task.cameraCaptured(event))
		})
	}

	handleTppaEvent(event: TppaEvent) {
		this.wsm.send('tppa', event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.tasks.delete(event.id)
		}
	}

	start(request: TppaStart, client: IndiClient, camera: Camera, mount: Mount) {
		const task = new TppaTask(this, client, camera, mount, request, this.handleTppaEvent.bind(this))
		this.tasks.set(request.id, task)
		task.start()
	}

	stop(req: TppaStop) {
		this.tasks.get(req.id)?.stop()
	}
}

export class TppaTask {
	private readonly capture: CameraCaptureStart
	private readonly polarAlignment: ThreePointPolarAlignment
	private readonly event = structuredClone(DEFAULT_TPPA_EVENT)
	private readonly handleTppaEvent: () => void
	private stopped = false

	constructor(
		private readonly tppa: TppaHandler,
		private readonly client: IndiClient,
		readonly camera: Camera,
		readonly mount: Mount,
		private readonly request: TppaStart,
		handleTppaEvent: (event: TppaEvent) => void,
	) {
		this.capture = request.capture
		this.capture.autoSave = false
		this.capture.count = 1
		this.capture.delay = 0
		this.capture.frameType = 'LIGHT'
		this.capture.exposureMode = 'SINGLE'
		this.capture.mount = mount?.name
		this.capture.x = 0
		this.capture.y = 0
		this.capture.width = camera.frame.maxWidth
		this.capture.height = camera.frame.maxHeight

		this.polarAlignment = new ThreePointPolarAlignment(request.compensateRefraction && request.refraction)

		this.event.id = request.id

		this.handleTppaEvent = () => {
			handleTppaEvent(this.event)

			if (!this.stopped && this.event.state === 'IDLE') {
				this.stopTrackingWhenDone()
			}
		}
	}

	async cameraCaptured(event: CameraCaptureEvent) {
		if (event.savedPath && !this.stopped) {
			this.event.state = 'SOLVING'
			this.handleTppaEvent()

			// Retrieve image from cache
			const [path] = decodePath(event.savedPath)

			// Solve image
			const solution = await this.tppa.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: deg(8), path, id: this.request.id, blind: false })

			if (this.stopped) return

			if (solution) {
				this.event.attempts = 0
				this.event.solved = true
				this.event.solver.rightAscension = solution.rightAscension
				this.event.solver.declination = solution.declination
				this.event.state = 'ALIGNING'
				this.handleTppaEvent()

				// Compute polar alignment
				const location = this.tppa.cache.geographicCoordinate(this.mount.geographicCoordinate)
				const time = this.tppa.cache.time('now', location)
				const result = this.polarAlignment.add(solution.rightAscension, solution.declination, time, true)

				this.event.aligned = result !== false

				if (this.stopped) {
					return
				} else if (result) {
					this.event.attempts = 0
					this.event.error.azimuth = result.azimuthError
					this.event.error.altitude = result.altitudeError
				} else if (this.event.step >= 3) {
					// Failed to align!
					this.event.state = 'IDLE'
					this.event.failed = true
					this.handleTppaEvent()
					return
				}

				this.handleTppaEvent()
			} else if (++this.event.attempts < this.request.maxAttempts) {
				this.event.solved = false
				this.handleTppaEvent()
			} else {
				// Failed to solve after reaching max attempts
				this.event.state = 'IDLE'
				this.event.solved = false
				this.event.failed = true
				this.handleTppaEvent()
				return
			}

			if (!this.stopped && this.event.solved) {
				this.event.step++

				// Move telescope
				if (this.event.step < 3) {
					this.event.state = 'MOVING'
					this.handleTppaEvent()

					this.move(true)
					await this.waitFor(Math.max(1, this.request.moveDuration) * 1000)
					this.move(false)

					if (!this.stopped) {
						// Wait for settle
						this.event.state = 'SETTLING'
						this.handleTppaEvent()
						await this.waitFor(2500)
					}
				} else if (this.request.delayBeforeCapture) {
					// Wait before next capture
					this.event.state = 'WAITING'
					this.handleTppaEvent()
					await this.waitFor(this.request.delayBeforeCapture * 1000)
				}
			}

			// Capture next image
			if (!this.stopped) {
				this.event.state = 'CAPTURING'
				this.handleTppaEvent()
				this.tppa.camera.startCameraCapture(this.client, this.camera, this.request.capture)
			}
		}
	}

	start() {
		// Enable mount tracking
		this.tppa.mount.tracking(this.client, this.mount, true)

		// First image
		this.event.state = 'CAPTURING'
		this.handleTppaEvent()
		this.tppa.camera.startCameraCapture(this.client, this.camera, this.request.capture)
	}

	stop() {
		this.stopped = true

		this.move(false)
		this.tppa.solver.stop(this.request)
		this.tppa.camera.stopCameraCapture(this.client, this.camera)

		if (this.event.state !== 'IDLE') {
			this.event.state = 'IDLE'
			this.handleTppaEvent()
		}
	}

	private move(enabled: boolean) {
		if (this.request.direction === 'EAST') this.tppa.mount.moveEast(this.client, this.mount, enabled)
		else this.tppa.mount.moveWest(this.client, this.mount, enabled)
	}

	private stopTrackingWhenDone() {
		if (this.request.stopTrackingWhenDone && this.mount.tracking) {
			this.tppa.mount.tracking(this.client, this.mount, false)
		}
	}

	private async waitFor(ms: number) {
		while (ms > 0 && !this.stopped) {
			// Sleep for 1 second
			await Bun.sleep(Math.max(1, Math.min(999, ms)))

			// Subtract 1 second from remaining time
			ms -= 1000
		}
	}
}

export function tppa(tppa: TppaHandler, connection: ConnectionHandler) {
	const app = new Elysia({ prefix: '/tppa' })
		// Endpoints!
		.post('/:camera/:mount/start', ({ params, body }) => tppa.start(body as never, connection.get(), tppa.camera.camera.get(params.camera)!, tppa.mount.get(params.mount)!))
		.post('/stop', ({ body }) => tppa.stop(body as never))

	return app
}
