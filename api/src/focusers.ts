import { FocuserCommander } from 'nebulosa/src/devices/commanders/focuser'
import { type ClientResolver, type CommandRequest, connectedDevice, notFound, findDevice, settle, startCommand, stateResponse, stopResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Focuser commands of every open connection, over the toolkit's FocuserCommander: a move to an absolute
// position or by a number of steps inward or outward (the commander translates the direction to the
// driver's convention and keeps the target inside the travel the driver publishes), a sync of the position
// counter, the reversal of the motion direction, and a stop. Moves run as focuser.move operations that
// resolve once the focuser reports standing at the target; the same commands serve a future auto focus.

// Direction of a relative move: towards the telescope (IN) or away from it (OUT), as the driver defines.
export type FocuserDirection = 'IN' | 'OUT'

// Body of POST /api/connections/:id/focusers/:deviceId/move-to.
export interface FocuserMoveToRequest extends CommandRequest {
	// Target position in steps.
	readonly position: number
}

// Body of POST /api/connections/:id/focusers/:deviceId/move.
export interface FocuserMoveRequest extends CommandRequest {
	// Direction of the move.
	readonly direction: FocuserDirection
	// Number of steps to move, positive.
	readonly steps: number
}

// Body of POST /api/connections/:id/focusers/:deviceId/sync.
export interface FocuserSyncRequest {
	// Position in steps the focuser is to report where it stands, without moving.
	readonly position: number
}

// Body of POST /api/connections/:id/focusers/:deviceId/reverse.
export interface FocuserReverseRequest {
	// Whether the motion direction is to be reversed.
	readonly enabled: boolean
}

// Focuser commands over the focusers of every open connection.
export class FocuserCommands implements Disposable {
	// Commander driving the focusers and observing their moves.
	readonly #commander: FocuserCommander

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every move.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new FocuserCommander(devices.focusers)
	}

	// Responds with the state of a focuser, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
	}

	// Starts a move to an absolute position. Responds 202 with the operation id; 404, 409 disconnected or
	// busy, 422 when the focuser has no absolute positioning.
	moveTo(connectionId: string, deviceId: string, request: FocuserMoveToRequest): Response {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canAbsoluteMove) return unsupported('The focuser cannot move to a position')
		return startCommand(this.operations, 'focuser.move', connectionId, focuser, request, () => this.#commander.moveTo(this.operations.coordinator, focuser, request.position))
	}

	// Starts a move by a number of steps inward or outward, through the absolute position when the focuser
	// has no relative positioning; answered like moveTo, with 422 when the
	// focuser has no relative positioning. A repeated request with the same token never moves it twice.
	move(connectionId: string, deviceId: string, request: FocuserMoveRequest): Response {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canRelativeMove && !focuser.canAbsoluteMove) return unsupported('The focuser cannot move by steps')
		const { coordinator } = this.operations
		const { direction, steps } = request

		return startCommand(this.operations, 'focuser.move', connectionId, focuser, request, () => {
			if (focuser.canRelativeMove) return direction === 'IN' ? this.#commander.moveIn(coordinator, focuser, steps) : this.#commander.moveOut(coordinator, focuser, steps)
			// A focuser with absolute positioning only is moved to the position the steps lead to; inward
			// decreases the reported position, the convention the commander applies to relative moves.
			return this.#commander.moveTo(coordinator, focuser, focuser.position.value + (direction === 'IN' ? -steps : steps))
		})
	}

	// Redefines the position counter without moving. Responds 204 once sent; 404, 409 disconnected or busy,
	// 422 when the focuser cannot sync.
	async sync(connectionId: string, deviceId: string, { position }: FocuserSyncRequest): Promise<Response> {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canSync) return unsupported('The focuser cannot sync its position')
		return await settle(this.#commander.syncTo(this.operations.coordinator, focuser, position), 'The sync')
	}

	// Reverses or restores the motion direction. Responds 204 once applied; 404, 409, 422 when the focuser
	// cannot reverse.
	async reverse(connectionId: string, deviceId: string, { enabled }: FocuserReverseRequest): Promise<Response> {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canReverse) return unsupported('The focuser cannot reverse its motion')
		return await settle(this.#commander.reverse(this.operations.coordinator, focuser, enabled), 'Reversing the motion')
	}

	// Cancels the move of a focuser and stops it. Responds 204 once it stands still, 404, and 409 when the
	// stop could not be confirmed.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const focuser = findDevice(this.devices, this.client, connectionId, 'focuser', deviceId)
		if (!focuser) return notFound('Focuser')
		return await stopResponse(this.operations, focuser, () => this.#commander.stopMotion(focuser))
	}

	// Stops observing the focusers; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}
