import { medianOf, NumberComparator } from 'nebulosa/src/core/util'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { Regression } from 'nebulosa/src/math/numerical/regression'
import { AutoFocus } from 'nebulosa/src/observation/focus/autofocus'
import { EventBus } from 'src/shared/bus'
import { DEFAULT_AUTO_FOCUS_EVENT } from '#/autofocus'
import type { AutoFocusEvent, AutoFocusStart, AutoFocusState } from '#/autofocus'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import type { CameraHandler } from './camera'
import type { FocuserHandler } from './focuser'
import { focuserPosition } from './focuser.commander'
import { query, response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'
import type { OperationContext, OperationCoordinator, OperationHandle } from './operation'
import { abortReason } from './operation.wait'
import { resourceKey } from './resource'
import type { StarDetectionHandler } from './stardetection'

// Presentation events of the autofocus, fanned out to WebSocket subscribers.
export interface AutoFocusBusEvents {
	// Progress or terminal snapshot of one run.
	readonly update: AutoFocusEvent
}

// Process-wide fanout of autofocus presentation events.
export const autoFocusBus = new EventBus<AutoFocusBusEvents>()

// Renders the terminal cause of a run for the message its last event carries.
// A stop is what the user just asked for, so it says so. A refusal is reported without the detail the
// coordinator formats: that detail names resource keys and an operation id, which are stable enough for a
// log and meaningless on a screen. The coordinator also reports an active owner and an unusable device
// alike as busy, and only the arbiter separates them, so the devices it observed as unusable decide which
// of the two happened — a device someone else is using is a different problem from one that cannot be
// used at all.
function terminalMessage(reason: OperationFailureReason, error: string | undefined, unavailable: readonly string[]) {
	if (reason === 'aborted') return 'stopped'
	if (reason === 'busy') return unavailable.length > 0 ? `the ${unavailable.join(' and the ')} ${unavailable.length > 1 ? 'are' : 'is'} not available` : 'the camera or the focuser is in use by another operation'
	return error ?? `autofocus failed: ${reason}`
}

// Runs autofocus searches and exposes them to transport by request id.
export class AutoFocusHandler {
	// Live runs by request id, which is what a stop route names. This is the translation from a transport
	// id to an operation, not an ownership index: who holds the camera and the focuser is the arbiter's
	// answer, and a local copy would only go stale.
	readonly #runs = new Map<string, OperationHandle<string>>()

	// Registers the autofocus transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly focuserHandler: FocuserHandler,
		readonly starDetectionHandler: StarDetectionHandler,
		readonly coordinator: OperationCoordinator,
	) {
		autoFocusBus.subscribe('update', (event) => wsm.send('autofocus:update', event))
	}

	// Publishes one snapshot, copied so a later mutation cannot rewrite an event already sent.
	sendEvent(event: AutoFocusEvent) {
		autoFocusBus.emit('update', structuredClone(event))
	}

	// Starts one run, which owns the camera and the focuser until the curve is fitted, the search gives up,
	// or it is stopped.
	// Both devices are acquired for the whole run on purpose: the samples of a V-curve only mean something
	// together, so a capture or a focuser move interleaved by another operation would corrupt a search that
	// is still converging, and every position already sampled would be measured against a different focus.
	start(camera: Camera, focuser: Focuser, request: AutoFocusStart) {
		if (this.#runs.has(request.id)) return

		// The request is copied because the run normalizes both the capture and the focus range, and the
		// caller's object is not this feature's to rewrite.
		const run = new AutoFocusRun(camera, focuser, structuredClone(request), this)
		const resources = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(focuser), device: focuser },
		]
		const handle = this.coordinator.start<string>('autoFocus', resources, (context) => run.run(context))

		this.#runs.set(request.id, handle)

		// Every terminal path lands here, including a start the arbiter refused, which never runs the
		// executor at all. That is what makes a busy device report itself instead of failing silently.
		void handle.result.then((result) => {
			if (this.#runs.get(request.id) === handle) this.#runs.delete(request.id)
			// Availability is read here rather than inside the run because a refused start never reaches the
			// executor, and that refusal is exactly the case the message has to explain.
			run.finish(result, this.#unavailableDevices(camera, focuser))
		})
	}

	// Cancels one run and waits for its cleanup; an unknown id is a no-op.
	async stop(id: string) {
		await this.#runs.get(id)?.cancel()
	}

	// Names the acquired devices the arbiter currently reports as unusable, in acquisition order.
	#unavailableDevices(camera: Camera, focuser: Focuser) {
		const names: string[] = []
		if (this.coordinator.arbiter.availability(resourceKey(camera)) === 'unavailable') names.push('camera')
		if (this.coordinator.arbiter.availability(resourceKey(focuser)) === 'unavailable') names.push('focuser')
		return names
	}
}

