import { medianOf, NumberComparator } from 'nebulosa/src/core/util'
import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { Regression } from 'nebulosa/src/math/numerical/regression'
import { AutoFocus } from 'nebulosa/src/observation/focus/autofocus'
import { DEFAULT_AUTO_FOCUS_EVENT } from '#/autofocus'
import type { AutoFocusEvent, AutoFocusStart, AutoFocusState } from '#/autofocus'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { CameraHandler } from './camera'
import type { FocuserHandler } from './focuser'
import { focuserPosition } from './focuser.commander'
import type { OperationContext, OperationHandle, OperationScope } from './operation'
import { abortReason } from './operation.wait'
import { resourceKey } from './resource'
import type { StarDetectionHandler } from './stardetection'

// Domain side of the autofocus: one V-curve search over a camera and a focuser, startable from any
// operation scope. The manual route starts it from the coordinator and the sequencer starts it from its
// own reserved scope, so the search never learns which of the two asked for it. Focuser positions are
// device steps and HFD is measured in pixels; the run reports what it found and never formats a message
// for a screen beyond the progress events it publishes.

// What a finished search found. The run ends successfully in all three outcomes because a curve that
// could not be fitted is the sky failing to answer, not a device failing to work.
export interface AutoFocusRunOutcome {
	// How the search ended: the curve was fitted, no frame carried a measurement, or the state machine
	// gave up and the focuser was put back where the run found it.
	readonly outcome: 'focused' | 'noStars' | 'gaveUp'
	// Position the focuser was left at, in device steps.
	readonly position: number
	// Fitted minimum of the curve, in device steps against HFD; absent unless the search converged.
	readonly focusPoint?: Point
	// Short description of the outcome, carried into the terminal presentation event.
	readonly message: string
}

// A started search: the operation to await or cancel, plus the terminal publication its caller owns.
export interface AutoFocusRunHandle {
	// Operation of the search, holding the camera and the focuser until it terminates.
	readonly handle: OperationHandle<AutoFocusRunOutcome>
	// Publishes the single idle event ending this run with the given message. It is called by whoever
	// resolved the terminal cause, because a start the arbiter refused never reaches the executor and only
	// the caller holding the arbiter can say which device was unusable.
	readonly finish: (id: string, message: string) => void
}

// Starts autofocus searches over a camera and a focuser from any operation scope.
export class AutoFocusRunner {
	// Binds the runner to the services a search needs and to the sink its progress events go to.
	constructor(
		readonly cameraHandler: CameraHandler,
		readonly focuserHandler: FocuserHandler,
		readonly starDetectionHandler: StarDetectionHandler,
		readonly onEvent?: (event: AutoFocusEvent) => void,
	) {}

	// Starts one search, which owns the camera and the focuser until the curve is fitted, the search gives
	// up, or it is cancelled.
	// Both devices are acquired for the whole run on purpose: the samples of a V-curve only mean something
	// together, so a capture or a focuser move interleaved by another operation would corrupt a search that
	// is still converging, and every position already sampled would be measured against a different focus.
	// Starting from a scope that already owns either device inherits it instead of asking for it again.
	start(scope: OperationScope, camera: Camera, focuser: Focuser, request: AutoFocusStart): AutoFocusRunHandle {
		// The request is copied because the run normalizes both the capture and the focus range, and the
		// caller's object is not this feature's to rewrite.
		const run = new AutoFocusRun(camera, focuser, structuredClone(request), this)
		const resources = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(focuser), device: focuser },
		]

		const handle = scope.start<AutoFocusRunOutcome>('autoFocus', resources, (context) => run.run(context))

		return { handle, finish: (id, message) => run.finish(id, message) }
	}
}

// One focus search: captures a frame per focuser position, measures its HFD, and follows the steps the
// autofocus state machine returns until the V-curve is fitted or it gives up.
class AutoFocusRun {
	// Presentation snapshot of this run, republished on every transition.
	readonly #event = structuredClone(DEFAULT_AUTO_FOCUS_EVENT)
	// Curve-fitting state machine deciding the next focuser position from each measured HFD.
	readonly #autoFocus: AutoFocus

