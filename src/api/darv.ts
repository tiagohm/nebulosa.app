import Elysia from 'elysia'
import type { IndiClient } from 'nebulosa/src/indi'
import { type Camera, type CameraCaptureStart, type DarvEvent, type DarvStart, type DarvStop, DEFAULT_DARV_EVENT, type Mount } from 'src/shared/types'
import type { CameraManager } from './camera'
import type { ConnectionManager } from './connection'
import type { IndiDevicePropertyManager } from './indi'
import type { WebSocketMessageManager } from './message'
import { type MountManager, moveEast, moveWest } from './mount'

export class DarvManager {
	private readonly tasks = new Map<string, DarvTask>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly camera: CameraManager,
		readonly mount: MountManager,
		readonly property: IndiDevicePropertyManager,
	) {}

	handleDarvEvent(event: DarvEvent) {
		this.wsm.send('darv', event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			this.tasks.delete(event.id)
		}
	}

	start(request: DarvStart, client: IndiClient, camera: Camera, mount: Mount) {
		const task = new DarvTask(this, client, camera, mount, request, this.handleDarvEvent.bind(this))
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
		private readonly darv: DarvManager,
		private readonly client: IndiClient,
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
		this.capture.width = camera.frame.maxWidth
		this.capture.height = camera.frame.maxHeight
		this.capture.exposureTime = Math.trunc(request.duration + request.initialPause)
		this.capture.exposureTimeUnit = 'SECOND'

		this.event.id = request.id

		this.handleDarvEvent = () => {
			handleDarvEvent(this.event)
		}
	}

	async start() {
		// Start capture
		this.darv.camera.startCameraCapture(this.camera, this.capture, this.client, this.darv.property)

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
		this.aborter.abort()
		this.move(false, false)
		this.darv.camera.stopCameraCapture(this.camera)

		if (this.event.state !== 'IDLE') {
			this.event.state = 'IDLE'
			this.handleDarvEvent()
		}
	}

	private move(enabled: boolean, reversed: boolean) {
		if (enabled) {
			if ((this.request.hemisphere === 'NORTHERN') !== !reversed) {
				moveWest(this.client, this.mount, false)
				moveEast(this.client, this.mount, true)
			} else {
				moveEast(this.client, this.mount, false)
				moveWest(this.client, this.mount, true)
			}
		} else {
			moveEast(this.client, this.mount, false)
			moveWest(this.client, this.mount, false)
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

export function darv(darv: DarvManager, connection: ConnectionManager) {
	const app = new Elysia({ prefix: '/darv' })
		// Endpoints!
		.post('/:camera/:mount/start', ({ params, body }) => darv.start(body as never, connection.get(), darv.camera.get(params.camera)!, darv.mount.get(params.mount)!))
		.post('/stop', ({ body }) => darv.stop(body as never))

	return app
}
