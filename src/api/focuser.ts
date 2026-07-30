import type { RequiredOnly } from 'nebulosa/src/core/types'
import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from '#/focuser'
import type { OperationResult } from '#/orchestration'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import { waitForDeviceState } from './operation.wait'

export interface FocuserBusEvents {
	readonly add: FocuserAdded
	readonly update: FocuserUpdated
	readonly remove: FocuserRemoved
}

export const focuserBus = new EventBus<FocuserBusEvents>()

// Default milliseconds allowed for a focuser to reach a commanded absolute position.
const DEFAULT_MOVE_TIMEOUT = 30000

export class FocuserHandler implements DeviceHandler<Focuser> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly focuserManager: FocuserManager,
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

	moveTo(focuser: Focuser, position: number) {
		this.focuserManager.moveTo(focuser, position)
	}

	moveIn(focuser: Focuser, steps: number) {
		this.focuserManager.moveIn(focuser, steps)
	}

	moveOut(focuser: Focuser, steps: number) {
		this.focuserManager.moveOut(focuser, steps)
	}

	syncTo(focuser: Focuser, position: number) {
		this.focuserManager.syncTo(focuser, position)
	}

	reverse(focuser: Focuser, enabled: boolean) {
		this.focuserManager.reverse(focuser, enabled)
	}

	stop(focuser: Focuser) {
		this.focuserManager.stop(focuser)
	}

	// Commands an absolute move and resolves only once the focuser has stopped at the target position,
	// which must already be a whole step inside the device range because that is what the driver reports
	// back. The signal is the caller's operation signal; the wait belongs to whoever owns the focuser.
	//
	// Subscription happens before the command, so a focuser that arrives while the command is still being
	// dispatched cannot be missed, and a focuser already standing at the target settles on the state read
	// after dispatch. Every unsuccessful outcome stops the focuser before settling, so no cancel, timeout,
	// or driver Alert leaves it moving after the operation that commanded it has released the device.
	async moveToAndWait(focuser: Focuser, position: number, signal: AbortSignal, timeout = DEFAULT_MOVE_TIMEOUT): Promise<OperationResult<void>> {
		const observed = await waitForDeviceState<RequiredOnly<Partial<FocuserUpdated>, 'device'>>({
			signal,
			timeout,
			subscribe: (listener) =>
				focuserBus.subscribe('update', (event) => {
					// Update events carry a projection of the device, so identity must be compared by id.
					if (event.device.id === focuser.id) listener({ device: focuser, property: event.property, state: event.state })
				}),
			current: () => ({ device: focuser }),
			evaluate: (update) => {
				if (!focuser.connected) return 'disconnected'
				if (update.state === 'Alert' && (update.property === 'position' || update.property === 'moving')) return 'alert'
				return !focuser.moving && focuser.position.value === position ? 'success' : 'pending'
			},
			command: () => this.moveTo(focuser, position),
			abort: () => this.stop(focuser),
		})

		return observed.ok ? { ok: true, value: undefined } : observed
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
		'/focusers/:id/sync': { POST: async (req) => response(focuserHandler.syncTo(focuserFromParams(req), await req.json())) },
		'/focusers/:id/reverse': { POST: async (req) => response(focuserHandler.reverse(focuserFromParams(req), await req.json())) },
		'/focusers/:id/stop': { POST: (req) => response(focuserHandler.stop(focuserFromParams(req))) },
	} as const satisfies Endpoints
}
