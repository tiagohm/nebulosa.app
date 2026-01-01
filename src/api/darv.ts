import Elysia from 'elysia'
import type { Camera, Mount } from 'nebulosa/src/indi.device'
import type { MountManager } from 'nebulosa/src/indi.manager'
import { type CameraCaptureStart, type DarvEvent, type DarvStart, type DarvStop, DEFAULT_DARV_EVENT } from 'src/shared/types'
import type { CameraHandler } from './camera'
import type { WebSocketMessageHandler } from './message'

export class DarvHandler {
	private readonly tasks = new Map<string, DarvTask>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountManager: MountManager,
	) {}

	handleDarvEvent(event: DarvEvent) {
		this.wsm.send('darv', event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			const task = this.tasks.get(event.id)

			if (task) {
				task.close()
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
	private readonly capture: CameraCaptureStart
	private readonly event = structuredClone(DEFAULT_DARV_EVENT)
	private readonly handleDarvEvent: () => void
	private readonly aborter = new AbortController()

	constructor(
		private readonly darv: DarvHandler,
		readonly camera: Camera,
		readonly mount: Mount,
		private readonly request: DarvStart,
		handleDarvEvent: (event: DarvEvent) => void,
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
		this.capture.exposureTime = Math.trunc(request.duration + request.initialPause)
		this.capture.exposureTimeUnit = 'SECOND'

		this.event.id = request.id

		this.handleDarvEvent = () => {
			handleDarvEvent(this.event)
		}
	}

	async start() {
		// Start capture
		this.darv.cameraHandler.startCapture(this.camera, this.request.capture)

		// Wait for initial pause
		this.event.state = 'WAITING'
		this.handleDarvEvent()

		let ok = await waitFor(this.request.initialPause * 1000, this.aborter.signal)

		if (ok) {
			// Move the mount forward
			this.event.state = 'FORWARDING'
			this.handleDarvEvent()

			this.move(true, false)

			ok = await waitFor(this.request.duration * 500, this.aborter.signal)

			if (ok) {
				// Move the mount backward
				this.event.state = 'BACKWARDING'
				this.handleDarvEvent()

				this.move(true, true)

				await waitFor(this.request.duration * 500, this.aborter.signal)
			}
		}

		// Done
		this.move(false, false)
		this.event.state = 'IDLE'
		this.handleDarvEvent()
	}

	stop() {
		this.close()

		this.move(false, false)
		this.darv.cameraHandler.stopCapture(this.camera)

		if (this.event.state !== 'IDLE') {
			this.event.state = 'IDLE'
			this.handleDarvEvent()
		}
	}

	close() {
		this.aborter.abort()
	}

	private move(enabled: boolean, reversed: boolean) {
		if (enabled) {
			if ((this.request.hemisphere === 'NORTHERN') !== !reversed) {
				this.darv.mountManager.moveWest(this.mount, false)
				this.darv.mountManager.moveEast(this.mount, true)
			} else {
				this.darv.mountManager.moveEast(this.mount, false)
				this.darv.mountManager.moveWest(this.mount, true)
			}
		} else {
			this.darv.mountManager.moveEast(this.mount, false)
			this.darv.mountManager.moveWest(this.mount, false)
		}
	}
}

async function waitFor(ms: number, signal: AbortSignal) {
	while (true) {
		if (ms <= 0) {
			return true
		} else if (signal.aborted) {
			return false
		}

		// Sleep for 1 second
		await Bun.sleep(Math.max(1, Math.min(999, ms)))

		// Subtract 1 second from remaining time
		ms -= 1000
	}
}

export function darv(darv: DarvHandler) {
	function cameraFromParams(clientId: string, id: string) {
		return darv.cameraHandler.cameraManager.get(clientId, decodeURIComponent(id))!
	}

	function mountFromParams(clientId: string, id: string) {
		return darv.mountManager.get(clientId, decodeURIComponent(id))!
	}

	const app = new Elysia({ prefix: '/darv' })
		// Endpoints!
		.post('/:camera/:mount/start', ({ params, query, body }) => darv.start(body as never, cameraFromParams(query.clientId, params.camera), mountFromParams(query.clientId, params.mount)))
		.post('/stop', ({ body }) => darv.stop(body as never))

	return app
}
