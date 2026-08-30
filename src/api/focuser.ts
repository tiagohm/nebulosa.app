import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager/device'
import type { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from '#/focuser'
import type { OperationResult } from '#/orchestration'
import type { FocuserCommander } from './focuser.commander'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { detachOperation } from './operation.notify'
import { resourceKey } from './resource'

export interface FocuserBusEvents {
	readonly add: FocuserAdded
	readonly update: FocuserUpdated
	readonly remove: FocuserRemoved
}

export const focuserBus = new EventBus<FocuserBusEvents>()

// Publishes focuser transport events and delegates every mutation to FocuserCommander.
export class FocuserHandler implements DeviceHandler<Focuser> {
	// Registers the focuser transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly focuserManager: FocuserManager,
		readonly notification: NotificationHandler,
		readonly commander: FocuserCommander,
		readonly coordinator: OperationCoordinator,
	) {
		focuserManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of focuserManager.list()) {
				wsm.send<FocuserAdded>('focuser:add', { device }, socket)
			}
		})

		focuserBus.subscribe('add', (event) => wsm.send('focuser:add', event))
		focuserBus.subscribe('update', (event) => wsm.send('focuser:update', event))
		focuserBus.subscribe('remove', (event) => wsm.send('focuser:remove', event))
	}

	added(device: Focuser) {
		focuserBus.emit('add', { device })
		console.info('focuser added:', device.name, device.id)
	}

	updated(device: Focuser, property: keyof Focuser & string, state?: PropertyState) {
		focuserBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Focuser) {
		focuserBus.emit('remove', { device })
		console.info('focuser removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.focuserManager.list(client))
	}

	// Moves to an absolute position as a whole operation tree owning the focuser. Reaching the position
	// takes longer than the request that asked for it, so it reports through focuser events.
	moveTo(focuser: Focuser, position: number) {
		this.#detach(focuser, `move to position ${position}`, () => this.commander.moveTo(this.coordinator, focuser, position))
	}

	// Moves inward by a number of steps.
	moveIn(focuser: Focuser, steps: number) {
		this.#detach(focuser, `move in ${steps} steps`, () => this.commander.moveIn(this.coordinator, focuser, steps))
	}

	// Moves outward by a number of steps.
	moveOut(focuser: Focuser, steps: number) {
		this.#detach(focuser, `move out ${steps} steps`, () => this.commander.moveOut(this.coordinator, focuser, steps))
	}

	// Redefines the position the focuser reports, which the driver applies without any movement.
	syncTo(focuser: Focuser, position: number) {
		return this.commander.syncTo(this.coordinator, focuser, position)
	}

	// Inverts what inward and outward mean at the driver.
	reverse(focuser: Focuser, enabled: boolean) {
		return this.commander.reverse(this.coordinator, focuser, enabled)
	}

	// Stops the focuser: first by cancelling whatever operation owns it, so its own cleanup runs, and then
	// by the physical abort, which also covers motion nobody here started.
	// No local index of operations is kept: the arbiter already knows the owner, and stopping by device
	// means stopping the whole tree, because a caller holding only a device id cannot name a scope and
	// stopping the focuser of an autofocus run means stopping the autofocus run.
	async stop(focuser: Focuser) {
		await this.coordinator.cancelByResource(resourceKey(focuser))
		return await this.commander.stopMotion(focuser)
	}

	// Runs a command whose physical completion outlasts the request that asked for it, notifying its failure.
	#detach(focuser: Focuser, action: string, command: () => Promise<OperationResult<unknown>>) {
		detachOperation(this.notification, 'FOCUSER', focuser.name, action, command)
	}
}

export function focuser(focuserHandler: FocuserHandler) {
	const { focuserManager } = focuserHandler

	function focuserFromParams(req: Bun.BunRequest) {
		return focuserManager.get(query(req).client, req.params.id)!
	}

	return {
		'/focusers': { GET: (req) => response(focuserHandler.list(query(req).client)) },
		'/focusers/:id': { GET: (req) => response(focuserFromParams(req)) },
		'/focusers/:id/moveto': { POST: async (req) => response(focuserHandler.moveTo(focuserFromParams(req), await req.json())) },
		'/focusers/:id/movein': { POST: async (req) => response(focuserHandler.moveIn(focuserFromParams(req), await req.json())) },
		'/focusers/:id/moveout': { POST: async (req) => response(focuserHandler.moveOut(focuserFromParams(req), await req.json())) },
		'/focusers/:id/sync': { POST: async (req) => response<OperationResult<void>>(await focuserHandler.syncTo(focuserFromParams(req), await req.json())) },
		'/focusers/:id/reverse': { POST: async (req) => response<OperationResult<void>>(await focuserHandler.reverse(focuserFromParams(req), await req.json())) },
		'/focusers/:id/stop': { POST: async (req) => response<OperationResult<void>>(await focuserHandler.stop(focuserFromParams(req))) },
	} as const satisfies Endpoints
}
