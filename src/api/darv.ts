import type { Camera, Mount } from 'nebulosa/src/indi.device'
import { type DarvEvent, type DarvStart, type DarvState, DEFAULT_DARV_EVENT } from 'src/shared/types'
import type { CameraHandler } from './camera'
import type { GuideOutputHandler } from './guideoutput'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import { waitFor } from './util'

export class DarvHandler {
	private readonly tasks: DarvTask[] = []

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly guideOutputHandler: GuideOutputHandler,
	) {}

	sendEvent(event: DarvEvent) {
		this.wsm.send('darv', event)
	}

	handleDarvEvent(event: DarvEvent, task: DarvTask) {
		this.sendEvent(event)

		if (event.state === 'idle') {
			if (this.remove(task)) task.destroy()
		}
	}

	start(request: DarvStart, camera: Camera, mount: Mount) {
		if (this.tasks.some((e) => e.request.id === request.id || e.camera.id === camera.id || e.mount.id === mount.id)) return
		const task = new DarvTask(this, request, camera, mount, this.handleDarvEvent.bind(this))
		this.tasks.push(task)
		void task.start().catch((error) => task.fail(error))
	}

	stop(id: string) {
		const index = this.tasks.findIndex((e) => e.request.id === id)

		if (index >= 0) {
			const task = this.tasks[index]
			this.tasks.splice(index, 1)
			task.stop()
		}
	}

	private remove(task: DarvTask) {
		const index = this.tasks.indexOf(task)

		if (index >= 0) {
			this.tasks.splice(index, 1)
			return true
		}

		return false
	}
}

export class DarvTask {
	readonly event = structuredClone(DEFAULT_DARV_EVENT)

	private readonly handleDarvEvent: (state: DarvState, message?: string) => void
	private stopped = false

	constructor(
		readonly darv: DarvHandler,
		readonly request: DarvStart,
		readonly camera: Camera,
		readonly mount: Mount,
		handleDarvEvent: (event: DarvEvent, task: DarvTask) => void,
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
		request.capture.exposureTime = Math.ceil(Math.max(0, request.duration + request.initialPause))
		request.capture.exposureTimeUnit = 'second'

		this.event.id = request.id
		this.event.camera = camera.id
		this.event.mount = mount.id

		this.handleDarvEvent = (state, message) => {
			if (state !== this.event.state || message !== this.event.message) {
				this.event.state = state
				this.event.message = message
				handleDarvEvent(this.event, this)
			}
		}
	}

	async start() {
		if (this.stopped) return

		// Start capture
		void this.darv.cameraHandler.start(this.camera, this.request.capture, (event) => {
			if (event.state === 'idle' || event.state === 'error' || event.stopped) this.stop()
		})

		if (this.stopped) return

		// Wait for initial pause
		this.handleDarvEvent('waiting')

		let success = await waitFor(this.initialPause, () => !this.stopped)

		if (success) {
			// Move the mount forward
			this.handleDarvEvent('forwarding')

			const duration = this.duration / 2

			this.move(true, false, duration)

			success = await waitFor(duration, () => !this.stopped)

			if (success) {
				// Move the mount backward
				this.handleDarvEvent('backwarding')

				this.move(true, true, duration)

				await waitFor(duration, () => !this.stopped)
			}
		}

		// Done
		this.destroy()
		this.handleDarvEvent('idle')
	}

	stop() {
		if (!this.stopped) {
			this.destroy()
			if (this.event.state !== 'idle') {
				this.handleDarvEvent('idle')
			}
		}
	}

	fail(error: unknown) {
		if (this.stopped) return

		console.error('darv failed:', error)
		this.destroy()
		this.handleDarvEvent('idle', 'darv failed')
	}

	destroy() {
		if (this.stopped) return

		this.stopped = true
		this.move(false, false, 0)
		this.darv.cameraHandler.stop(this.camera)
	}

	private get initialPause() {
		return Math.max(0, this.request.initialPause * 1000)
	}

	private get duration() {
		return Math.max(0, this.request.duration * 1000)
	}

	private move(enabled: boolean, reversed: boolean, duration: number) {
		const guideOutputManager = this.darv.guideOutputHandler.guideOutputManager

		if (enabled) {
			if ((this.request.hemisphere === 'northern') !== !reversed) {
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

export function darv(darvHandler: DarvHandler) {
	const { cameraHandler, mountHandler } = darvHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/darv/:camera/:mount/start': { POST: async (req) => response(darvHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/darv/:id/stop': { POST: (req) => response(darvHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
