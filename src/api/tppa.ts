import { ThreePointPolarAlignment } from 'nebulosa/src/alignment'
import { deg } from 'nebulosa/src/angle'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { timeNow } from 'nebulosa/src/time'
import { type CameraCaptureEvent, type CameraCaptureStart, DEFAULT_TPPA_EVENT, type TppaEvent, type TppaStart, type TppaStop } from 'src/shared/types'
import type { CameraHandler } from './camera'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import type { PlateSolverHandler } from './platesolver'
import { waitFor } from './util'

export class TppaHandler {
	private readonly tasks = new Map<string, TppaTask>()
	private readonly events = new Map<string, TppaEvent>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly solver: PlateSolverHandler,
	) {}

	sendEvent(event: TppaEvent) {
		this.wsm.send('tppa', event)
	}

	handleTppaEvent(event: TppaEvent) {
		this.events.set(event.id, event)
		this.sendEvent(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			const task = this.tasks.get(event.id)

			if (task) {
				task.stop()
				this.tasks.delete(event.id)
			}
		}
	}

	start(request: TppaStart, camera: Camera, mount: Mount) {
		const task = new TppaTask(this, camera, mount, request, this.handleTppaEvent.bind(this))
		this.tasks.set(request.id, task)
		task.start()
	}

	stop(req: TppaStop) {
		this.tasks.get(req.id)?.stop()
	}
}

export class TppaTask {
	readonly event = structuredClone(DEFAULT_TPPA_EVENT)

	private readonly capture: CameraCaptureStart
	private readonly polarAlignment: ThreePointPolarAlignment
	private readonly handleTppaEvent: () => void
	private stopped = false

	constructor(
		private readonly tppa: TppaHandler,
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
		this.capture.width = camera.frame.width.max
		this.capture.height = camera.frame.height.max

		this.polarAlignment = new ThreePointPolarAlignment(request.compensateRefraction && request.refraction)

		this.event.id = request.id

		this.handleTppaEvent = () => {
			handleTppaEvent(this.event)

			if (!this.stopped && this.event.state === 'IDLE') {
				this.stopTrackingWhenDone()
			}
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent) {
		if (event.savedPath && !this.stopped) {
			this.event.state = 'SOLVING'
			this.handleTppaEvent()

			// Solve image
			const solution = await this.tppa.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: deg(8), path: event.savedPath, id: this.request.id, blind: false })

			if (this.stopped) return

			if (solution) {
				this.event.attempts = 0
				this.event.solved = true
				this.event.solver.rightAscension = solution.rightAscension
				this.event.solver.declination = solution.declination
				this.event.state = 'ALIGNING'
				this.handleTppaEvent()

				// Compute polar alignment
				const time = timeNow(true)
				time.location = { ...this.mount.geographicCoordinate, ellipsoid: 3 }
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
					await waitFor(Math.max(1, this.request.moveDuration) * 1000, () => !this.stopped)
					this.move(false)

					if (!this.stopped) {
						// Wait for settle
						this.event.state = 'SETTLING'
						this.handleTppaEvent()
						await waitFor(2500, () => !this.stopped)
					}
				} else if (this.request.delayBeforeCapture) {
					// Wait before next capture
					this.event.state = 'WAITING'
					this.handleTppaEvent()
					await waitFor(this.request.delayBeforeCapture * 1000, () => !this.stopped)
				}
			}

			// Capture next image
			if (!this.stopped) {
				this.event.state = 'CAPTURING'
				this.handleTppaEvent()
				this.tppa.cameraHandler.start(this.camera, this.request.capture)
			}
		}
	}

	start() {
		// Enable mount tracking
		this.tppa.mountHandler.mountManager.tracking(this.mount, true)

		// First image
		this.event.state = 'CAPTURING'
		this.handleTppaEvent()
		this.tppa.cameraHandler.start(this.camera, this.request.capture, this.cameraCaptured.bind(this))
	}

	stop() {
		if (!this.stopped) {
			this.stopped = true

			this.move(false)
			this.tppa.solver.stop(this.request)
			this.tppa.cameraHandler.stop(this.camera)

			if (this.event.state !== 'IDLE') {
				this.event.state = 'IDLE'
				this.handleTppaEvent()
			}
		}
	}

	private move(enabled: boolean) {
		if (this.request.direction === 'EAST') this.tppa.mountHandler.mountManager.moveEast(this.mount, enabled)
		else this.tppa.mountHandler.mountManager.moveWest(this.mount, enabled)
	}

	private stopTrackingWhenDone() {
		if (this.request.stopTrackingWhenDone && this.mount.tracking) {
			this.tppa.mountHandler.mountManager.tracking(this.mount, false)
		}
	}
}

export function tppa(tppaHandler: TppaHandler): Endpoints {
	const { cameraHandler, mountHandler } = tppaHandler

	function cameraFromParams(req: Bun.BunRequest<string>) {
		return cameraHandler.cameraManager.get(query(req).get('client'), req.params.camera)!
	}

	function mountFromParams(req: Bun.BunRequest<string>) {
		return mountHandler.mountManager.get(query(req).get('client'), req.params.mount)!
	}

	return {
		'/tppa/:camera/:mount/start': { POST: async (req) => response(tppaHandler.start(await req.json(), cameraFromParams(req)!, mountFromParams(req)!)) },
		'/tppa/stop': { POST: async (req) => response(tppaHandler.stop(await req.json())) },
	}
}
