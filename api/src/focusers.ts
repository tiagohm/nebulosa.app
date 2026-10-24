import { FocuserCommander, type FocuserCommandOptions, type FocuserMover } from 'nebulosa/src/devices/commanders/focuser'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager/device'
import { failedOperationResult, type OperationResult, type OperationScope, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { abortReason } from 'nebulosa/src/devices/orchestration/operation.wait'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { BacklashCompensator } from 'nebulosa/src/observation/focus/backlash'
import { type ClientResolver, type CommandRequest, connectedDevice, notFound, findDevice, settle, startCommand, stateResponse, stopResponse, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import { type FocuserBacklashConfig, type FocuserBacklashStore, focuserKey, type StoredFocuserBacklash } from './focuserbacklash'
import { errorResponse } from './http'
import type { OperationProgressReporter, OperationRegistry } from './operations'

// Focuser commands of every open connection, over the toolkit's FocuserCommander: a move to an absolute
// position or by a number of steps inward or outward (the commander translates the direction to the
// driver's convention and keeps the target inside the travel the driver publishes), a sync of the position
// counter, the reversal of the motion direction, and a stop. Moves run as focuser.move operations that
// resolve once the focuser reports standing at the target.
//
// Every positioning move of a focuser with absolute positioning goes through the backlash compensation saved
// for it, snapshotted when the move starts: the toolkit's BacklashCompensator turns the requested (logical)
// position into the physical positions to command, computed from the position read once the focuser is held,
// all checked against the travel before the first one is commanded (never clamped), and commanded in order
// inside one operation holding the focuser, so nothing else moves it between them. A stop or a failure ends
// the move without commanding the remaining positions and makes the compensator forget its memory. In
// ABSOLUTE mode the compensator accumulates an offset, the commanded position minus the logical one; it is
// kept in memory per focuser only, published with the settings, and forgotten on a sync, a reversal, a
// disconnection, a saved change of the settings, and a restart of the server. A focuser with relative
// positioning only is never compensated, and a compensated move of a focuser whose driver compensates its
// backlash itself is refused before anything moves, so no move is compensated twice. The same compensated
// moves serve composite features, such as the autofocus, through mover.

// Direction of a relative move: towards the telescope (IN) or away from it (OUT), as the driver defines.
export type FocuserDirection = 'IN' | 'OUT'

// Body of POST /api/connections/:id/focusers/:deviceId/move-to.
export interface FocuserMoveToRequest extends CommandRequest {
	// Target position in steps, in the logical counter of the focuser.
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

// Backlash compensation of a focuser, as reported to clients.
export interface FocuserBacklashState {
	// Id of the open connection that provides the focuser.
	readonly connectionId: string
	// Exact id of the focuser.
	readonly deviceId: string
	// Saved settings; the defaults when never saved.
	readonly config: FocuserBacklashConfig
	// Revision of the saved settings, increased by every save; 0 when never saved.
	readonly revision: number
	// ABSOLUTE mode offset, in steps: the reported position minus the logical one; 0 in any other case.
	readonly offset: number
	// Why the settings file cannot be used; the defaults are then applied.
	readonly error?: string
}

// Body of PUT /api/connections/:id/focusers/:deviceId/backlash.
export interface FocuserBacklashSaveRequest {
	// New settings.
	readonly config: FocuserBacklashConfig
	// Revision the settings were edited from; the save is refused when another one was saved since.
	readonly revision: number
}

// Notification published when the settings or the offset of the backlash compensation of a focuser change.
export interface FocuserBacklashEvent {
	readonly type: 'focuserBacklash:updated'
	// New compensation state of the focuser.
	readonly backlash: FocuserBacklashState
}

// Receiver of focuser backlash events.
export type FocuserBacklashListener = (event: FocuserBacklashEvent) => void

// Compensator of a focuser while its memory is valid.
interface Compensation {
	// Key of the focuser in the settings.
	readonly key: string
	// Revision of the settings the compensator was built from.
	readonly revision: number
	// Compensator with the memory of the moves made since.
	readonly compensator: BacklashCompensator
}

// Focuser commands over the focusers of every open connection.
export class FocuserCommands implements DeviceHandler<Focuser>, Disposable {
	// Commander driving the focusers and observing their moves.
	readonly #commander: FocuserCommander
	// Compensator of each focuser whose compensated moves have a memory, by device object, so a reconnection,
	// which creates new device objects, never inherits it.
	readonly #compensations = new Map<Focuser, Compensation>()

	// Moves of a focuser in its logical counter with the saved backlash compensation, for composite features
	// such as the autofocus; it holds the focuser in the scope it is given.
	readonly mover: FocuserMover = {
		moveTo: (scope, focuser, position, options) => this.#position(scope, focuser, () => position, options),
		position: (focuser) => this.#logicalPosition(focuser),
	}

	// Creates the commands over the device registry; client resolves an open connection id to its client,
	// operations runs and publishes every move, backlash holds the saved compensation of every focuser, and
	// listener receives every change of a compensation state.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly operations: OperationRegistry,
		readonly backlash: FocuserBacklashStore,
		readonly listener?: FocuserBacklashListener,
	) {
		this.#commander = new FocuserCommander(devices.focusers)
		devices.focusers.addHandler(this)
	}

	// Required by the manager contract; discovery is published by the device registry.
	added() {}

	// Forgets the compensator memory of a focuser that disconnects: its position is no longer known to follow
	// the moves computed here.
	updated(focuser: Focuser, property: keyof Focuser & string) {
		if (property === 'connected' && !focuser.connected) this.#forget(focuser)
	}

	// Forgets the compensator memory of a focuser that disappears.
	removed(focuser: Focuser) {
		this.#compensations.delete(focuser)
	}

	// Responds with the state of a focuser, or 404.
	state(connectionId: string, deviceId: string): Response {
		return stateResponse(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
	}

	// Starts a move to an absolute position of the logical counter. Responds 202 with the operation id; 404,
	// 409 disconnected or busy, 422 when the focuser has no absolute positioning.
	moveTo(connectionId: string, deviceId: string, request: FocuserMoveToRequest): Response {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canAbsoluteMove) return unsupported('The focuser cannot move to a position')
		return startCommand(this.operations, 'focuser.move', connectionId, focuser, request, (report) => this.#position(this.operations.coordinator, focuser, () => request.position, undefined, report))
	}

	// Starts a move by a number of steps inward or outward. A compensated focuser moves to the logical position
	// the steps lead to, read once it is held; otherwise the move is relative, or through the absolute position
	// when the focuser has no relative positioning. Answered like moveTo, with 422 when the focuser cannot move
	// by steps. A repeated request with the same token never moves it twice.
	move(connectionId: string, deviceId: string, request: FocuserMoveRequest): Response {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canRelativeMove && !focuser.canAbsoluteMove) return unsupported('The focuser cannot move by steps')
		const { coordinator } = this.operations
		const { direction, steps } = request
		// Inward decreases the reported position, the convention the commander applies to relative moves.
		const delta = direction === 'IN' ? -steps : steps

		return startCommand(this.operations, 'focuser.move', connectionId, focuser, request, async (report) => {
			const settings = await this.#settings(connectionId, focuser)
			if (settings) return await this.#compensated(coordinator, focuser, settings, () => this.#logicalPosition(focuser) + delta, undefined, report)
			if (focuser.canRelativeMove) return direction === 'IN' ? await this.#commander.moveIn(coordinator, focuser, steps) : await this.#commander.moveOut(coordinator, focuser, steps)
			return await this.#commander.moveTo(coordinator, focuser, focuser.position.value + delta)
		})
	}

	// Redefines the position counter without moving, which also makes the logical position the reported one.
	// Responds 204 once sent; 404, 409 disconnected or busy, 422 when the focuser cannot sync.
	async sync(connectionId: string, deviceId: string, { position }: FocuserSyncRequest): Promise<Response> {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canSync) return unsupported('The focuser cannot sync its position')
		const response = await settle(this.#commander.syncTo(this.operations.coordinator, focuser, position), 'The sync')
		this.#forget(focuser)
		return response
	}

	// Reverses or restores the motion direction, which invalidates the direction the compensator remembers.
	// Responds 204 once applied; 404, 409, 422 when the focuser cannot reverse.
	async reverse(connectionId: string, deviceId: string, { enabled }: FocuserReverseRequest): Promise<Response> {
		const focuser = connectedDevice(this.devices, this.client, connectionId, 'focuser', deviceId, 'Focuser')
		if (focuser instanceof Response) return focuser
		if (!focuser.canReverse) return unsupported('The focuser cannot reverse its motion')
		const response = await settle(this.#commander.reverse(this.operations.coordinator, focuser, enabled), 'Reversing the motion')
		this.#forget(focuser)
		return response
	}

	// Cancels the move of a focuser and stops it. Responds 204 once it stands still, 404, and 409 when the
	// stop could not be confirmed. No compensation applies: the remaining positions of a compensated move are
	// never commanded.
	async stop(connectionId: string, deviceId: string): Promise<Response> {
		const focuser = findDevice(this.devices, this.client, connectionId, 'focuser', deviceId)
		if (!focuser) return notFound('Focuser')
		return await stopResponse(this.operations, focuser, () => this.#commander.stopMotion(focuser))
	}

	// Responds with the backlash compensation of a focuser, connected or not, or 404.
	async backlashState(connectionId: string, deviceId: string): Promise<Response> {
		const focuser = findDevice(this.devices, this.client, connectionId, 'focuser', deviceId)
		if (!focuser) return notFound('Focuser')
		return Response.json(await this.#backlashState(connectionId, focuser))
	}

	// Saves the backlash compensation of a focuser, connected or not, and responds with its new state; a move
	// in progress keeps the settings it started with, and the memory of the compensator is forgotten. 404, 409
	// with the current state when another revision was saved since, 409 when the settings file was written by
	// a newer version, and 500 when the file cannot be written.
	async saveBacklash(connectionId: string, deviceId: string, { config, revision }: FocuserBacklashSaveRequest): Promise<Response> {
		const focuser = findDevice(this.devices, this.client, connectionId, 'focuser', deviceId)
		if (!focuser) return notFound('Focuser')

		try {
			const outcome = await this.backlash.save(connectionId, deviceId, config, revision)
			if (outcome.status === 'newerVersion') return errorResponse('The focuser settings file was written by a newer version of Nebulosa', 409, 'newerVersion')
			if (outcome.status === 'conflict') return errorResponse('The settings were changed by another client', 409, 'conflict', { backlash: await this.#backlashState(connectionId, focuser) })
			this.#compensations.delete(focuser)
			const backlash = await this.#backlashState(connectionId, focuser)
			this.listener?.({ type: 'focuserBacklash:updated', backlash })
			return Response.json(backlash)
		} catch (error) {
			return errorResponse(`Unable to write the focuser settings: ${Error.isError(error) ? error.message : String(error)}`, 500, 'writeFailed')
		}
	}

	// Stops observing the focusers; their operations belong to the operation registry.
	[Symbol.dispose]() {
		this.devices.focusers.removeHandler(this)
		this.#commander.dispose()
	}

	// Saved compensation of a focuser when its moves are compensated: enabled and with absolute positioning.
	async #settings(connectionId: string, focuser: Focuser): Promise<StoredFocuserBacklash | undefined> {
		const { settings } = await this.backlash.get(connectionId, focuser.id)
		return settings.enabled && focuser.canAbsoluteMove ? settings : undefined
	}

	// Moves a focuser to the logical position target resolves, compensated when its settings say so, inside scope.
	async #position(scope: OperationScope, focuser: Focuser, target: () => number, options?: FocuserCommandOptions, report?: OperationProgressReporter): Promise<OperationResult<void>> {
		const connectionId = this.devices.connectionOf(focuser)
		if (!connectionId || !focuser.connected) return failedOperationResult('disconnected')
		const settings = await this.#settings(connectionId, focuser)
		if (settings) return await this.#compensated(scope, focuser, settings, target, options, report)
		this.#forget(focuser)
		return await this.#commander.moveTo(scope, focuser, target(), options)
	}

	// Moves a focuser to a logical position through the positions the compensator plans for it, all inside one
	// operation of scope holding the focuser. The target (steps, rounded) and the current position are read once
	// the focuser is held; a focuser whose driver compensates its backlash is refused, and so is a plan with a
	// position outside the travel, both before anything moves and leaving the compensator as it was. A failed or cancelled step stops the move and makes the compensator forget its
	// memory, since the focuser stands at a position no plan expected.
	async #compensated(scope: OperationScope, focuser: Focuser, settings: StoredFocuserBacklash, target: () => number, options?: FocuserCommandOptions, report?: OperationProgressReporter): Promise<OperationResult<void>> {
		return await scope.start<void>('focuserCompensatedMove', [{ key: resourceKey(focuser), device: focuser }], async (context) => {
			if (!focuser.connected) return failedOperationResult('disconnected')
			if (focuser.backlashEnabled) return failedOperationResult('unexpectedState', `the driver of ${focuser.name} compensates its backlash; turn it or the compensation of Nebulosa off`)

			const { compensator } = this.#compensation(focuser, settings)
			const previous = compensator.state
			const logical = Math.round(target())
			const plan = compensator.compute(logical, focuser.position.value)
			const { min, max } = focuser.position
			const outside = plan.find((position) => !(position >= min && position <= max))

			if (outside !== undefined) {
				compensator.reset(previous)
				return failedOperationResult('unexpectedState', `the backlash compensated move of ${focuser.name} to ${logical} needs position ${outside}, outside the range [${min}, ${max}]`)
			}

			for (const [index, position] of plan.entries()) {
				if (context.signal.aborted) {
					this.#forget(focuser)
					return failedOperationResult(abortReason(context.signal))
				}

				report?.({ step: index + 1, steps: plan.length, message: `Moving to ${position}` })
				const moved = await this.#commander.moveTo(context, focuser, position, options)

				if (!moved.ok) {
					this.#forget(focuser)
					return moved
				}
			}

			if (compensator.state.offset !== previous.offset) this.#publish(focuser)
			return successfulOperationResult(undefined)
		}).result
	}

	// Returns the compensator of a focuser for its saved settings, a new one when they changed.
	#compensation(focuser: Focuser, settings: StoredFocuserBacklash): Compensation {
		const key = focuserKey(this.devices.connectionOf(focuser) ?? '', focuser.id)
		const current = this.#compensations.get(focuser)
		if (current?.key === key && current.revision === settings.revision) return current

		const { mode, backlashIn, backlashOut } = settings
		const compensation: Compensation = { key, revision: settings.revision, compensator: new BacklashCompensator({ mode, backlashIn, backlashOut }) }
		this.#compensations.set(focuser, compensation)
		return compensation
	}

	// ABSOLUTE mode offset of a focuser, in steps; 0 without a compensator memory.
	#offset(focuser: Focuser) {
		return this.#compensations.get(focuser)?.compensator.state.offset ?? 0
	}

	// Position of a focuser in its logical counter, in steps: the reported one minus the offset.
	#logicalPosition(focuser: Focuser) {
		return focuser.position.value - this.#offset(focuser)
	}

	// Forgets the compensator memory of a focuser, publishing the new offset when it had one.
	#forget(focuser: Focuser) {
		const offset = this.#offset(focuser)
		if (!this.#compensations.delete(focuser) || offset === 0) return
		this.#publish(focuser)
	}

	// Publishes the compensation state of a focuser of an attached connection.
	#publish(focuser: Focuser) {
		const connectionId = this.devices.connectionOf(focuser)
		if (!connectionId || !this.listener) return
		const { listener } = this
		void this.#backlashState(connectionId, focuser).then(
			(backlash) => listener({ type: 'focuserBacklash:updated', backlash }),
			() => undefined,
		)
	}

	// Compensation state of a focuser.
	async #backlashState(connectionId: string, focuser: Focuser): Promise<FocuserBacklashState> {
		const { settings, error } = await this.backlash.get(connectionId, focuser.id)
		const { enabled, mode, backlashIn, backlashOut, revision } = settings
		return { connectionId, deviceId: focuser.id, config: { enabled, mode, backlashIn, backlashOut }, revision, offset: this.#offset(focuser), ...(error && { error }) }
	}
}

