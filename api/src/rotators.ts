import { RotatorCommander } from 'nebulosa/src/devices/commanders/rotator'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { type ClientResolver, type CommandRequest, connectedDevice, findDevice, notFound, settle, startCommand, stateResponse, stopResponse, unsupported, repeatedResponse } from './commands'
import type { DeviceRegistry } from './devices'
import type { OperationRegistry } from './operations'

// Field rotator commands of every open connection, over the toolkit's RotatorCommander: a move to a
// mechanical angle or by an angle, a move home, a sync of the angle, the reversal of the rotation
// direction, and a stop. Angles are the rotator's mechanical angle in degrees, never a sky position angle.
// A target outside the range the driver publishes is resolved by the commander, which wraps it into one
// turn only where the range allows it and otherwise stops at the nearer limit. Moves run as rotator.move
// and rotator.home operations that resolve once the rotator reports standing at the target. The commander
// is shared with the services that turn a rotator inside their own operations (Target Centering), and every
// sync made here is remembered, in memory, so an angle recorded before it can still be compared with one
// read after it (scaledAngle).

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
	// Sum of the syncs made through these commands since the server started, by resource key of the rotator: each
	// sync adds the angle reported before it minus the angle reported after it, in degrees.
	readonly #syncOffsets = new Map<string, number>()

	// Creates the commands over the device registry; client resolves an open connection id to its client and
	// operations runs and publishes every move.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
	) {
		this.#commander = new RotatorCommander(devices.rotators)
	}

	// Commander of the rotators, for a service that turns one inside an operation of its own.
	get commander() {
		return this.#commander
	}

	// Returns the mechanical angle of a rotator, in degrees, on a scale no sync made through these commands moved: the
	// angle it reports plus the syncs made since the server started. An angle recorded before a sync compares with one
	// read after it; a sync made elsewhere (the driver's own interface) or before a restart is not seen.
	scaledAngle(rotator: Rotator) {
		return rotator.angle.value + (this.#syncOffsets.get(resourceKey(rotator)) ?? 0)
	}

	// Responds with the state of a rotator, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this, connectionId, 'rotator', deviceId, 'Rotator')
	}

	// Starts a move to a mechanical angle. Responds 202 with the operation id; 404, 409 disconnected or busy.
	moveTo(connectionId: string, deviceId: string, request: RotatorMoveToRequest): Response {
		const repeated = repeatedResponse(this.operations, request)
		if (repeated) return repeated
		const rotator = connectedDevice(this, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		return startCommand(this.operations, 'rotator.move', connectionId, rotator, request, () => this.#commander.moveTo(this.operations.coordinator, rotator, request.angle))
	}

	// Starts a move by an angle from where the rotator stands when the command starts; answered like
	// moveTo. A repeated request with the same token never rotates it twice.
	moveBy(connectionId: string, deviceId: string, request: RotatorMoveByRequest): Response {
		const repeated = repeatedResponse(this.operations, request)
		if (repeated) return repeated
		const rotator = connectedDevice(this, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		return startCommand(this.operations, 'rotator.move', connectionId, rotator, request, () => this.#commander.moveTo(this.operations.coordinator, rotator, rotator.angle.value + request.delta))
	}

	// Starts a move to the home position. Responds 202 with the operation id; 404, 409, 422 when the rotator
	// has no home.
	home(connectionId: string, deviceId: string, request: CommandRequest): Response {
		const repeated = repeatedResponse(this.operations, request)
		if (repeated) return repeated
		const rotator = connectedDevice(this, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canHome) return unsupported('The rotator has no home position')
		return startCommand(this.operations, 'rotator.home', connectionId, rotator, request, () => this.#commander.home(this.operations.coordinator, rotator))
	}

	// Redefines the angle without moving. Responds 204 once the driver reports it, 504 when it never does; 404, 409, 422 when the rotator cannot sync.
	async sync(connectionId: string, deviceId: string, { angle }: RotatorSyncRequest): Promise<Response> {
		const rotator = connectedDevice(this, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canSync) return unsupported('The rotator cannot sync its angle')
		const before = rotator.angle.value
		const synced = await this.#commander.syncTo(this.operations.coordinator, rotator, angle)
		// Recorded whatever the outcome: a sync the driver applied late still moved the scale.
		if (rotator.angle.value !== before) {
			const key = resourceKey(rotator)
			this.#syncOffsets.set(key, (this.#syncOffsets.get(key) ?? 0) + before - rotator.angle.value)
		}
		return await settle(Promise.resolve(synced), 'The sync')
	}

	// Reverses or restores the rotation direction. Responds 204 once applied; 404, 409, 422 when the rotator
	// cannot reverse.
	async reverse(connectionId: string, deviceId: string, { enabled }: RotatorReverseRequest): Promise<Response> {
		const rotator = connectedDevice(this, connectionId, 'rotator', deviceId, 'Rotator')
		if (rotator instanceof Response) return rotator
		if (!rotator.canReverse) return unsupported('The rotator cannot reverse its rotation')
		return await settle(this.#commander.reverse(this.operations.coordinator, rotator, enabled), 'Reversing the rotation')
	}

	// Cancels the move of a rotator and stops it. Responds 204 once it stands still, 404, and 409 when the
	// stop could not be confirmed.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const rotator = findDevice(this, connectionId, 'rotator', deviceId)
		if (!rotator) return notFound('Rotator')
		return await stopResponse(this.operations, rotator, () => this.#commander.stopMotion(rotator))
	}

	// Stops observing the rotators; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.#commander.dispose()
	}
}

// Routes of the rotator commands.
export function createRotatorRoutes(rotators: RotatorCommands) {
	return {
		'/api/connections/:id/rotators/:deviceId': {
			// Angle, motion, and capabilities of a rotator; 404 when the connection is not open or has no such rotator.
			GET: (req) => rotators.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/rotators/:deviceId/move-to': {
			// Starts a move to a mechanical angle; the outcome arrives as operation:updated events.
			POST: async (req) => rotators.moveTo(req.params.id, req.params.deviceId, (await req.json()) as RotatorMoveToRequest),
		},
		'/api/connections/:id/rotators/:deviceId/move-by': {
			// Starts a move by an angle; the outcome arrives as operation:updated events.
			POST: async (req) => rotators.moveBy(req.params.id, req.params.deviceId, (await req.json()) as RotatorMoveByRequest),
		},
		'/api/connections/:id/rotators/:deviceId/home': {
			// Starts a move to the home position; the outcome arrives as operation:updated events.
			POST: async (req) => rotators.home(req.params.id, req.params.deviceId, (await req.json()) as CommandRequest),
		},
		'/api/connections/:id/rotators/:deviceId/sync': {
			// Redefines the angle without moving.
			POST: async (req) => rotators.sync(req.params.id, req.params.deviceId, (await req.json()) as RotatorSyncRequest),
		},
		'/api/connections/:id/rotators/:deviceId/reverse': {
			// Reverses or restores the rotation direction.
			POST: async (req) => rotators.reverse(req.params.id, req.params.deviceId, (await req.json()) as RotatorReverseRequest),
		},
		'/api/connections/:id/rotators/:deviceId/stop': {
			// Cancels the move of a rotator and stops it.
			POST: (req) => rotators.stop(req.params.id, req.params.deviceId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
