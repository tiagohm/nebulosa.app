import { timeNow } from 'nebulosa/src/astronomy/time/time'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { ThreePointPolarAlignment } from 'nebulosa/src/observation/alignment/polaralignment'
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

		if (event.state === 'idle') {
			if (this.remove(task)) task.destroy()
		}
	}

	start(request: TppaStart, camera: Camera, mount: Mount) {
		if (this.tasks.some((e) => e.request.id === request.id || e.camera === camera || e.mount === mount)) return
		const task = new TppaTask(this, request, camera, mount, this.handleTppaEvent.bind(this))
		this.tasks.push(task)
		task.start()
	}

	stop(id: string) {
		const index = this.tasks.findIndex((e) => e.request.id === id)

		if (index >= 0) {
			const task = this.tasks[index]
			this.tasks.splice(index, 1)
			task.stop()
		}
	}

	private remove(task: TppaTask) {
		const index = this.tasks.indexOf(task)

		if (index >= 0) {
			this.tasks.splice(index, 1)
			return true
		}

		return false
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
		request.capture.exposureMode = 'single'
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
			if (state !== this.event.state || message !== this.event.message) {
				this.event.state = state
				this.event.message = message
				handleTppaEvent(this.event, this)
			}
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent, path?: string) {
		if (path && !this.stopped) {
			this.handleTppaEvent('solving')

			// Solve image
			const solution = await this.tppa.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: 8, path, id: this.request.id, blind: false })

			if (this.stopped) return

			if (solution) {
				this.event.attempts = 0
				this.event.solved = true
				this.event.solver.rightAscension = solution.rightAscension
				this.event.solver.declination = solution.declination
				this.handleTppaEvent('aligning')

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
					this.handleTppaEvent('idle', 'alignment failed')
					return
				}
			} else if (++this.event.attempts < this.request.maxAttempts) {
				// Failed to solve, but there are remaining attempts
				this.event.solved = false
			} else {
				// Failed to solve after reaching max attempts
				this.event.solved = false
				this.handleTppaEvent('idle', 'solving failed')
				return
			}

			if (!this.stopped && this.event.solved) {
				this.event.step++

				// Move telescope
				if (this.event.step < 3) {
					this.handleTppaEvent('moving')

					this.move(true)
					await waitFor(this.moveDuration, () => !this.stopped)
					this.move(false)

					if (!this.stopped) {
						// Wait for settle
						this.handleTppaEvent('settling')
						await waitFor(2500, () => !this.stopped)
					}
				} else if (this.delayBeforeCapture > 0) {
					// Wait before next capture
					this.handleTppaEvent('waiting')
					await waitFor(this.delayBeforeCapture, () => !this.stopped)
				}
			}

			// Capture next image
			if (!this.stopped) {
				this.start()
			}
		} else if (event.state === 'error') {
			this.fail('camera capture failed')
		} else if (event.stopped) {
			this.stop()
		}
	}

	start() {
		if (this.stopped) return

		// Enable mount tracking
		if (this.event.count === 0) {
			this.tppa.mountHandler.mountManager.tracking(this.mount, true)
		}

		// Start next capture
		this.event.count++
		this.handleTppaEvent('capturing')

		void this.tppa.cameraHandler.start(this.camera, this.request.capture, (event, path) => {
			void this.cameraCaptured(event, path).catch((error) => this.fail(error))
		})
	}

	stop() {
		if (!this.stopped) {
			this.destroy()

			if (this.event.state !== 'idle') {
				this.handleTppaEvent('idle')
			}
		}
	}

	fail(error: unknown) {
		if (this.stopped) return

		console.error('tppa failed:', error)
		this.destroy()
		this.handleTppaEvent('idle', 'tppa failed')
	}

	destroy() {
		if (this.stopped) return

		this.stopped = true
		this.move(false)
		this.tppa.mountHandler.mountManager.stop(this.mount)
		this.tppa.solver.stop(this.request.id)
		this.tppa.cameraHandler.stop(this.camera)
	}

	private get moveDuration() {
		return Math.max(1, this.request.moveDuration) * 1000
	}

	private get delayBeforeCapture() {
		return Math.max(0, this.request.delayBeforeCapture) * 1000
	}

	private move(enabled: boolean) {
		if (this.request.direction === 'east') this.tppa.mountHandler.mountManager.moveEast(this.mount, enabled)
		else this.tppa.mountHandler.mountManager.moveWest(this.mount, enabled)
	}
}

export function tppa(tppaHandler: TppaHandler) {
	const { cameraHandler, mountHandler } = tppaHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/tppa/:camera/:mount/start': { POST: async (req) => response(tppaHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/tppa/:id/stop': { POST: (req) => response(tppaHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