// Routes of the focuser commands and backlash compensation.
export function createFocuserRoutes(focusers: FocuserCommands) {
	return {
		'/api/connections/:id/focusers/:deviceId': {
			// Position, motion, and capabilities of a focuser; 404 when the connection is not open or has no such focuser.
			GET: (req) => focusers.state(req.params.id, req.params.deviceId),
		},
		'/api/connections/:id/focusers/:deviceId/move-to': {
			// Starts a move to an absolute position; the outcome arrives as operation:updated events.
			POST: async (req) => focusers.moveTo(req.params.id, req.params.deviceId, (await req.json()) as FocuserMoveToRequest),
		},
		'/api/connections/:id/focusers/:deviceId/move': {
			// Starts a move by a number of steps; the outcome arrives as operation:updated events.
			POST: async (req) => focusers.move(req.params.id, req.params.deviceId, (await req.json()) as FocuserMoveRequest),
		},
		'/api/connections/:id/focusers/:deviceId/backlash': {
			// Backlash compensation of a focuser, connected or not.
			GET: (req) => focusers.backlashState(req.params.id, req.params.deviceId),
			// Saves the backlash compensation of a focuser (FocuserBacklashSaveRequest), applied from the next move.
			PUT: async (req) => focusers.saveBacklash(req.params.id, req.params.deviceId, (await req.json()) as FocuserBacklashSaveRequest),
		},
		'/api/connections/:id/focusers/:deviceId/sync': {
			// Redefines the position counter without moving.
			POST: async (req) => focusers.sync(req.params.id, req.params.deviceId, (await req.json()) as FocuserSyncRequest),
		},
		'/api/connections/:id/focusers/:deviceId/reverse': {
			// Reverses or restores the motion direction.
			POST: async (req) => focusers.reverse(req.params.id, req.params.deviceId, (await req.json()) as FocuserReverseRequest),
		},
		'/api/connections/:id/focusers/:deviceId/stop': {
			// Cancels the move of a focuser and stops it.
			POST: (req) => focusers.stop(req.params.id, req.params.deviceId),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
