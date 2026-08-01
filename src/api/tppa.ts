import { timeNow } from 'nebulosa/src/astronomy/time/time'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { ThreePointPolarAlignment } from 'nebulosa/src/observation/alignment/polaralignment'
import { EventBus } from 'src/shared/bus'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import { DEFAULT_TPPA_EVENT } from '#/tppa'
import type { TppaEvent, TppaStart, TppaState } from '#/tppa'
import type { CameraHandler } from './camera'
import { query, response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'
import type { MountHandler } from './mount'
import type { OperationContext, OperationCoordinator, OperationHandle } from './operation'
import { abortableDelay, abortReason } from './operation.wait'
import type { PlateSolverHandler } from './platesolver'
import { resourceKey } from './resource'

// Presentation events of the three-point polar alignment, fanned out to WebSocket subscribers.
export interface TppaBusEvents {
	// Progress or terminal snapshot of one run.
	readonly update: TppaEvent
}

// Process-wide fanout of polar alignment presentation events.
export const tppaBus = new EventBus<TppaBusEvents>()

// Number of plate-solved points the alignment needs before it can report an error, and therefore the
// number of mount movements a run performs.
const ALIGNMENT_POINTS = 3

// Milliseconds waited after each movement so the mount stops oscillating before the next exposure.
const SETTLE_DURATION = 2500

// Search radius in degrees around the coordinate the mount reports, used by every non-blind solve.
const SOLVER_RADIUS = 8

// Reference ellipsoid index the alignment uses for the observing site; 3 is WGS84.
const SITE_ELLIPSOID = 3

// Renders the terminal cause of a run for the message its last event carries.
//
// A stop is what the user just asked for, so it says so. A refusal is reported without the detail the
// coordinator formats, which names resource keys and an operation id: stable enough for a log and
// meaningless on a screen. The coordinator reports an active owner and an unusable device alike as busy,
// and only the arbiter separates them, so the devices it observed as unusable decide which of the two
// happened.
function terminalMessage(reason: OperationFailureReason, error: string | undefined, unavailable: readonly string[]) {
	if (reason === 'aborted') return 'stopped'
	if (reason === 'busy') return unavailable.length > 0 ? `the ${unavailable.join(' and the ')} ${unavailable.length > 1 ? 'are' : 'is'} not available` : 'the camera or the mount is in use by another operation'
	return error ?? `tppa failed: ${reason}`
}

// Runs polar alignment sessions and exposes them to transport by request id.
export class TppaHandler {
	// Live runs by request id, which is what a stop route names. This is the translation from a transport
	// id to an operation, not an ownership index: who holds the camera and the mount is the arbiter's
	// answer, and a local copy would only go stale.
	readonly #runs = new Map<string, OperationHandle<string>>()

	// Registers the polar alignment transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly mountHandler: MountHandler,
		readonly solver: PlateSolverHandler,
		readonly coordinator: OperationCoordinator,
	) {
		tppaBus.subscribe('update', (event) => wsm.send('tppa:update', event))
	}

	// Publishes one snapshot, copied so a later mutation cannot rewrite an event already sent.
	sendEvent(event: TppaEvent) {
		tppaBus.emit('update', structuredClone(event))
	}

	// Starts one run, which owns the camera and the mount until the alignment error is known, the session
	// gives up, or it is stopped.
	//
	// Both devices are acquired for the whole run on purpose: the three points only mean something as a
	// sequence, so a slew or a capture interleaved by another operation would measure a geometry that no
	// longer matches the points already collected. The duplicate-device guard the task list used to apply is
	// gone with it: a second run over the same camera or mount is now refused by the arbiter.
	start(request: TppaStart, camera: Camera, mount: Mount) {
		if (this.#runs.has(request.id)) return

		// The request is copied because the run normalizes the capture, and the caller's object is not this
		// feature's to rewrite.
		const run = new TppaRun(camera, mount, structuredClone(request), this)
		const resources = [
			{ key: resourceKey(camera), device: camera },
			{ key: resourceKey(mount), device: mount },
		]
		const handle = this.coordinator.start<string>('tppa', resources, (context) => run.run(context))

		this.#runs.set(request.id, handle)

		// Every terminal path lands here, including a start the arbiter refused, which never runs the
		// executor at all. That is what makes a busy device report itself instead of failing silently.
		void handle.result.then((result) => {
			if (this.#runs.get(request.id) === handle) this.#runs.delete(request.id)
			// Availability is read here rather than inside the run because a refused start never reaches the
			// executor, and that refusal is exactly the case the message has to explain.
			run.finish(result, this.#unavailableDevices(camera, mount))
		})
	}

	// Cancels one run and waits for its cleanup; an unknown id is a no-op.
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

// One polar alignment session: captures a frame, plate solves it, feeds the solution to the three-point
// alignment, and moves the mount in right ascension between the first points until the error is known.
class TppaRun {
	// Presentation snapshot of this run, republished on every transition.
	readonly #event = structuredClone(DEFAULT_TPPA_EVENT)
	// Alignment state machine turning three solved points into an azimuth/altitude error.
	readonly #polarAlignment: ThreePointPolarAlignment

	// Binds a run to its devices, its own copy of the request, and the handler publishing its events.
	constructor(
		readonly camera: Camera,
		readonly mount: Mount,
		readonly request: TppaStart,
		readonly handler: TppaHandler,
	) {
		this.#polarAlignment = new ThreePointPolarAlignment(request.compensateRefraction && request.refraction)

		this.#event.id = request.id
		this.#event.camera = camera.id
		this.#event.mount = mount.id
	}

	// Captures, solves, aligns, and moves until the alignment concludes or the run is stopped.
	async run(context: OperationContext): Promise<OperationResult<string>> {
		const { capture } = this.request

		capture.autoSave = false
		capture.count = 1
		capture.delay = 0
		capture.savePath = undefined
		capture.frameType = 'LIGHT'
		capture.exposureMode = 'single'
		capture.mount = this.mount.name
		// The whole sensor is exposed: the solver needs the widest field it can get, and a subframe left over
		// from a previous capture would shrink it for no reason.
		capture.x = 0
		capture.y = 0
		capture.width = this.camera.frame.width.max
		capture.height = this.camera.frame.height.max

		// Sidereal tracking has to be running: the points are compared against where the sky moved to, so a
		// mount standing still would report drift as a polar error. A driver without a tracking switch is left
		// as it is, since it either tracks on its own or cannot be aligned this way at all.
		if (this.mount.canTracking) {
			const tracking = await this.handler.mountHandler.commander.setTracking(context, this.mount, true)

			if (!tracking.ok) return tracking
		}

		while (true) {
			if (context.signal.aborted) return { ok: false, reason: abortReason(context.signal) }

			this.#event.count++
			this.#publish('capturing')

			// The capture nests in this run, inheriting the camera it already holds instead of asking the
			// arbiter for a device its own parent owns.
			const handle = this.handler.cameraHandler.capture(context, this.camera, capture)
			const started = await handle.started

			// Both milestones are awaited: a capture that never began and one that began and then failed are
			// equally fatal to a point the alignment cannot do without.
			if (!started.ok) return started

			const captured = await handle.result

			if (!captured.ok) return captured

			const path = captured.value.paths.at(-1)

			if (path === undefined) return { ok: false, reason: 'unexpectedState', error: 'the capture produced no frame' }

			this.#publish('solving')

			// The solver is bound to this run, so cancelling the operation stops the solve in flight.
			const solution = await this.handler.solver.start({ ...this.request.solver, ...this.mount.equatorialCoordinate, radius: SOLVER_RADIUS, path, id: this.request.id, blind: false }, context.signal)

			if (context.signal.aborted) return { ok: false, reason: abortReason(context.signal) }

			if (solution) {
				this.#event.attempts = 0
				this.#event.solved = true
				this.#event.solver.rightAscension = solution.rightAscension
				this.#event.solver.declination = solution.declination
				this.#publish('aligning')

				// The alignment needs the site the mount itself reports, since the error it computes is the one
				// of that mount's polar axis at that place.
				const time = timeNow(true)
				time.location = { ...this.mount.geographicCoordinate, ellipsoid: SITE_ELLIPSOID }

				const result = this.#polarAlignment.add(solution.rightAscension, solution.declination, time)

				this.#event.aligned = result !== false

				if (result) {
					this.#event.attempts = 0
					this.#event.error.azimuth = result.azimuthError
					this.#event.error.altitude = result.altitudeError
				} else if (this.#event.step >= ALIGNMENT_POINTS) {
					// Every point was collected and the geometry still yields nothing, which is the alignment
					// failing rather than a device failing, so it ends successfully with an explanation.
					return { ok: true, value: 'alignment failed' }
				}
			} else if (++this.#event.attempts < this.request.maxAttempts) {
				// A frame that did not solve costs an attempt and nothing else: the mount stays where it is and
				// the same point is exposed again.
				this.#event.solved = false
				continue
			} else {
				this.#event.solved = false
				return { ok: true, value: 'solving failed' }
			}

			this.#event.step++

			if (this.#event.step < ALIGNMENT_POINTS) {
				this.#publish('moving')

				const moved = await this.#move(context)

				if (!moved.ok) return moved

				this.#publish('settling')

				const settled = await abortableDelay(SETTLE_DURATION, context.signal)

				if (!settled.ok) return settled
			} else if (this.#delayBeforeCapture > 0) {
				// The points are collected; from here the run keeps refining the error, at the pace the request
				// asked for, until it is stopped.
				this.#publish('waiting')

				const waited = await abortableDelay(this.#delayBeforeCapture, context.signal)

				if (!waited.ok) return waited
			}
		}
	}

	// Publishes the single idle event that ends this run, whatever terminated it. The device names are
	// those the arbiter reported as unusable at that moment, and only a refused start reads them.
	finish(result: OperationResult<string>, unavailable: readonly string[]) {
		this.#publish('idle', result.ok ? result.value : terminalMessage(result.reason, result.error, unavailable))
	}

	// Milliseconds of open-ended motion between two alignment points, at least one second.
	get #moveDuration() {
		return Math.max(1, this.request.moveDuration) * 1000
	}

	// Milliseconds waited between two refinement exposures once the three points are collected.
	get #delayBeforeCapture() {
		return Math.max(0, this.request.delayBeforeCapture) * 1000
	}

	// Moves the mount in right ascension for the configured duration and waits for it to stop.
	//
	// The motion nests in this run, so the mount it already holds is inherited, and the handle keeps that
	// nested scope open for as long as an axis is moving. Cancelling the run therefore stops the axis
	// through the motion's own cleanup, which leaves tracking alone, instead of aborting the mount outright.
	async #move(context: OperationContext): Promise<OperationResult<void>> {
		const started = await this.handler.mountHandler.commander.startManualMove(context, this.mount, this.request.direction === 'east' ? 'EAST' : 'WEST')

		if (!started.ok) return started

		const moved = await abortableDelay(this.#moveDuration, context.signal)
		const stopped = await started.value.stop()

		// The axis is stopped whatever ended the wait, but an aborted wait is what the caller has to hear
		// about, so the stop only decides the outcome when the motion ran to its end.
		return moved.ok ? stopped : moved
	}

	// Publishes a transition, skipping one that would repeat the state and message already sent.
	#publish(state: TppaState, message?: string) {
		if (state === this.#event.state && message === this.#event.message) return
		this.#event.state = state
		this.#event.message = message
		this.handler.sendEvent(this.#event)
	}
}

// Builds polar alignment HTTP routes over coordinated runs.
export function tppa(tppaHandler: TppaHandler) {
	const { cameraHandler, mountHandler } = tppaHandler

	// Resolves the camera named by route params and optional client query.
	function cameraFromParams(req: Bun.BunRequest) {
		return cameraHandler.cameraManager.get(query(req).client, req.params.camera)!
	}

	// Resolves the mount named by route params and optional client query.
	function mountFromParams(req: Bun.BunRequest) {
		return mountHandler.mountManager.get(query(req).client, req.params.mount)!
	}

	return {
		'/tppa/:camera/:mount/start': { POST: async (req) => response(tppaHandler.start(await req.json(), cameraFromParams(req), mountFromParams(req))) },
		'/tppa/:id/stop': { POST: async (req) => response(await tppaHandler.stop(req.params.id)) },
	} as const satisfies Endpoints
}
