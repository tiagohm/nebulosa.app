import { deg } from 'nebulosa/src/angle'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { ThreePointPolarAlignment } from 'nebulosa/src/polaralignment'
import { timeNow } from 'nebulosa/src/time'
import { type CameraCaptureEvent, DEFAULT_TPPA_EVENT, type TppaEvent, type TppaStart, type TppaState } from 'src/shared/types'
import type { CameraHandler } from './camera'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import type { PlateSolverHandler } from './platesolver'
import { waitFor } from './util'

export class TppaHandler {
	private readonly tasks: TppaTask[] = []

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly solver: PlateSolverHandler,
	) {}

	sendEvent(event: TppaEvent) {
		this.wsm.send('tppa', event)
	}

	handleTppaEvent(event: TppaEvent, task: TppaTask) {
		this.sendEvent(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.stop(event.id)
		}
	}

	start(request: TppaStart, camera: Camera, mount: Mount) {
		if (this.tasks.some((e) => e.request.id === request.id || e.camera.id === camera.id || e.mount.id === mount.id)) return
		const task = new TppaTask(this, request, camera, mount, this.handleTppaEvent.bind(this))
		this.tasks.push(task)
		void task.start()
	}

	stop(id: string) {
		const index = this.tasks.findIndex((e) => e.request.id === id)

		if (index >= 0) {
			const task = this.tasks[index]
			task.stop()
			this.tasks.splice(index, 1)
		}
	}
}

export class TppaTask {
	readonly event = structuredClone(DEFAULT_TPPA_EVENT)

	private readonly polarAlignment: ThreePointPolarAlignment
	private readonly handleTppaEvent: (state: TppaState, message?: string) => void
	private stopped = false

	constructor(
		readonly tppa: TppaHandler,
		readonly request: TppaStart,
		readonly camera: Camera,
		readonly mount: Mount,
		handleTppaEvent: (event: TppaEvent, task: TppaTask) => void,
	) {
		request.capture.autoSave = false
		request.capture.count = 1
		request.capture.delay = 0
		request.capture.frameType = 'LIGHT'
		request.capture.exposureMode = 'SINGLE'
		request.capture.mount = mount?.name
		request.capture.x = 0
		request.capture.y = 0
		request.capture.width = camera.frame.width.max
		request.capture.height = camera.frame.height.max

		this.polarAlignment = new ThreePointPolarAlignment(request.compensateRefraction && request.refraction)

		this.event.id = request.id
		this.event.camera = camera.id
		this.event.mount = mount.id

		this.handleTppaEvent = (state, message) => {
			if (state !== this.event.state) {
				this.event.state = state
				this.event.message = message
				handleTppaEvent(this.event, this)
			}
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent) {
		if (event.savedPath && !this.stopped && !event.stopped) {
			this.handleTppaEvent('SOLVING')

			// Solve image
			const solution = await this.tppa.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: deg(8), path: event.savedPath, id: this.request.id, blind: false })

			if (this.stopped) return

			if (solution) {
				this.event.attempts = 0
				this.event.solved = true
				this.event.solver.rightAscension = solution.rightAscension
				this.event.solver.declination = solution.declination
				this.handleTppaEvent('ALIGNING')

				// Compute polar alignment
				const time = timeNow(true)
				time.location = { ...this.mount.geographicCoordinate, ellipsoid: 3 }
				const result = this.polarAlignment.add(solution.rightAscension, solution.declination, time)

				this.event.aligned = result !== false

				if (this.stopped) {
					return
				} else if (result) {
					// Aligned succesfully!
					this.event.attempts = 0
					this.event.error.azimuth = result.azimuthError
					this.event.error.altitude = result.altitudeError
				} else if (this.event.step >= 3) {
					// Failed to align!
					this.handleTppaEvent('IDLE', 'alignment failed')
					return
				}
			} else if (++this.event.attempts < this.request.maxAttempts) {
				// Failed to solve, but there are remaining attempts
				this.event.solved = false
			} else {
				// Failed to solve after reaching max attempts
				this.event.state = 'IDLE'
				this.event.solved = false
				this.handleTppaEvent('IDLE', 'solving failed')
				return
			}

			if (!this.stopped && this.event.solved) {
				this.event.step++

				// Move telescope
				if (this.event.step < 3) {
					this.handleTppaEvent('MOVING')

					this.move(true)
					await waitFor(Math.max(1, this.request.moveDuration) * 1000, () => !this.stopped)
					this.move(false)

					if (!this.stopped) {
						// Wait for settle
						this.handleTppaEvent('SETTLING')
						await waitFor(2500, () => !this.stopped)
					}
				} else if (this.request.delayBeforeCapture) {
					// Wait before next capture
					this.handleTppaEvent('WAITING')
					await waitFor(this.request.delayBeforeCapture * 1000, () => !this.stopped)
				}
			}

			// Capture next image
			if (!this.stopped) {
				await this.start()
			}
		} else if (event.state === 'ERROR' || event.stopped) {
			this.stop()
		}
	}

	async start() {
		if (this.stopped) return

		// Enable mount tracking
		if (this.event.count === 0) {
			this.tppa.mountHandler.mountManager.tracking(this.mount, true)
		}

		// Start next capture
		this.event.count++
		this.handleTppaEvent('CAPTURING')
		await this.tppa.cameraHandler.start(this.camera, this.request.capture, this.cameraCaptured.bind(this))
	}

	stop() {
		if (!this.stopped) {
			this.stopped = true

			this.move(false)
			this.tppa.mountHandler.mountManager.stop(this.mount)
			this.tppa.solver.stop(this.request.id)
			this.tppa.cameraHandler.stop(this.camera)

			if (this.event.state !== 'IDLE') {
				this.handleTppaEvent('IDLE')
			}
		}
	}

	private move(enabled: boolean) {
		if (this.request.direction === 'EAST') this.tppa.mountHandler.mountManager.moveEast(this.mount, enabled)
		else this.tppa.mountHandler.mountManager.moveWest(this.mount, enabled)
	}
}

export function tppa(tppaHandler: TppaHandler): Endpoints {
	const { cameraHandler, mountHandler } = tppaHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/tppa/:camera/:mount/start': { POST: async (req) => response(tppaHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/tppa/stop': { POST: async (req) => response(tppaHandler.stop(await req.json())) },
	}
}
