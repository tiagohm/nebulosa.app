import { histogram } from 'nebulosa/src/image.computation'
import type { Camera, MinMaxValueProperty } from 'nebulosa/src/indi.device'
import { formatTemporal } from 'nebulosa/src/temporal'
import { join } from 'path'
import { type CameraCaptureEvent, DEFAULT_FLAT_WIZARD_EVENT, DEFAULT_IMAGE_TRANSFORMATION, type FlatWizardEvent, type FlatWizardStart, type FlatWizardState, type ImageTransformation } from 'src/shared/types'
import type { CameraHandler } from './camera'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

const FLAT_WIZARD_IMAGE_TRANSFORMTION: ImageTransformation = { ...DEFAULT_IMAGE_TRANSFORMATION, enabled: false, format: { ...DEFAULT_IMAGE_TRANSFORMATION.format, type: 'fits' } }

export class FlatWizardHandler {
	private readonly tasks = new Map<string, FlatWizardTask>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
	) {}

	sendEvent(event: FlatWizardEvent) {
		this.wsm.send('flatwizard', event)
	}

	private handleFlatWizardEvent({ camera }: FlatWizardTask, event: FlatWizardEvent) {
		this.sendEvent(event)

		// Remove the task after it finished
		if (event.state === 'IDLE') {
			const task = this.tasks.get(camera.id)

			if (task) {
				task.stop()
				this.tasks.delete(camera.id)
			}
		}
	}

	start(camera: Camera, request: FlatWizardStart) {
		this.stop(camera)
		const task = new FlatWizardTask(this, request, camera, this.handleFlatWizardEvent.bind(this))
		this.tasks.set(camera.id, task)
		void task.start()
	}

	stop(camera: Camera) {
		this.tasks.get(camera.id)?.stop()
		this.tasks.delete(camera.id)
	}
}

export class FlatWizardTask {
	private readonly event = structuredClone(DEFAULT_FLAT_WIZARD_EVENT)
	private readonly handleFlatWizardEvent: (state: FlatWizardState, message: string) => void
	private readonly exposure: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }
	private readonly mean: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }
	private stopped = false

	constructor(
		readonly flatWizardHandler: FlatWizardHandler,
		readonly request: FlatWizardStart,
		readonly camera: Camera,
		handleFlatWizardEvent: (task: FlatWizardTask, event: FlatWizardEvent) => void,
	) {
		this.event.camera = camera.id

		this.exposure.min = Math.min(request.minExposure, request.maxExposure)
		this.exposure.max = Math.max(request.minExposure, request.maxExposure)

		const meanTarget = request.meanTarget / 65535
		const meanTolerance = (meanTarget * request.meanTolerance) / 100
		this.mean.min = meanTarget - meanTolerance
		this.mean.max = meanTarget + meanTolerance

		this.handleFlatWizardEvent = (state, message) => {
			this.event.state = state
			this.event.message = message
			handleFlatWizardEvent(this, this.event)
		}
	}

	private async cameraCaptured(event: CameraCaptureEvent) {
		const { savedPath } = event

		if (savedPath && !this.stopped && !event.stopped) {
			if (this.stopped) {
				return this.handleFlatWizardEvent('IDLE', 'Stopped')
			}

			this.handleFlatWizardEvent('COMPUTING', '')

			const { image } = (await this.flatWizardHandler.cameraHandler.imageProcessor.transform(savedPath, false, this.camera?.name))!
			const { median } = histogram(image)

			this.event.median = median

			if (median >= this.mean.min && median <= this.mean.max) {
				const path = join(this.request.path || Bun.env.capturesDir, `${formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS')}.fit`)
				await this.flatWizardHandler.cameraHandler.imageProcessor.export(savedPath, FLAT_WIZARD_IMAGE_TRANSFORMTION, this.camera?.name, path)
				return this.handleFlatWizardEvent('IDLE', `Saved at ${path}`)
			} else if (median < this.mean.min) {
				this.exposure.min = this.request.capture.exposureTime
			} else {
				this.exposure.max = this.request.capture.exposureTime
			}

			if (this.stopped) {
				return this.handleFlatWizardEvent('IDLE', 'Stopped')
			}

			const delta = this.exposure.max - this.exposure.min

			// 1 ms
			if (delta < 1) {
				return this.handleFlatWizardEvent('IDLE', 'Unable to find an optimal exposure time')
			}

			await this.start()
		} else if (event.state === 'ERROR' || event.stopped) {
			this.stop()
		}
	}

	start() {
		this.request.capture.delay = 0
		this.request.capture.count = 1
		this.request.capture.autoSave = false
		this.request.capture.savePath = undefined
		this.request.capture.exposureTime = (this.exposure.min + this.exposure.max) / 2
		this.request.capture.exposureTimeUnit = 'MILLISECOND'
		this.request.capture.frameType = 'FLAT'
		this.request.capture.exposureMode = 'SINGLE'

		this.handleFlatWizardEvent('CAPTURING', `Exposure of ${this.request.capture.exposureTime.toFixed(0)} ms`)

		return this.flatWizardHandler.cameraHandler.start(this.camera, this.request.capture, this.cameraCaptured.bind(this))
	}

	stop() {
		if (!this.stopped) {
			this.stopped = true
			this.flatWizardHandler.cameraHandler.stop(this.camera)
			this.handleFlatWizardEvent('IDLE', 'Stopped')
		}
	}
}

export function flatWizard(flatWizardHandler: FlatWizardHandler): Endpoints {
	const { cameraHandler } = flatWizardHandler

	function cameraFromParams(req: Bun.BunRequest<string>) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	return {
		'/flatwizard/:camera/start': { POST: async (req) => response(flatWizardHandler.start(cameraFromParams(req), await req.json())) },
		'/flatwizard/:camera/stop': { POST: (req) => response(flatWizardHandler.stop(cameraFromParams(req))) },
	}
}
