import Elysia from 'elysia'
import { AutoFocus } from 'nebulosa/src/autofocus'
import type { Point } from 'nebulosa/src/geometry'
import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import type { Regression } from 'nebulosa/src/regression'
import { medianOf } from 'nebulosa/src/util'
import { type AutoFocusEvent, type AutoFocusRequest, type AutoFocusState, type CameraCaptureEvent, DEFAULT_AUTO_FOCUS_EVENT } from 'src/shared/types'
import type { CameraHandler } from './camera'
import { type FocuserHandler, waitForFocuser } from './focuser'
import type { WebSocketMessageHandler } from './message'
import type { StarDetectionHandler } from './stardetection'

export class AutoFocusHandler {
	private readonly tasks = new Map<string, AutoFocusTask>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly focuserHandler: FocuserHandler,
		readonly starDetectionHandler: StarDetectionHandler,
	) {}

	sendEvent(event: AutoFocusEvent) {
		this.wsm.send('autofocus', event)
	}

	private handleAutoFocusEvent({ camera, focuser }: AutoFocusTask, event: AutoFocusEvent) {
		this.sendEvent(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			const key = `${camera.id}:${focuser.id}`
			this.tasks.delete(key)
		}
	}

	start(camera: Camera, focuser: Focuser, request: AutoFocusRequest) {
		const key = `${camera.id}:${focuser.id}`

		const task = new AutoFocusTask(this, request, camera, focuser, this.handleAutoFocusEvent.bind(this))
		this.tasks.set(key, task)
		task.start()
	}

	stop(camera: Camera, focuser: Focuser) {
		const key = `${camera.id}:${focuser.id}`
		this.tasks.get(key)?.stop()
		this.tasks.delete(key)
	}
}

export class AutoFocusTask {
	private readonly autoFocus: AutoFocus
	private readonly event = structuredClone(DEFAULT_AUTO_FOCUS_EVENT)
	private readonly handleAutoFocusEvent: (state: AutoFocusState, message: string) => void
	private waitForFocuserUnsubscriber?: VoidFunction
	private stopped = false

	constructor(
		readonly autoFocusHandler: AutoFocusHandler,
		readonly request: AutoFocusRequest,
		readonly camera: Camera,
		readonly focuser: Focuser,
		handleAutoFocusEvent: (task: AutoFocusTask, event: AutoFocusEvent) => void,
	) {
		request.maxPosition ||= focuser.position.max
		this.autoFocus = new AutoFocus(request)

		this.event.camera = camera.id
		this.event.focuser = focuser.id

		this.handleAutoFocusEvent = (state, message) => {
			this.event.state = state
			this.event.message = message
			handleAutoFocusEvent(this, this.event)
		}
	}

