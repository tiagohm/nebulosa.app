import { WheelCommander } from 'nebulosa/src/devices/commanders/wheel'
import { type ClientResolver, type CommandRequest, connectedDevice, errorResponse, settle, startCommand, stateResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Filter wheel commands of every open connection, over the toolkit's WheelCommander: a change of slot and
// the renaming of the slots. Slots are 0-based, as the device model publishes them; the INDI 1-based
// numbering stays inside the toolkit, and the page shows slot numbers from 1. A change runs as a
// wheel.move operation that resolves once the wheel reports standing at the slot. A wheel has no abort, so
// a change is never interrupted, only waited for.

// Body of POST /api/connections/:id/wheels/:deviceId/move.
export interface WheelMoveRequest extends CommandRequest {
	// Slot to move to, 0-based.
	readonly slot: number
}

// Body of POST /api/connections/:id/wheels/:deviceId/names.
export interface WheelNamesRequest {
	// Filter names in slot order.
	readonly names: readonly string[]
}

// Filter wheel commands over the wheels of every open connection.
export class WheelCommands implements Disposable {
	// Commander driving the wheels and observing their moves.
	readonly #commander: WheelCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every move.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new WheelCommander(devices.wheels)
	}

	// Responds with the state of a filter wheel, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'wheel', deviceId, 'Filter wheel')
	}

	// Starts a change to a slot. Responds 202 with the operation id; 404, 409 disconnected or busy, 422 for
	// a slot the wheel does not have.
	move(connectionId: string, deviceId: string, request: WheelMoveRequest): Response {
		const wheel = connectedDevice(this.devices, this.client, connectionId, 'wheel', deviceId, 'Filter wheel')
		if (wheel instanceof Response) return wheel
		if (!(Number.isInteger(request.slot) && request.slot >= 0 && request.slot < wheel.count)) return errorResponse('The wheel has no such slot', 422, 'invalidParameter')
		return startCommand(this.operations, 'wheel.move', connectionId, wheel, request, () => this.#commander.moveTo(this.operations.coordinator, wheel, request.slot))
	}

	// Renames the slots. Responds 204 once sent (the new names arrive as a wheel:updated event); 404, 409
	// disconnected or busy, 422 when the wheel cannot rename its slots.
	async setNames(connectionId: string, deviceId: string, { names }: WheelNamesRequest): Promise<Response> {
		const wheel = connectedDevice(this.devices, this.client, connectionId, 'wheel', deviceId, 'Filter wheel')
		if (wheel instanceof Response) return wheel
		if (!wheel.canSetNames) return unsupported('The wheel cannot rename its slots')
		return await settle(this.#commander.setNames(this.operations.coordinator, wheel, names), 'Renaming the slots')
	}

	// Stops observing the wheels; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}
