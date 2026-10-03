import type { Camera, Focuser } from 'nebulosa/src/devices/indi/device'
import { EventBus } from 'src/shared/bus'
import type { AutoFocusEvent, AutoFocusStart } from '#/autofocus'
import type { OperationFailureReason, OperationResult } from '#/orchestration'
import { AutoFocusRunner } from './autofocus.runner'
import type { AutoFocusRunOutcome } from './autofocus.runner'
import type { CameraHandler } from './camera'
import type { FocuserHandler } from './focuser'
import { query, response } from './http'
import type { Endpoints } from './http'
import type { WebSocketMessageHandler } from './message'
import type { OperationCoordinator, OperationHandle } from './operation'
import { resourceKey } from './resource'
import type { StarDetectionHandler } from './stardetection'

// Transport adapter of the autofocus: HTTP routes, the WebSocket fanout of its progress events, and the
// translation from an operation id to a live run. The search itself lives in AutoFocusRunner, which the
// sequencer starts from its own reserved scope without going through any of this.

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

// Exposes autofocus searches to transport, keyed by operation id.
export class AutoFocusHandler {
	// Live runs by operation id, which is what a stop route names. This is the translation from a transport
	// id to an operation, not an ownership index: who holds the camera and the focuser is the arbiter's
	// answer, and a local copy would only go stale.
	readonly #runs = new Map<string, OperationHandle<AutoFocusRunOutcome>>()
	// Domain runner of the searches this handler exposes, publishing through this handler's own fanout.
	readonly #runner: AutoFocusRunner

	// Registers the autofocus transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly cameraHandler: CameraHandler,
		readonly focuserHandler: FocuserHandler,
		readonly starDetectionHandler: StarDetectionHandler,
		readonly coordinator: OperationCoordinator,
	) {
		this.#runner = new AutoFocusRunner(cameraHandler, focuserHandler, starDetectionHandler, (event) => this.sendEvent(event))
		autoFocusBus.subscribe('update', (event) => wsm.send('autofocus:update', event))
	}

	// Runner behind the manual searches, handed to the sequencer so a session focuses through the same
	// V-curve search the route uses and publishes to the same fanout, under its own reserved scope.
	get runner() {
		return this.#runner
	}

	// Publishes one snapshot, copied so a later mutation cannot rewrite an event already sent.
	sendEvent(event: AutoFocusEvent) {
		autoFocusBus.emit('update', structuredClone(event))
	}

	// Starts one run as a root operation of the coordinator, which is what a manual request is.
	// Returns the operation id, which identifies the run in its events and is what stops it. A refused start
	// returns an id too: the run is already over, so stopping it is a no-op, and the refusal reaches the
	// caller through the terminal event rather than through this return.
	start(camera: Camera, focuser: Focuser, request: AutoFocusStart) {
		const { handle, finish } = this.#runner.start(this.coordinator, camera, focuser, request)

		this.#runs.set(handle.id, handle)

		// Every terminal path lands here, including a start the arbiter refused, which never runs the
		// executor at all. That is what makes a busy device report itself instead of failing silently.
		void handle.result.then((result) => {
			this.#runs.delete(handle.id)
			// Availability is read here rather than inside the run because a refused start never reaches the
			// executor, and that refusal is exactly the case the message has to explain.
			finish(handle.id, this.#terminalMessage(result, camera, focuser))
		})

		return handle.id
	}

	// Cancels one run by operation id and waits for its cleanup; an unknown id is a no-op.
	async stop(id: string) {
		await this.#runs.get(id)?.cancel()
	}

	// Renders what the terminal event of a run says, taking a successful search at its own word.
	#terminalMessage(result: OperationResult<AutoFocusRunOutcome>, camera: Camera, focuser: Focuser) {
		return result.ok ? result.value.message : terminalMessage(result.reason, result.error, this.#unavailableDevices(camera, focuser))
	}

	// Names the acquired devices the arbiter currently reports as unusable, in acquisition order.
	#unavailableDevices(camera: Camera, focuser: Focuser) {
		const names: string[] = []
		if (this.coordinator.arbiter.availability(resourceKey(camera)) === 'unavailable') names.push('camera')
		if (this.coordinator.arbiter.availability(resourceKey(focuser)) === 'unavailable') names.push('focuser')
		return names
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