// One focus search: captures a frame per focuser position, measures its HFD, and follows the steps the
// autofocus state machine returns until the V-curve is fitted or it gives up.
class AutoFocusRun {
	// Presentation snapshot of this run, republished on every transition.
	readonly #event = structuredClone(DEFAULT_AUTO_FOCUS_EVENT)
	// Curve-fitting state machine deciding the next focuser position from each measured HFD.
	readonly #autoFocus: AutoFocus

	// Binds a run to its devices, its own copy of the request, and the handler publishing its events.
	constructor(
		readonly camera: Camera,
		readonly focuser: Focuser,
		readonly request: AutoFocusStart,
		readonly handler: AutoFocusHandler,
	) {
		// An unset upper bound means the whole travel of this focuser, which only the device knows.
		request.maxPosition ||= focuser.position.max
		this.#autoFocus = new AutoFocus(request)

		this.#event.id = request.id
		this.#event.camera = camera.id
		this.#event.focuser = focuser.id
	}

	// Captures, measures, and moves until the state machine terminates, reporting the terminal message.
	async run(context: OperationContext): Promise<OperationResult<string>> {
		const { capture } = this.request

		capture.delay = 0
		capture.count = 1
		capture.autoSave = false
		capture.savePath = undefined
		capture.focuser = this.focuser.name
		capture.frameType = 'LIGHT'
		capture.exposureMode = 'single'

		// A focuser left moving under a released lease would keep changing a position the next owner
		// believes it commanded. A wait that fails stops it on its own, so this only covers a cancel that
		// lands while the run is elsewhere. The commander is used directly because the handler's stop
		// cancels the operation that owns the focuser, which here is this run being cleaned up.
		context.onCleanup(async () => {
			if (this.focuser.connected && this.focuser.moving) await this.handler.focuserHandler.commander.stopMotion(this.focuser)
		})

		while (true) {
			if (context.signal.aborted) return { ok: false, reason: abortReason(context.signal) }

			this.#publish('capturing', '')

			// The capture nests in this run, inheriting the camera it already holds instead of asking the
			// arbiter for a device its own parent owns.
			const handle = this.handler.cameraHandler.capture(context, this.camera, capture)
			const started = await handle.started

			// Both milestones are awaited: a capture that never began and one that began and then failed are
			// equally fatal to a search whose next position depends on this frame's HFD.
			if (!started.ok) return started

			const captured = await handle.result

			if (!captured.ok) return captured

			const path = captured.value.paths.at(-1)

			if (path === undefined) return { ok: false, reason: 'unexpectedState', error: 'the capture produced no frame' }

			this.#publish('computing', '')

			const stars = await this.handler.starDetectionHandler.detect({ ...this.request.starDetection, path }, context.signal)

			if (context.signal.aborted) return { ok: false, reason: abortReason(context.signal) }

			// A frame with no stars carries no measurement, so the curve cannot be advanced. That is the
			// search failing to find focus rather than a device failing, which is why it ends successfully
			// with an explanation instead of as an operational failure.
			if (stars.length === 0) return { ok: true, value: 'no stars detected' }

			// The median rejects the outliers a single misdetected star would otherwise contribute.
			const hfd = medianOf(stars.map((e) => e.hfd).sort(NumberComparator))
			const step = this.#autoFocus.add(this.focuser.position.value, hfd)

			this.#event.starCount = stars.length
			this.#event.hfd = hfd

			const position = this.#targetPosition(step.absolute ?? (step.relative === undefined ? 0 : this.focuser.position.value + step.relative))

			if (step.type === 'MOVE') {
				this.#computeChart()
				this.#publish('moving', `moving to position ${position}`)

				const moved = await this.#moveTo(context, position)

				if (!moved.ok) return { ...moved, error: moved.error ?? `failed to move to position ${position}` }

				continue
			}

			if (step.type === 'COMPLETED') {
				this.#computeChart()

				// The fitted focus point is where the curve says focus is; the focuser can only be sent to the
				// nearest step it actually has.
				const best = this.#targetPosition(this.#autoFocus.focusPoint!.x)
				this.#publish('moving', `moving to best focus at position ${best}`)

				const moved = await this.#moveTo(context, best)

				if (!moved.ok) return { ...moved, error: moved.error ?? `failed to move to best focus at position ${best}` }

				return { ok: true, value: 'best focus!' }
			}

			// The state machine gave up and its step names the position the run started from, so the focuser
			// is put back where it was found before the run reports that it failed to focus.
			this.#publish('moving', `restoring to initial focus position ${position}`)

			const moved = await this.#moveTo(context, position)

			if (!moved.ok) return { ...moved, error: moved.error ?? `failed to restore focus position ${position}` }

			return { ok: true, value: 'restoring to initial focus position' }
		}
	}

