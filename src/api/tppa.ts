import Elysia from 'elysia'
import { ThreePointPolarAlignment } from 'nebulosa/src/alignment'
import { deg } from 'nebulosa/src/angle'
import type { IndiClient } from 'nebulosa/src/indi'
import bus from 'src/shared/bus'
import { type Camera, type CameraCaptureEvent, type CameraCaptureStart, DEFAULT_TPPA_EVENT, type Mount, type TppaEvent, type TppaStart, type TppaStop } from 'src/shared/types'
import type { CacheManager } from './cache'
import type { CameraManager } from './camera'
import type { ConnectionManager } from './connection'
import type { IndiDevicePropertyManager } from './indi'
import type { WebSocketMessageManager } from './message'
import { type MountManager, moveEast, moveWest, tracking } from './mount'
import type { PlateSolverManager } from './platesolver'

export class TppaManager {
	private readonly tasks = new Map<string, TppaTask>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly camera: CameraManager,
		readonly mount: MountManager,
		readonly solver: PlateSolverManager,
		readonly property: IndiDevicePropertyManager,
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

	start(request: TppaStart, client: IndiClient, camera: Camera, mount: Mount, cache: Map<string, Buffer>) {
		const task = new TppaTask(this, client, camera, mount, request, cache, this.handleTppaEvent.bind(this))
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
	private readonly handleTppaEvent: (event: TppaEvent) => void

	constructor(
		private readonly tppa: TppaManager,
		private readonly client: IndiClient,
		readonly camera: Camera,
		readonly mount: Mount,
		private readonly request: TppaStart,
		private readonly cache: Map<string, Buffer>,
		handleTppaEvent: (event: TppaEvent) => void,
	) {
		this.capture = this.request.capture
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

		this.polarAlignment = new ThreePointPolarAlignment(request.refraction)

		this.event.id = this.request.id

		this.handleTppaEvent = (event) => {
			handleTppaEvent(event)

			if (event.state === 'IDLE') {
				this.stopTrackingWhenDone()
			}
		}
	}

	async cameraCaptured(event: CameraCaptureEvent) {
		if (event.savedPath) {
			this.event.state = 'SOLVING'
			this.handleTppaEvent(this.event)

			// Retrieve image from cache
			const parts = event.savedPath!.split(':')
			const key = Buffer.from(parts[1], 'hex').toString('utf-8')
			const buffer = this.cache.get(key)!

			// Save image to temporary file
			// TODO: Save on tmp directory on Windows and MacOS
			const file = Bun.file(`/dev/shm/tppa.${event.device}.fit`)
			await Bun.write(file, buffer)

			// Solve image
			const solution = await this.tppa.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: deg(8), path: file.name!, id: this.request.id, blind: false })

			if (solution) {
				this.event.attempts = 0
				this.event.solved = true
				this.event.solver.rightAscension = solution.rightAscension
				this.event.solver.declination = solution.declination
				this.event.state = 'ALIGNING'
				this.handleTppaEvent(this.event)

				// Compute polar alignment
				const location = this.tppa.cache.geographicCoordinate(this.mount.geographicCoordinate)
				const time = this.tppa.cache.time('now', location)
				const result = this.polarAlignment.add(solution.rightAscension, solution.declination, time, true)

				this.event.aligned = result !== false

				if (result) {
					this.event.attempts = 0
					this.event.error.azimuth = result.azimuthError
					this.event.error.altitude = result.altitudeError
				} else if (this.event.step >= 3) {
					// Failed to align!
					this.event.state = 'IDLE'
					this.event.failed = true
					this.handleTppaEvent(this.event)
					return
				}

				this.handleTppaEvent(this.event)
			} else if (++this.event.attempts < 3) {
				this.event.solved = false
				this.handleTppaEvent(this.event)
			} else {
				// Failed to solve after 3 attempts
				this.event.state = 'IDLE'
				this.event.solved = false
				this.event.failed = true
				this.handleTppaEvent(this.event)
				return
			}

			if (this.event.solved) {
				this.event.step++

				// Move telescope
				if (this.event.step < 3) {
					this.event.state = 'MOVING'
					this.handleTppaEvent(this.event)

					this.move(true)
					await Bun.sleep(Math.max(1, this.request.moveDuration) * 1000)
					this.move(false)

					// Wait for settle
					await Bun.sleep(Math.max(1, this.request.settleDuration) * 1000)
				}
			}

			// Capture next image
			this.event.state = 'CAPTURING'
			this.handleTppaEvent(this.event)
			this.tppa.camera.startCameraCapture(this.camera, this.capture, this.client, this.tppa.property)
		}
	}

	start() {
		// Enable mount tracking
		tracking(this.client, this.mount, true)

		// First image
		this.event.state = 'CAPTURING'
		this.handleTppaEvent(this.event)
		this.tppa.camera.startCameraCapture(this.camera, this.capture, this.client, this.tppa.property)
	}

	stop() {
		this.move(false)
		this.tppa.solver.stop(this.request)
		this.tppa.camera.stopCameraCapture(this.camera)

		if (this.event.state !== 'IDLE') {
			this.event.state = 'IDLE'
			this.handleTppaEvent(this.event)
		}
	}

	private move(enabled: boolean) {
		if (this.request.direction === 'EAST') moveEast(this.client, this.mount, enabled)
		else moveWest(this.client, this.mount, enabled)
	}

	private stopTrackingWhenDone() {
		if (this.request.stopTrackingWhenDone) {
			tracking(this.client, this.mount, false)
		}
	}
}

export function tppa(tppa: TppaManager, connection: ConnectionManager, cache: Map<string, Buffer>) {
	const app = new Elysia({ prefix: '/tppa' })
		// Endpoints!
		.post('/:camera/:mount/start', ({ params, body }) => tppa.start(body as never, connection.get(), tppa.camera.get(params.camera)!, tppa.mount.get(params.mount)!, cache))
		.post('/stop', ({ body }) => tppa.stop(body as never))

	return app
}
