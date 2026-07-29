import { join } from 'path'
import { formatTemporal } from 'nebulosa/src/astronomy/time/temporal'
import type { Camera, MinMaxValueProperty } from 'nebulosa/src/devices/indi/device'
import { histogram } from 'nebulosa/src/imaging/processing/computation'
import { EventBus } from 'src/shared/bus'
import { DEFAULT_FLAT_WIZARD_EVENT } from '#/flatwizard'
import type { FlatWizardEvent, FlatWizardStart, FlatWizardState } from '#/flatwizard'
import { DEFAULT_IMAGE_TRANSFORMATION } from '#/image'
import type { ImageTransformation } from '#/image'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import type { CameraHandler } from './camera'
import { query, response } from './http'
import type { Endpoints } from './http'
import type { ImageProcessor } from './image'
import type { WebSocketMessageHandler } from './message'
import type { OperationContext, OperationCoordinator, OperationHandle } from './operation'
import { abortReason } from './operation.wait'
import { resourceKey } from './resource'

// Presentation events of the flat wizard, fanned out to WebSocket subscribers.
export interface FlatWizardBusEvents {
	// Progress or terminal snapshot of one run.
	readonly update: FlatWizardEvent
}

// Process-wide fanout of flat wizard presentation events.
export const flatWizardBus = new EventBus<FlatWizardBusEvents>()

// Flats are measured on the raw frame, so every transformation is disabled and the payload stays FITS.
const FLAT_WIZARD_IMAGE_TRANSFORMATION: ImageTransformation = { ...DEFAULT_IMAGE_TRANSFORMATION, enabled: false, format: { ...DEFAULT_IMAGE_TRANSFORMATION.format, type: 'fits' } }

// Renders the terminal cause of a run for the message its last event carries.
// The two causes that are not defects get a message of their own: a stop is what the user just asked for,
// and a refusal carries the arbiter's internal ids, which say nothing to whoever is looking at the screen.
function terminalMessage(reason: OperationFailureReason, error?: string) {
	if (reason === 'aborted') return 'stopped'
	if (reason === 'busy') return 'the camera is in use by another operation'
	if (error !== undefined) return error
	return `flat wizard failed: ${reason}`
}

// Runs flat wizard searches and exposes them to transport by request id.
export class FlatWizardHandler {
	// Live runs by request id, which is what a stop route names. This is the translation from a transport
	// id to an operation, the same role the session map has in the capturer — not an ownership index, since
	// who holds the camera is the arbiter's answer and a local copy would only go stale.
	readonly #runs = new Map<string, OperationHandle<string>>()

