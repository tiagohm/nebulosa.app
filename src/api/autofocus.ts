import { AutoFocus } from 'nebulosa/src/autofocus'
import type { Point } from 'nebulosa/src/geometry'
import type { Camera, Focuser } from 'nebulosa/src/indi.device'
import type { Regression } from 'nebulosa/src/regression'
import { medianOf, NumberComparator } from 'nebulosa/src/util'
import { type AutoFocusEvent, type AutoFocusStart, type AutoFocusState, type CameraCaptureEvent, DEFAULT_AUTO_FOCUS_EVENT } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import type { CameraHandler } from './camera'
import { type FocuserHandler, waitForFocuser } from './focuser'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { StarDetectionHandler } from './stardetection'

export class AutoFocusHandler {
	private readonly tasks: AutoFocusTask[] = []

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly focuserHandler: FocuserHandler,
		readonly starDetectionHandler: StarDetectionHandler,
	) {}

	sendEvent(event: AutoFocusEvent) {
		this.wsm.send('autofocus', event)
	}

	private handleAutoFocusEvent(event: AutoFocusEvent, task: AutoFocusTask) {
		this.sendEvent(event)

		if (event.state === 'IDLE') {
			this.stop(event.id)
		}
	}

	start(camera: Camera, focuser: Focuser, request: AutoFocusStart) {
		if (this.tasks.some((e) => e.request.id === request.id || e.camera.id === camera.id || e.focuser.id === focuser.id)) return
		const task = new AutoFocusTask(this, request, camera, focuser, this.handleAutoFocusEvent.bind(this))
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

export class AutoFocusTask {
	readonly event = structuredClone(DEFAULT_AUTO_FOCUS_EVENT)

	private readonly autoFocus: AutoFocus
	private readonly handleAutoFocusEvent: (state: AutoFocusState, message?: string) => void
	private readonly unsubscribers: VoidFunction[] = []
	private stopped = false

	constructor(
		readonly autoFocusHandler: AutoFocusHandler,
		readonly request: AutoFocusStart,
		readonly camera: Camera,
		readonly focuser: Focuser,
		handleAutoFocusEvent: (event: AutoFocusEvent, task: AutoFocusTask) => void,
	) {
		request.maxPosition ||= focuser.position.max
		this.autoFocus = new AutoFocus(request)

		this.event.id = request.id
		this.event.camera = camera.id
		this.event.focuser = focuser.id

		this.handleAutoFocusEvent = (state, message) => {
			if (state !== this.event.state) {
				this.event.state = state
				this.event.message = message
				handleAutoFocusEvent(this.event, this)
			}
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent) {
		const { savedPath } = event

		if (savedPath && !this.stopped && !event.stopped) {
			if (this.stopped) {
				return this.handleAutoFocusEvent('IDLE', 'stopped')
			}

			this.handleAutoFocusEvent('COMPUTING', '')

			// Detect stars
			const stars = await this.autoFocusHandler.starDetectionHandler.detect({ ...this.request.starDetection, path: savedPath })

			if (this.stopped) {
				return this.handleAutoFocusEvent('IDLE', 'stopped')
			} else if (stars.length === 0) {
				return this.handleAutoFocusEvent('IDLE', 'no stars detected')
			}

			// Compute the HFD from detected stars
			const hfd = medianOf(stars.map((e) => e.hfd).sort(NumberComparator))
			// Compute the next step given current focuser position and HFD
			const step = this.autoFocus.add(this.focuser.position.value, hfd)

			this.event.starCount = stars.length
			this.event.hfd = hfd

			// The focuser position to move
			const position = Math.max(this.focuser.position.min, Math.min(step.absolute ? step.absolute : step.relative ? this.focuser.position.value + step.relative : 0, this.focuser.position.max))

			if (this.stopped) {
				this.handleAutoFocusEvent('IDLE', 'stopped')
			} else if (step.type === 'MOVE') {
				this.computeChart()

				// Wait for focuser reach position
				this.unsubscribers[0] = waitForFocuser(this.focuser, position, (event) => {
					if (event === 'reach') {
						void this.start()
					} else if (event === 'cancel') {
						this.handleAutoFocusEvent('IDLE', 'stopped')
					} else {
						this.handleAutoFocusEvent('IDLE', `failed to move to position ${position}`)
					}
				})

				// Move the focuser
				this.handleAutoFocusEvent('MOVING', `moving to position ${position}`)
				this.autoFocusHandler.focuserHandler.moveTo(this.focuser, position)
			} else if (step.type === 'COMPLETED') {
				this.computeChart()

				// Move the focuser to determined focus point
				const position = this.autoFocus.focusPoint!.x
				this.handleAutoFocusEvent('MOVING', `moving to best focus at position ${position}`)
				this.autoFocusHandler.focuserHandler.moveTo(this.focuser, position)

				this.unsubscribers[0] = waitForFocuser(this.focuser, position, () => {
					// TODO: Compare the HFD at best focus with the initial HFD. If it's worse, go back to initial position.
					this.handleAutoFocusEvent('IDLE', 'best focus!')
				})
			} else {
				this.unsubscribers[0] = waitForFocuser(this.focuser, position, () => {
					this.handleAutoFocusEvent('IDLE', 'restoring to initial focus position')
				})
			}
		} else if (event.state === 'ERROR' || event.stopped) {
			this.stop()
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
		const { minimum, maximum } = this.autoFocus
		if (minimum === undefined || maximum === undefined) return undefined

		const points = new Array<Point>(10)
		const stepSize = (maximum.x - minimum.x) / (points.length - 1)

		for (let i = 0, x = minimum.x; i < points.length; i++, x += stepSize) {
			points[i] = { x, y: regression.predict(x) }
		}

		return points
	}

	start() {
		this.request.capture.delay = 0
		this.request.capture.count = 1
		this.request.capture.autoSave = false
		this.request.capture.savePath = undefined
		this.request.capture.focuser = this.focuser?.name
		this.request.capture.frameType = 'LIGHT'
		this.request.capture.exposureMode = 'SINGLE'

		this.handleAutoFocusEvent('CAPTURING', '')

		return this.autoFocusHandler.cameraHandler.start(this.camera, this.request.capture, this.cameraCaptured.bind(this))
	}

	stop() {
		if (this.stopped) return

		this.stopped = true

		unsubscribe(this.unsubscribers)
		this.autoFocusHandler.focuserHandler.stop(this.focuser)
		this.autoFocusHandler.cameraHandler.stop(this.camera)
		this.handleAutoFocusEvent('IDLE', 'stopped')
	}
}

export function autoFocus(autoFocusHandler: AutoFocusHandler): Endpoints {
	const { cameraHandler, focuserHandler } = autoFocusHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	function focuserFromParams(req: Bun.BunRequest) {
		return focuserHandler.focuserManager.get(query(req).client, req.params.focuser)!
	}

	return {
		'/autofocus/:camera/:focuser/start': { POST: async (req) => response(autoFocusHandler.start(cameraFromParams(req), focuserFromParams(req), await req.json())) },
		'/autofocus/:id/stop': { POST: (req) => response(autoFocusHandler.stop(req.params.id)) },
	}
}
