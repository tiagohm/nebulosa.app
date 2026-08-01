import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Wheel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { OperationResult } from '#/orchestration'
import type { WheelAdded, WheelRemoved, WheelUpdated } from '#/wheel'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import type { WheelCommander } from './wheel.commander'

export interface WheelBusEvents {
	readonly add: WheelAdded
	readonly update: WheelUpdated
	readonly remove: WheelRemoved
}

export const wheelBus = new EventBus<WheelBusEvents>()

// Publishes wheel transport events and delegates every mutation to WheelCommander.
export class WheelHandler implements DeviceHandler<Wheel> {
	// Registers the wheel transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly wheelManager: WheelManager,
		readonly notification: NotificationHandler,
		readonly commander: WheelCommander,
		readonly coordinator: OperationCoordinator,
	) {
		wheelManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of wheelManager.list()) {
				wsm.send<WheelAdded>('wheel:add', { device }, socket)
			}
		})

		wheelBus.subscribe('add', (event) => wsm.send('wheel:add', event))
		wheelBus.subscribe('update', (event) => wsm.send('wheel:update', event))
		wheelBus.subscribe('remove', (event) => wsm.send('wheel:remove', event))
	}

	added(device: Wheel) {
		wheelBus.emit('add', { device })
		console.info('wheel added:', device.name, device.id)
	}

	updated(device: Wheel, property: keyof Wheel & string, state?: PropertyState) {
		wheelBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Wheel) {
		wheelBus.emit('remove', { device })
		console.info('wheel removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.wheelManager.list(client))
	}

	// Selects a filter slot as a whole operation tree owning the wheel. Reaching the slot takes longer than
	// the request that asked for it, so it reports through wheel events.
	moveTo(wheel: Wheel, slot: number) {
		this.#detach(wheel, `move to slot ${slot}`, () => this.commander.moveTo(this.coordinator, wheel, slot))
	}

	// Renames the filter slots, which the driver applies without any movement.
	setNames(wheel: Wheel, names: readonly string[]) {
		return this.commander.setNames(this.coordinator, wheel, names)
	}

	// Runs a command whose physical completion outlasts the request that asked for it.
	// The HTTP response is gone by the time the wheel settles, and a refused command moves nothing, so it
	// emits no device update either: without a notification the user would see the action silently
	// discarded. Failures are therefore pushed over the WebSocket, which is the same path every other
	// asynchronous failure in the API already uses.
	#detach(wheel: Wheel, action: string, command: () => Promise<OperationResult<unknown>>) {
		void command().then((result) => {
			if (result.ok) return

			console.error('wheel failed to %s:', action, wheel.name, result.reason, result.error ?? '')
			this.notification.send({ title: 'FILTER WHEEL', description: `${wheel.name} failed to ${action}: ${result.error ?? result.reason}`, color: 'danger' })
		})
	}
}

export function wheel(wheelHandler: WheelHandler) {
	const { wheelManager } = wheelHandler

	function wheelFromParams(req: Bun.BunRequest) {
		return wheelManager.get(query(req).client, req.params.id)!
	}

	return {
		'/wheels': { GET: (req) => response(wheelHandler.list(query(req).client)) },
		'/wheels/:id': { GET: (req) => response(wheelFromParams(req)) },
		'/wheels/:id/moveto': { POST: async (req) => response(wheelHandler.moveTo(wheelFromParams(req), await req.json())) },
		'/wheels/:id/names': { POST: async (req) => response<OperationResult<void>>(await wheelHandler.setNames(wheelFromParams(req), await req.json())) },
	} as const satisfies Endpoints
}
