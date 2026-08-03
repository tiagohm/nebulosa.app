import type { Camera, GuideDirection, Mount } from 'nebulosa/src/devices/indi/device'
import { EventBus } from 'src/shared/bus'
import { DEFAULT_DARV_EVENT } from '#/darv'
import type { DarvEvent, DarvStart, DarvState } from '#/darv'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import type { CameraHandler } from './camera'
import type { CameraCaptureHandle } from './camera.capture'
import type { GuideOutputHandler } from './guideoutput'
import { query, response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import type { OperationContext, OperationCoordinator, OperationHandle } from './operation'
import { abortableDelay } from './operation.wait'
import { resourceKey } from './resource'

// Presentation events of the DARV drift alignment, fanned out to WebSocket subscribers.
export interface DarvBusEvents {
	// Progress or terminal snapshot of one run.
	readonly update: DarvEvent
}

// Process-wide fanout of DARV presentation events.
export const darvBus = new EventBus<DarvBusEvents>()

// Seconds of exposure added to the requested trajectory, and the whole overhead a run is allowed to spend
// outside its own timers.
// None of the run's timers start where the shutter does: each leg pays command dispatch plus the time the
// driver takes to report the axis at a standstill, and an exposure sized exactly to `initialPause + duration`
// closes while the return leg is still being drawn. The extra seconds only prolong the vertex the trail
// already ends on, which costs nothing to the measurement made on the frame.
// This is a budget and not a guess: each leg is given what is left of it as its settle allowance, so a driver
// slower than the shutter ends the run instead of letting it report a truncated trail as a finished one.
const EXPOSURE_HEADROOM = 5

// Renders the terminal cause of a run for the message its last event carries.
// A stop is what the user just asked for, so it says so. A refusal is reported without the detail the
// coordinator formats, which names resource keys and an operation id: stable enough for a log and
// meaningless on a screen. The coordinator reports an active owner and an unusable device alike as busy,
// and only the arbiter separates them, so the devices it observed as unusable decide which of the two
// happened.
function terminalMessage(reason: OperationFailureReason, error: string | undefined, unavailable: readonly string[]) {
	if (reason === 'aborted') return 'stopped'
	if (reason === 'busy') return unavailable.length > 0 ? `the ${unavailable.join(' and the ')} ${unavailable.length > 1 ? 'are' : 'is'} not available` : 'the camera or the mount is in use by another operation'
	return error ?? `darv failed: ${reason}`
}

// Mirrors a capture failure as a run failure, and never settles while the exposure is healthy.
// It is meant to be raced against each phase of the run, which is why a successful capture leaves it
// pending: the frame arriving early is not a reason to stop drawing the trail into it.
function captureFailure(handle: CameraCaptureHandle): Promise<OperationResult<void>> {
	return new Promise((resolve) => {
		void handle.result.then((result) => {
			if (!result.ok) resolve(result)
		})
	})
}

// Runs DARV drift alignment sessions and exposes them to transport by operation id.
export class DarvHandler {
	// Live runs by operation id, which is what a stop route names. This is the translation from a transport
	// id to an operation, not an ownership index: who holds the camera and the mount is the arbiter's
	// answer, and a local copy would only go stale.
	readonly #runs = new Map<string, OperationHandle<void>>()

	// Registers the DARV transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly guideOutputHandler: GuideOutputHandler,
		readonly coordinator: OperationCoordinator,
	) {
		darvBus.subscribe('update', (event) => wsm.send('darv:update', event))
	}

	// Publishes one snapshot, copied so a later mutation cannot rewrite an event already sent.
	sendEvent(event: DarvEvent) {
		darvBus.emit('update', structuredClone(event))
	}

	// Starts one run, which owns the camera and the mount until the star trail is exposed or it is stopped.
	// The mount is acquired as the physical device providing the guide output the pulses are sent to, which
	// is the same resource under either name, so nothing else can slew it while the trail is being drawn.
	// The duplicate-device guard the task list used to apply is gone with it: a second run over the same
	// camera or mount is now refused by the arbiter.
	// Returns the operation id, which identifies the run in its events and is what stops it. A refused start
	// returns an id too: the run is already over, so stopping it is a no-op, and the refusal reaches the
	// caller through the terminal event rather than through this return.
	start(request: DarvStart, camera: Camera, mount: Mount) {
		// The request is copied because the run normalizes the capture, and the caller's object is not this
		// feature's to rewrite.
		const run = new DarvRun(camera, mount, structuredClone(request), this)
		const resources = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(mount), device: mount },
		]
		const handle = this.coordinator.start<void>('darv', resources, (context) => run.run(context))

		this.#runs.set(handle.id, handle)

		// Every terminal path lands here, including a start the arbiter refused, which never runs the
		// executor at all. That is what makes a busy device report itself instead of failing silently.
		void handle.result.then((result) => {
			this.#runs.delete(handle.id)
			// Availability is read here rather than inside the run because a refused start never reaches the
			// executor, and that refusal is exactly the case the message has to explain.
			run.finish(handle.id, result, this.#unavailableDevices(camera, mount))
		})

		return handle.id
	}

	// Cancels one run by operation id and waits for its cleanup; an unknown id is a no-op.
	async stop(id: string) {
		await this.#runs.get(id)?.cancel()
	}

	// Names the acquired devices the arbiter currently reports as unusable, in acquisition order.
	#unavailableDevices(camera: Camera, mount: Mount) {
		const names: string[] = []
		if (this.coordinator.arbiter.availability(resourceKey(camera)) === 'unavailable') names.push('camera')
		if (this.coordinator.arbiter.availability(resourceKey(mount)) === 'unavailable') names.push('mount')
		return names
	}
}