	// Binds a run to its devices, its own copy of the request, and the runner publishing its events.
	constructor(
		readonly camera: Camera,
		readonly focuser: Focuser,
		readonly request: AutoFocusStart,
		readonly runner: AutoFocusRunner,
	) {
		// An unset upper bound means the whole travel of this focuser, which only the device knows.
		request.maxPosition ||= focuser.position.max
		this.#autoFocus = new AutoFocus(request)

		this.#event.camera = camera.id
		this.#event.focuser = focuser.id
	}

	// Captures, measures, and moves until the state machine terminates, reporting what the search found.
	async run(context: OperationContext): Promise<OperationResult<AutoFocusRunOutcome>> {
		// Every event of this run is keyed by the operation id, and the executor publishes the first one
		// before the caller ever sees the handle, so the id is bound here rather than after the start returns.
		this.#event.id = context.id

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
		// lands while the run is elsewhere. The commander is used directly because cancelling the run
		// cancels the operation that owns the focuser, which here is this run being cleaned up.
		context.onCleanup(async () => {
			if (this.focuser.connected && this.focuser.moving) await this.runner.focuserHandler.commander.stopMotion(this.focuser)
		})

		while (true) {
			if (context.signal.aborted) return failedOperationResult(abortReason(context.signal))

			this.#publish('capturing', '')

			// The capture nests in this run, inheriting the camera it already holds instead of asking the
			// arbiter for a device its own parent owns.
			const handle = this.runner.cameraHandler.capture(context, this.camera, capture)
			const started = await handle.started

			// Both milestones are awaited: a capture that never began and one that began and then failed are
			// equally fatal to a search whose next position depends on this frame's HFD.
			if (!started.ok) return started

			const captured = await handle.result

			if (!captured.ok) return captured

			const path = captured.value.paths.at(-1)

			if (path === undefined) return failedOperationResult('unexpectedState', 'the capture produced no frame')

			this.#publish('computing', '')

			const stars = await this.runner.starDetectionHandler.detect({ ...this.request.starDetection, path }, context.signal)

			if (context.signal.aborted) return failedOperationResult(abortReason(context.signal))

			// A frame with no stars carries no measurement, so the curve cannot be advanced. That is the
			// search failing to find focus rather than a device failing, which is why it ends successfully
			// with an explanation instead of as an operational failure.
			if (stars.length === 0) return successfulOperationResult(this.#outcome('noStars', 'no stars detected'))

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

				return successfulOperationResult(this.#outcome('focused', 'best focus!'))
			}

			// The state machine gave up and its step names the position the run started from, so the focuser
			// is put back where it was found before the run reports that it failed to focus.
			this.#publish('moving', `restoring to initial focus position ${position}`)

			const moved = await this.#moveTo(context, position)

			if (!moved.ok) return { ...moved, error: moved.error ?? `failed to restore focus position ${position}` }

			return successfulOperationResult(this.#outcome('gaveUp', 'restoring to initial focus position'))
		}
	}

	// Publishes the single idle event that ends this run, whatever terminated it. The id is taken from the
	// handle because a refused start never reaches the executor that would have bound it.
	finish(id: string, message: string) {
		this.#event.id = id
		this.#publish('idle', message)
	}

	// Builds the terminal outcome from the position the focuser was left at and the fitted curve.
	#outcome(outcome: AutoFocusRunOutcome['outcome'], message: string): AutoFocusRunOutcome {
		return { outcome, position: this.focuser.position.value, focusPoint: this.#autoFocus.focusPoint, message }
	}

	// Moves the focuser and waits for it to stop at the target. The move nests in this run, inheriting the
	// focuser it already holds and this run's own cancellation.
	#moveTo(context: OperationContext, position: number) {
		return this.runner.focuserHandler.commander.moveTo(context, this.focuser, position)
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
		this.runner.onEvent?.(this.#event)
	}
}
