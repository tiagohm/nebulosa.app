import { join } from 'path'
import { histogram } from 'nebulosa/src/image.computation'
import type { Camera, MinMaxValueProperty } from 'nebulosa/src/indi.device'
import { formatTemporal } from 'nebulosa/src/temporal'
import { type CameraCaptureEvent, DEFAULT_FLAT_WIZARD_EVENT, DEFAULT_IMAGE_TRANSFORMATION, type FlatWizardEvent, type FlatWizardStart, type FlatWizardState, type ImageTransformation } from 'src/shared/types'
import type { CameraHandler } from './camera'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

const FLAT_WIZARD_IMAGE_TRANSFORMATION: ImageTransformation = { ...DEFAULT_IMAGE_TRANSFORMATION, enabled: false, format: { ...DEFAULT_IMAGE_TRANSFORMATION.format, type: 'fits' } }

export class FlatWizardHandler {
	private readonly tasks: FlatWizardTask[] = []

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
	) {}

	sendEvent(event: FlatWizardEvent) {
		this.wsm.send('flatwizard', event)
	}

	private handleFlatWizardEvent(event: FlatWizardEvent, task: FlatWizardTask) {
		this.sendEvent(event)

		if (event.state === 'idle') {
			if (this.remove(task)) task.destroy()
		}
	}

	start(camera: Camera, request: FlatWizardStart) {
		if (this.tasks.some((e) => e.request.id === request.id || e.camera.id === camera.id)) return
		const task = new FlatWizardTask(this, request, camera, this.handleFlatWizardEvent.bind(this))
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

	private remove(task: FlatWizardTask) {
		const index = this.tasks.indexOf(task)

		if (index >= 0) {
			this.tasks.splice(index, 1)
			return true
		}

		return false
	}
}

export class FlatWizardTask {
	readonly event = structuredClone(DEFAULT_FLAT_WIZARD_EVENT)

	private readonly handleFlatWizardEvent: (state: FlatWizardState, message?: string) => void
	private readonly exposure: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }
	private readonly mean: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }
	private stopped = false

	constructor(
		readonly flatWizardHandler: FlatWizardHandler,
		readonly request: FlatWizardStart,
		readonly camera: Camera,
		handleFlatWizardEvent: (event: FlatWizardEvent, task: FlatWizardTask) => void,
	) {
		this.event.id = request.id
		this.event.camera = camera.id

		this.exposure.min = Math.min(request.minExposure, request.maxExposure)
		this.exposure.max = Math.max(request.minExposure, request.maxExposure)

		const meanTarget = request.meanTarget / 65535
		const meanTolerance = (meanTarget * request.meanTolerance) / 100
		this.mean.min = meanTarget - meanTolerance
		this.mean.max = meanTarget + meanTolerance

		this.handleFlatWizardEvent = (state, message) => {
			if (state !== this.event.state || message !== this.event.message) {
				this.event.state = state
				this.event.message = message
				handleFlatWizardEvent(this.event, this)
			}
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent) {
		const { savedPath } = event

		if (savedPath && !this.stopped && !event.stopped) {
			if (this.stopped) {
				return this.handleFlatWizardEvent('idle', 'stopped')
			}

			this.handleFlatWizardEvent('computing', '')

			const transformed = await this.flatWizardHandler.cameraHandler.imageProcessor.transform(savedPath, false, this.camera.name)

			if (!transformed) {
				this.fail(new Error('failed to load captured flat frame'))
				return
			}

			if (this.stopped) return

			const { image } = transformed
			const { median } = histogram(image)

			this.event.median = median

			if (median >= this.mean.min && median <= this.mean.max) {
				const extension = this.request.capture.transferFormat === 'XISF' ? 'xisf' : 'fit'
				const path = join(this.request.path || Bun.env.capturesDir, `${formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS')}.${extension}`)
				const exported = await this.flatWizardHandler.cameraHandler.imageProcessor.export(savedPath, FLAT_WIZARD_IMAGE_TRANSFORMATION, this.camera.name, path)

				if (this.stopped) return

				if (!exported) {
					this.fail(new Error('failed to save flat frame'))
					return
				}

				return this.handleFlatWizardEvent('idle', `saved at ${path}`)
			} else if (median < this.mean.min) {
				this.exposure.min = this.request.capture.exposureTime
			} else {
				this.exposure.max = this.request.capture.exposureTime
			}

			if (this.stopped) {
				return this.handleFlatWizardEvent('idle', 'stopped')
			}

			const delta = this.exposure.max - this.exposure.min

			// 1 ms
			if (delta < 1) {
				return this.handleFlatWizardEvent('idle', 'unable to find an optimal exposure time')
			}

			await this.start()
		} else if (event.state === 'error') {
			this.fail(new Error('camera capture failed'))
		} else if (event.stopped) {
			this.stop()
		}
	}

	async start() {
		if (this.stopped) return

		this.request.capture.delay = 0
		this.request.capture.count = 1
		this.request.capture.autoSave = false
		this.request.capture.savePath = undefined
		this.request.capture.exposureTime = (this.exposure.min + this.exposure.max) / 2
		this.request.capture.exposureTimeUnit = 'millisecond'
		this.request.capture.frameType = 'FLAT'
		this.request.capture.exposureMode = 'single'

		this.handleFlatWizardEvent('capturing', `exposure of ${this.request.capture.exposureTime.toFixed(0)} ms`)

		await this.flatWizardHandler.cameraHandler.start(this.camera, this.request.capture, (event) => {
			void this.cameraCaptured(event).catch((error) => this.fail(error))
		})
	}

	stop() {
		if (!this.stopped) {
			this.destroy()
			this.handleFlatWizardEvent('idle', 'stopped')
		}
	}

	fail(error: unknown) {
		if (this.stopped) return

		console.error('flat wizard failed:', error)
		this.destroy()
		this.handleFlatWizardEvent('idle', 'flat wizard failed')
	}

	destroy() {
		if (this.stopped) return

		this.stopped = true
		this.flatWizardHandler.cameraHandler.stop(this.camera)
	}
}

export function flatWizard(flatWizardHandler: FlatWizardHandler): Endpoints {
	const { cameraHandler } = flatWizardHandler

	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	return {
		'/flatwizard/:camera/start': { POST: async (req) => response(flatWizardHandler.start(cameraFromParams(req), await req.json())) },
		'/flatwizard/:id/stop': { POST: (req) => response(flatWizardHandler.stop(req.params.id)) },
	}
}