// One DARV session: exposes a single frame while pulse-guiding the mount away from and back to its
// starting point, so the frame records a V-shaped star trail whose opening reveals the polar misalignment.
class DarvRun {
	// Presentation snapshot of this run, republished on every transition.
	readonly #event = structuredClone(DEFAULT_DARV_EVENT)

	// Monotonic milliseconds at which the shutter closes, set once the exposure is confirmed. Every phase
	// measures its own allowance against it, which is what keeps the trail inside the frame recording it.
	#deadline = 0

	// Binds a run to its devices, its own copy of the request, and the handler publishing its events.
	constructor(
		readonly camera: Camera,
		readonly mount: Mount,
		readonly request: DarvStart,
		readonly handler: DarvHandler,
	) {
		this.#event.camera = camera.id
		this.#event.mount = mount.id
	}

	// Exposes one frame and draws the trail into it, pulsing only once the exposure has really begun.
	async run(context: OperationContext): Promise<OperationResult<void>> {
		// Every event of this run is keyed by the operation id, and the executor publishes the first one
		// before the caller ever sees the handle, so the id is bound here rather than after the start returns.
		this.#event.id = context.id

		const { capture } = this.request

		capture.autoSave = false
		capture.count = 1
		capture.delay = 0
		capture.frameType = 'LIGHT'
		capture.exposureMode = 'single'
		capture.mount = this.mount.name
		// The whole sensor is exposed: the trail is measured on the frame, and a subframe left over from a
		// previous capture would crop it for no reason.
		capture.x = 0
		capture.y = 0
		capture.width = this.camera.frame.width.max
		capture.height = this.camera.frame.height.max
		// The exposure has to outlast both legs and the pause before them, rounded up because the driver takes
		// whole seconds here, plus the headroom the trajectory spends outside its own timers.
		capture.exposureTime = Math.ceil(Math.max(0, this.request.duration + this.request.initialPause)) + EXPOSURE_HEADROOM
		capture.exposureTimeUnit = 'second'

		// The capture nests in this run, inheriting the camera it already holds instead of asking the
		// arbiter for a device its own parent owns.
		const handle = this.handler.cameraHandler.capture(context, this.camera, capture)
		const started = await handle.started

		// Nothing moves before the camera confirms it is exposing: a trail drawn while the sensor is still
		// idle is simply not recorded, and the frame would show a single point.
		if (!started.ok) return started

		// The shutter is open from here, so this is where the exposure the whole trajectory has to fit inside
		// starts being counted. Measuring from the acknowledgement is optimistic by the round trip that
		// delivered it, which is negligible against the headroom the budget carries.
		this.#deadline = performance.now() + capture.exposureTime * 1000

		// An exposure that dies mid-run cannot be salvaged: the trail is being drawn into a frame that no
		// longer exists. Every phase races this so the run ends at the failure instead of pulsing the mount
		// for the rest of the session, and the phase it abandons is a child of this run, so returning here
		// cancels and unwinds it before the devices are released.
		const failed = captureFailure(handle)

		this.#publish('waiting')

		// The initial pause is what leaves the bright vertex at the start of the trail.
		const paused = await Promise.race([abortableDelay(this.#initialPause, context.signal), failed])

		if (!paused.ok) return paused

		// Each leg draws one arm of the V, so together they take the requested duration.
		const legDuration = this.#duration / 2

		this.#publish('forwarding')

		const forward = await Promise.race([this.#pulse(context, false, legDuration, legDuration), failed])

		if (!forward.ok) return forward

		this.#publish('backwarding')

		const backward = await Promise.race([this.#pulse(context, true, legDuration, 0), failed])

		if (!backward.ok) return backward

		// The exposure runs slightly past the second leg because it was rounded up to whole seconds, and the
		// frame is the only product of the run, so it is awaited instead of being cancelled at the vertex.
		const captured = await handle.result

		return captured.ok ? successfulOperationResult(undefined) : captured
	}

	// Publishes the single idle event that ends this run, whatever terminated it. The device names are
	// those the arbiter reported as unusable at that moment, and only a refused start reads them. The id is
	// taken from the handle because a refused start never reaches the executor that would have bound it.
	finish(id: string, result: OperationResult<void>, unavailable: readonly string[]) {
		this.#event.id = id
		this.#publish('idle', result.ok ? undefined : terminalMessage(result.reason, result.error, unavailable))
	}

	// Milliseconds of exposure before the first leg starts.
	get #initialPause() {
		return Math.max(0, this.request.initialPause) * 1000
	}

	// Milliseconds spent drawing both arms of the trail.
	get #duration() {
		return Math.max(0, this.request.duration) * 1000
	}

	// Pulse-guides one leg in right ascension and resolves after it has run for its whole duration.
	// The pulse nests in this run, so the mount it already holds is inherited, and its own cleanup stops
	// the axis before the run releases the device. Which direction opens the trail depends on the
	// hemisphere, and the return leg is always the opposite of the one that went out.
	// `duration` is this leg in milliseconds and `remaining` the milliseconds of trajectory still owed after
	// it, both measured against the shutter: what is left of the exposure once those two are subtracted is
	// all the settle latency this leg may spend, and the commander is told so instead of falling back to its
	// own allowance. A leg that starts with no slack left cannot finish inside the frame, so the run ends on
	// a timeout rather than drawing a trail the exposure will cut in half.
	async #pulse(context: OperationContext, reversed: boolean, duration: number, remaining: number): Promise<OperationResult<void>> {
		const settleTimeout = this.#deadline - performance.now() - duration - remaining

		if (settleTimeout <= 0) return failedOperationResult('timeout', 'the exposure ends before the trail can be finished')

		const direction: GuideDirection = (this.request.hemisphere === 'northern') === reversed ? 'EAST' : 'WEST'

		return await this.handler.guideOutputHandler.commander.pulse(context, this.mount, direction, duration, { settleTimeout })
	}

	// Publishes a transition, skipping one that would repeat the state and message already sent.
	#publish(state: DarvState, message?: string) {
		if (state === this.#event.state && message === this.#event.message) return
		this.#event.state = state
		this.#event.message = message
		this.handler.sendEvent(this.#event)
	}
}

// Builds DARV HTTP routes over coordinated runs.
export function darv(darvHandler: DarvHandler) {
	const { cameraHandler, mountHandler } = darvHandler

	// Resolves the camera named by route params and optional client query.
	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	// Resolves the mount named by route params and optional client query.
	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/darv/:camera/:mount/start': { POST: async (req) => response(darvHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/darv/:id/stop': { POST: async (req) => response(await darvHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
