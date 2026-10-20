import { RotatorCommander } from 'nebulosa/src/devices/commanders/rotator'
import { type ClientResolver, type CommandRequest, connectedDevice, findDevice, notFound, settle, startCommand, stateResponse, stopResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Field rotator commands of every open connection, over the toolkit's RotatorCommander: a move to a
// mechanical angle or by an angle, a move home, a sync of the angle, the reversal of the rotation
// direction, and a stop. Angles are the rotator's mechanical angle in degrees, never a sky position angle.
// A target outside the range the driver publishes is resolved by the commander, which wraps it into one
// turn only where the range allows it and otherwise stops at the nearer limit. Moves run as rotator.move
// and rotator.home operations that resolve once the rotator reports standing at the target.

// Body of POST /api/connections/:id/rotators/:deviceId/move-to.
export interface RotatorMoveToRequest extends CommandRequest {
	// Target mechanical angle in degrees.
	readonly angle: number
}

// Body of POST /api/connections/:id/rotators/:deviceId/move-by.
export interface RotatorMoveByRequest extends CommandRequest {
	// Rotation in degrees from the angle reported when the command starts; positive increases the angle.
	readonly delta: number
}

// Body of POST /api/connections/:id/rotators/:deviceId/sync.
export interface RotatorSyncRequest {
	// Mechanical angle in degrees the rotator is to report where it stands, without moving.
	readonly angle: number
}

// Body of POST /api/connections/:id/rotators/:deviceId/reverse.
export interface RotatorReverseRequest {
	// Whether the rotation direction is to be reversed.
	readonly enabled: boolean
}

// Field rotator commands over the rotators of every open connection.
export class RotatorCommands implements Disposable {
	// Commander driving the rotators and observing their moves.
	readonly #commander: RotatorCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every move.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new RotatorCommander(devices.rotators)
	}

	// Responds with the state of a rotator, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
	}

	// Starts a move to a mechanical angle. Responds 202 with the operation id; 404, 409 disconnected or busy.
	moveTo(connectionId: string, deviceId: string, request: RotatorMoveToRequest): Response {
		const rotator = connectedDevice(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		return startCommand(this.operations, 'rotator.move', connectionId, rotator, request, () => this.#commander.moveTo(this.operations.coordinator, rotator, request.angle))
	}

	// Starts a move by an angle from where the rotator stands when the command starts; answered like
	// moveTo. A repeated request with the same token never rotates it twice.
	moveBy(connectionId: string, deviceId: string, request: RotatorMoveByRequest): Response {
		const rotator = connectedDevice(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		return startCommand(this.operations, 'rotator.move', connectionId, rotator, request, () => this.#commander.moveTo(this.operations.coordinator, rotator, rotator.angle.value + request.delta))
	}

	// Starts a move to the home position. Responds 202 with the operation id; 404, 409, 422 when the rotator
	// has no home.
	home(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const rotator = connectedDevice(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canHome) return unsupported('The rotator has no home position')
		return startCommand(this.operations, 'rotator.home', connectionId, rotator, request, () => this.#commander.home(this.operations.coordinator, rotator))
	}

	// Redefines the angle without moving. Responds 204 once sent; 404, 409, 422 when the rotator cannot sync.
	async sync(connectionId: string, deviceId: string, { angle }: RotatorSyncRequest): Promise<Response> {
		const rotator = connectedDevice(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canSync) return unsupported('The rotator cannot sync its angle')
		return await settle(this.#commander.syncTo(this.operations.coordinator, rotator, angle), 'The sync')
	}

	// Reverses or restores the rotation direction. Responds 204 once applied; 404, 409, 422 when the rotator
	// cannot reverse.
	async reverse(connectionId: string, deviceId: string, { enabled }: RotatorReverseRequest): Promise<Response> {
		const rotator = connectedDevice(this.devices, this.client, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canReverse) return unsupported('The rotator cannot reverse its rotation')
		return await settle(this.#commander.reverse(this.operations.coordinator, rotator, enabled), 'Reversing the rotation')
	}

	// Cancels the move of a rotator and stops it. Responds 204 once it stands still, 404, and 409 when the
	// stop could not be confirmed.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const rotator = findDevice(this.devices, this.client, connectionId, 'rotator', deviceId)
		if (!rotator) return notFound('Rotator')
		return await stopResponse(this.operations, rotator, () => this.#commander.stopMotion(rotator))
	}

	// Stops observing the rotators; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}