	// Registers the flat wizard transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly imageProcessor: ImageProcessor,
		readonly coordinator: OperationCoordinator,
	) {
		flatWizardBus.subscribe('update', (event) => wsm.send('flatwizard:update', event))
	}

	// Publishes one snapshot, copied so a later mutation cannot rewrite an event already sent.
	sendEvent(event: FlatWizardEvent) {
		flatWizardBus.emit('update', structuredClone(event))
	}

	// Starts one run, which owns the camera until it finds an exposure, gives up, or is stopped.
	//
	// Holding the camera across the whole search is the point: the bisection is a sequence of exposures
	// whose results only mean something together, and releasing it between two of them would let another
	// operation expose in the middle of a search that is still converging.
	start(camera: Camera, request: FlatWizardStart) {
		if (this.#runs.has(request.id)) return

		// The request is copied because the run normalizes it into a single flat exposure, and the caller's
		// object is not this feature's to rewrite.
		const run = new FlatWizardRun(camera, structuredClone(request), this)
		const handle = this.coordinator.start<string>('flatWizard', [{ key: resourceKey(camera), device: camera }], (context) => run.run(context))

		this.#runs.set(request.id, handle)

		// Every terminal path lands here, including a start the arbiter refused, which never runs the
		// executor at all. That is what makes a busy camera report itself instead of failing silently.
		void handle.result.then((result) => {
			if (this.#runs.get(request.id) === handle) this.#runs.delete(request.id)
			run.finish(result)
		})
	}

	// Cancels one run and waits for its cleanup; an unknown id is a no-op.
	async stop(id: string) {
		await this.#runs.get(id)?.cancel()
	}
}

// One exposure search: bisects the exposure interval until a frame's median lands inside the mean window.
class FlatWizardRun {
	// Presentation snapshot of this run, republished on every transition.
	readonly #event = structuredClone(DEFAULT_FLAT_WIZARD_EVENT)
	// Exposure interval still being searched, in milliseconds.
	readonly #exposure: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }
	// Accepted median window, normalized to [0, 1].
	readonly #mean: MinMaxValueProperty = { min: 0, max: 0, value: 0, step: 1 }

	// Binds a run to its camera, its own copy of the request, and the handler publishing its events.
	constructor(
		readonly camera: Camera,
		readonly request: FlatWizardStart,
		readonly handler: FlatWizardHandler,
	) {
		this.#event.id = request.id
		this.#event.camera = camera.id

		this.#exposure.min = Math.min(request.minExposure, request.maxExposure)
		this.#exposure.max = Math.max(request.minExposure, request.maxExposure)

		const meanTarget = request.meanTarget / 65535
		const meanTolerance = (meanTarget * request.meanTolerance) / 100
		this.#mean.min = meanTarget - meanTolerance
		this.#mean.max = meanTarget + meanTolerance
	}

	// Captures and measures until the median fits or the interval collapses, reporting the terminal message.
	async run(context: OperationContext): Promise<OperationResult<string>> {
		const { capture } = this.request

		while (true) {
			if (context.signal.aborted) return { ok: false, reason: abortReason(context.signal) }

			capture.delay = 0
			capture.count = 1
			capture.autoSave = false
			capture.savePath = undefined
			capture.exposureTime = (this.#exposure.min + this.#exposure.max) / 2
			capture.exposureTimeUnit = 'millisecond'
			capture.frameType = 'FLAT'
			capture.exposureMode = 'single'

			this.#publish('capturing', `exposure of ${capture.exposureTime.toFixed(0)} ms`)

			// The capture nests in this run, inheriting the camera it already holds instead of asking the
			// arbiter for a device its own parent owns.
			const handle = this.handler.cameraHandler.capture(context, this.camera, capture)
			const started = await handle.started

			// Both milestones are awaited: a capture that never began and one that began and then failed are
			// equally fatal to a search whose next step depends on this frame's median.
			if (!started.ok) return started

			const captured = await handle.result

			if (!captured.ok) return captured

			const path = captured.value.paths.at(-1)

			if (path === undefined) return { ok: false, reason: 'unexpectedState', error: 'the capture produced no frame' }

			this.#publish('computing', '')

			const transformed = await this.handler.imageProcessor.transform(path, false, this.camera.name)

			if (transformed === undefined) return { ok: false, reason: 'commandFailed', error: 'failed to load captured flat frame' }

			const { median } = histogram(transformed.image)
			this.#event.median = median

			if (median >= this.#mean.min && median <= this.#mean.max) {
				const extension = capture.transferFormat === 'XISF' ? 'xisf' : 'fit'
				const saveAt = join(this.request.path || Bun.env.capturesDir, `${formatTemporal(Date.now(), 'YYYYMMDD.HHmmssSSS')}.${extension}`)
				// The frame just captured is the source; the timestamped path is only where it goes.
				const exported = await this.handler.imageProcessor.export(path, FLAT_WIZARD_IMAGE_TRANSFORMATION, this.camera.name, saveAt)

				if (exported === undefined) return { ok: false, reason: 'commandFailed', error: 'failed to save flat frame' }

				return { ok: true, value: `saved at ${saveAt}` }
			}

			if (median < this.#mean.min) this.#exposure.min = capture.exposureTime
			else this.#exposure.max = capture.exposureTime

			// Below a millisecond the interval is finer than the exposure the camera can be asked for, so
			// bisecting further would keep requesting the same exposure forever.
			if (this.#exposure.max - this.#exposure.min < 1) return { ok: true, value: 'unable to find an optimal exposure time' }
		}
	}

	// Publishes the single idle event that ends this run, whatever terminated it.
	finish(result: OperationResult<string>) {
		this.#publish('idle', result.ok ? result.value : terminalMessage(result.reason, result.error))
	}

	// Publishes a transition, skipping one that would repeat the state and message already sent.
	#publish(state: FlatWizardState, message?: string) {
		if (state === this.#event.state && message === this.#event.message) return
		this.#event.state = state
		this.#event.message = message
		this.handler.sendEvent(this.#event)
	}
}

// Builds flat wizard HTTP routes over coordinated runs.
export function flatWizard(flatWizardHandler: FlatWizardHandler) {
	const { cameraHandler } = flatWizardHandler

	// Resolves the camera named by route params and optional client query.
	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	return {
		'/flatwizard/:camera/start': { POST: async (req) => response(flatWizardHandler.start(cameraFromParams(req), await req.json())) },
		'/flatwizard/:id/stop': { POST: async (req) => response(await flatWizardHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