	async cameraCaptured(event: CameraCaptureEvent) {
		if (event.savedPath && !this.stopped) {
			if (this.stopped) {
				return this.handleAutoFocusEvent('IDLE', 'Stopped')
			}

			this.handleAutoFocusEvent('COMPUTING', '')

			// Detect stars
			const stars = await this.autoFocusHandler.starDetectionHandler.detect({ ...this.request.starDetection, path: event.savedPath })

			if (this.stopped) {
				return this.handleAutoFocusEvent('IDLE', 'Stopped')
			} else if (stars.length === 0) {
				return this.handleAutoFocusEvent('IDLE', 'No stars detected')
			}

			// Compute the HFD from detected stars
			const hfd = medianOf(stars.map((e) => e.hfd).sort((a, b) => a - b))
			// Compute the next step given current focuser position and HFD
			const step = this.autoFocus.add(this.focuser.position.value, hfd)

			// The focuser position to move
			const position = Math.max(this.focuser.position.min, Math.min(step.absolute ? step.absolute : step.relative ? this.focuser.position.value + step.relative : 0, this.focuser.position.max))

			if (this.stopped) {
				this.handleAutoFocusEvent('IDLE', 'Stopped')
			} else if (step.type === 'MOVE') {
				this.computeChart()

				// Wait for focuser reach position
				this.waitForFocuserUnsubscriber = waitForFocuser(this.focuser, position, (event) => {
					if (event === 'reach') {
						this.start()
					} else if (event === 'cancel') {
						this.handleAutoFocusEvent('IDLE', 'Stopped')
					} else {
						this.handleAutoFocusEvent('IDLE', `Failed to move the focuser to position ${position}`)
					}
				})

				// Move the focuser
				this.handleAutoFocusEvent('MOVING', `Moving to position ${position}`)
				this.autoFocusHandler.focuserHandler.moveTo(this.focuser, position)
			} else if (step.type === 'COMPLETED') {
				this.computeChart()

				// Move the focuser to determined focus point
				const position = this.autoFocus.focusPoint!.x
				this.handleAutoFocusEvent('MOVING', `Moving to best focus at position ${position}`)
				this.autoFocusHandler.focuserHandler.moveTo(this.focuser, position)

				this.waitForFocuserUnsubscriber = waitForFocuser(this.focuser, position, () => {
					// TODO: Compare the HFD at best focus with the initial HFD. If it's worse, go back to initial position.
					this.handleAutoFocusEvent('IDLE', 'Best focus!')
				})
			} else {
				this.waitForFocuserUnsubscriber = waitForFocuser(this.focuser, position, () => {
					this.handleAutoFocusEvent('IDLE', 'Failed! Restored to initial focus position')
				})
			}
		}
	}

	private computeChart() {
		const { trendLine, parabolic, hyperbolic, minimum, maximum, focusPoint } = this.autoFocus

		this.event.x = Array.from(trendLine?.xPoints ?? [])
		this.event.y = Array.from(trendLine?.yPoints ?? [])
		this.event.left = this.makeChart(trendLine?.left)
		this.event.right = this.makeChart(trendLine?.right)
		this.event.parabolic = this.makeChart(parabolic)
		this.event.hyperbolic = this.makeChart(hyperbolic)
		this.event.minimum = minimum
		this.event.maximum = maximum
		this.event.focusPoint = focusPoint
	}

	private makeChart(regression?: Regression) {
		if (!regression || regression.xPoints.length < 3) return undefined

		const points = new Array<Point>(10)
		const stepSize = (this.autoFocus.maximum.x - this.autoFocus.minimum.x) / (points.length - 1)

		for (let i = 0, x = this.autoFocus.minimum.x; i < points.length; i++, x += stepSize) {
			points[i] = { x, y: regression.predict(x) }
		}

		return points
	}

	start() {
		this.request.capture.delay = 0
		this.request.capture.count = 1
		this.request.capture.autoSave = false
		this.request.capture.focuser = this.focuser?.name

		this.handleAutoFocusEvent('CAPTURING', '')

		this.autoFocusHandler.cameraHandler.start(this.camera, this.request.capture, this.cameraCaptured.bind(this))
	}

	stop() {
		if (!this.stopped) {
			this.stopped = true
			this.waitForFocuserUnsubscriber?.()
			this.autoFocusHandler.focuserHandler.stop(this.focuser)
			this.autoFocusHandler.cameraHandler.stop(this.camera)
			this.handleAutoFocusEvent('IDLE', 'Stopped')
		}
	}
}

export function autoFocus(autoFocusHandler: AutoFocusHandler) {
	function cameraFromParams(clientId: string, id: string) {
		return autoFocusHandler.cameraHandler.cameraManager.get(clientId, decodeURIComponent(id))!
	}

	function focuserFromParams(clientId: string, id: string) {
		return autoFocusHandler.focuserHandler.focuserManager.get(clientId, decodeURIComponent(id))!
	}

	const app = new Elysia({ prefix: '/autofocus' })
		// Endpoints
		.post('/:camera/:focuser/start', ({ params, query, body }) => autoFocusHandler.start(cameraFromParams(query.clientId, params.camera), focuserFromParams(query.clientId, params.focuser), body as never))
		.post('/:camera/:focuser/stop', ({ params, query }) => autoFocusHandler.stop(cameraFromParams(query.clientId, params.camera), focuserFromParams(query.clientId, params.focuser)))

	return app
}
