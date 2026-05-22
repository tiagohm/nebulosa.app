import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { type CameraCaptureStart, type DarvEvent, type DarvStart, type DarvStop, DEFAULT_DARV_EVENT } from 'src/shared/types'
import type { CameraHandler } from './camera'
import type { GuideOutputHandler } from './guideoutput'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import { waitFor } from './util'

export class DarvHandler {
	private readonly tasks = new Map<string, DarvTask>()
	private readonly events = new Map<string, DarvEvent>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly guideOutputHandler: GuideOutputHandler,
	) {}

	sendEvent(event: DarvEvent) {
		this.wsm.send('darv', event)
	}

	handleDarvEvent(event: DarvEvent) {
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

	start(request: DarvStart, camera: Camera, mount: Mount) {
		const task = new DarvTask(this, camera, mount, request, this.handleDarvEvent.bind(this))
		this.tasks.set(request.id, task)
		void task.start()
	}

	stop(req: DarvStop) {
		this.tasks.get(req.id)?.stop()
	}
}

export class DarvTask {
	readonly event = structuredClone(DEFAULT_DARV_EVENT)

	readonly #capture: CameraCaptureStart
	readonly #handleDarvEvent: () => void
	#stopped = false

	constructor(
		private readonly darv: DarvHandler,
		readonly camera: Camera,
		readonly mount: Mount,
		private readonly request: DarvStart,
		handleDarvEvent: (event: DarvEvent) => void,
	) {
		this.#capture = request.capture
		this.#capture.autoSave = false
		this.#capture.count = 1
		this.#capture.delay = 0
		this.#capture.frameType = 'LIGHT'
		this.#capture.exposureMode = 'SINGLE'
		this.#capture.mount = mount?.name
		this.#capture.x = 0
		this.#capture.y = 0
		this.#capture.width = camera.frame.width.max
		this.#capture.height = camera.frame.height.max
		this.#capture.exposureTime = Math.trunc(request.duration + request.initialPause)
		this.#capture.exposureTimeUnit = 'SECOND'

		this.event.id = request.id

		this.#handleDarvEvent = () => {
			handleDarvEvent(this.event)
		}
	}

	async start() {
		// Start capture
		await this.darv.cameraHandler.start(this.camera, this.request.capture, (event) => {
			if (event.state === 'IDLE' || event.state === 'ERROR' || event.stopped) this.stop()
		})

		// Wait for initial pause
		this.event.state = 'WAITING'
		this.#handleDarvEvent()

		let success = await waitFor(this.request.initialPause * 1000, () => !this.#stopped)

		if (success) {
			// Move the mount forward
			this.event.state = 'FORWARDING'
			this.#handleDarvEvent()

			const duration = this.request.duration * 500 // ms

			this.move(true, false, duration)

			success = await waitFor(duration, () => !this.#stopped)

			if (success) {
				// Move the mount backward
				this.event.state = 'BACKWARDING'
				this.#handleDarvEvent()

				this.move(true, true, duration)

				await waitFor(duration, () => !this.#stopped)
			}
		}

		// Done
		this.move(false, false, 0)
		this.event.state = 'IDLE'
		this.#handleDarvEvent()
	}

	stop() {
		if (!this.#stopped) {
			this.#stopped = true

			this.move(false, false, 0)
			this.darv.cameraHandler.stop(this.camera)

			if (this.event.state !== 'IDLE') {
				this.event.state = 'IDLE'
				this.#handleDarvEvent()
			}
		}
	}

	private move(enabled: boolean, reversed: boolean, duration: number) {
		const guideOutputManager = this.darv.guideOutputHandler.guideOutputManager

		if (enabled) {
			if ((this.request.hemisphere === 'NORTHERN') !== !reversed) {
				guideOutputManager.pulseWest(this.mount, 0)
				guideOutputManager.pulseEast(this.mount, duration)
			} else {
				guideOutputManager.pulseEast(this.mount, 0)
				guideOutputManager.pulseWest(this.mount, duration)
			}
		} else {
			guideOutputManager.pulseEast(this.mount, 0)
			guideOutputManager.pulseWest(this.mount, 0)
			this.darv.mountHandler.mountManager.stop(this.mount)
		}
	}
}

export function darv(darvHandler: DarvHandler): Endpoints {
	const { cameraHandler, mountHandler } = darvHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/darv/:camera/:mount/start': { POST: async (req) => response(darvHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/darv/stop': { POST: async (req) => response(darvHandler.stop(await req.json())) },
	}
}