	// Publishes the single idle event that ends this run, whatever terminated it. The device names are
	// those the arbiter reported as unusable at that moment, and only a refused start reads them.
	finish(result: OperationResult<string>, unavailable: readonly string[]) {
		this.#publish('idle', result.ok ? result.value : terminalMessage(result.reason, result.error, unavailable))
	}

	// Moves the focuser and waits for it to stop at the target. The move nests in this run, inheriting the
	// focuser it already holds and this run's own cancellation.
	#moveTo(context: OperationContext, position: number) {
		return this.handler.focuserHandler.commander.moveTo(context, this.focuser, position)
	}

	// Resolves a computed target to the position the focuser will actually report back, which is what the
	// published message has to name. The fitted focus point is fractional, and the commander normalizes the
	// same way, so both agree on where the move ends.
	#targetPosition(position: number) {
		return focuserPosition(this.focuser, position)
	}

	// Snapshots the fitted curves into the presentation event so the chart follows the search.
	#computeChart() {
		const { trendLine, parabolic, hyperbolic, minimum, maximum, focusPoint } = this.#autoFocus

		this.#event.x = Array.from(trendLine?.xPoints ?? [])
		this.#event.y = Array.from(trendLine?.yPoints ?? [])
		this.#event.left = this.#makeChart(trendLine?.left)
		this.#event.right = this.#makeChart(trendLine?.right)
		this.#event.parabolic = this.#makeChart(parabolic)
		this.#event.hyperbolic = this.#makeChart(hyperbolic)
		this.#event.minimum = minimum
		this.#event.maximum = maximum
		this.#event.focusPoint = focusPoint
	}

	// Samples one regression over the measured position range, or nothing when it cannot be drawn yet.
	#makeChart(regression?: Regression) {
		if (!regression || regression.xPoints.length < 3) return undefined
		const { minimum, maximum } = this.#autoFocus
		if (minimum === undefined || maximum === undefined) return undefined

		const points = new Array<Point>(10)
		const stepSize = (maximum.x - minimum.x) / (points.length - 1)

		for (let i = 0, x = minimum.x; i < points.length; i++, x += stepSize) {
			points[i] = { x, y: regression.predict(x) }
		}

		return points
	}

	// Publishes a transition, skipping one that would repeat the state and message already sent.
	#publish(state: AutoFocusState, message?: string) {
		if (state === this.#event.state && message === this.#event.message) return
		this.#event.state = state
		this.#event.message = message
		this.handler.sendEvent(this.#event)
	}
}

// Builds autofocus HTTP routes over coordinated runs.
export function autoFocus(autoFocusHandler: AutoFocusHandler) {
	const { cameraHandler, focuserHandler } = autoFocusHandler

	// Resolves the camera named by route params and optional client query.
	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	// Resolves the focuser named by route params and optional client query.
	function focuserFromParams(req: Bun.BunRequest) {
		return focuserHandler.focuserManager.get(query(req).client, req.params.focuser)!
	}

	return {
		'/autofocus/:camera/:focuser/start': { POST: async (req) => response(autoFocusHandler.start(cameraFromParams(req), focuserFromParams(req), await req.json())) },
		'/autofocus/:id/stop': { POST: async (req) => response(await autoFocusHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
