import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, RotatorManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface RotatorBusEvents {
	readonly add: RotatorAdded
	readonly update: RotatorUpdated
	readonly remove: RotatorRemoved
}

export const rotatorBus = new EventBus<RotatorBusEvents>()

export class RotatorHandler implements DeviceHandler<Rotator> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly rotatorManager: RotatorManager,
	) {
		rotatorManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of rotatorManager.list()) {
				wsm.send<RotatorAdded>('rotator:add', { device }, socket)
			}
		})

		rotatorBus.subscribe('add', (event) => wsm.send('rotator:add', event))
		rotatorBus.subscribe('update', (event) => wsm.send('rotator:update', event))
		rotatorBus.subscribe('remove', (event) => wsm.send('rotator:remove', event))
	}

	added(device: Rotator) {
		rotatorBus.emit('add', { device })
		console.info('rotator added:', device.name, device.id)
	}

	updated(device: Rotator, property: keyof Rotator & string, state?: PropertyState) {
		rotatorBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Rotator) {
		rotatorBus.emit('remove', { device })
		console.info('rotator removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.rotatorManager.list(client))
	}
}

export function rotator(rotatorHandler: RotatorHandler) {
	const { rotatorManager } = rotatorHandler

	function rotatorFromParams(req: Bun.BunRequest) {
		return rotatorManager.get(query(req).client, req.params.id)!
	}

	return {
		'/rotators': { GET: (req) => response(rotatorHandler.list(query(req).client)) },
		'/rotators/:id': { GET: (req) => response(rotatorFromParams(req)) },
		'/rotators/:id/moveto': { POST: async (req) => response(rotatorManager.moveTo(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/sync': { POST: async (req) => response(rotatorManager.syncTo(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/home': { POST: (req) => response(rotatorManager.home(rotatorFromParams(req))) },
		'/rotators/:id/reverse': { POST: async (req) => response(rotatorManager.reverse(rotatorFromParams(req), await req.json())) },
		'/rotators/:id/stop': { POST: (req) => response(rotatorManager.stop(rotatorFromParams(req))) },
	} as const satisfies Endpoints
}
