import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Rotator } from 'nebulosa/src/indi.device'
import type { DeviceHandler, RotatorManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class RotatorHandler implements DeviceHandler<Rotator> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly rotatorManager: RotatorManager,
	) {
		rotatorManager.addHandler(this)
	}

	added(device: Rotator) {
		this.wsm.send<RotatorAdded>('rotator:add', { device })
		console.info('rotator added:', device.name)
	}

	updated(device: Rotator, property: keyof Rotator & string, state?: PropertyState) {
		this.wsm.send<RotatorUpdated>('rotator:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Rotator) {
		this.wsm.send<RotatorRemoved>('rotator:remove', { device })
		console.info('rotator removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.rotatorManager.list(client))
	}
}

export function rotator(rotatorHandler: RotatorHandler): Endpoints {
	const { rotatorManager } = rotatorHandler

	function rotatorFromParams(req: Bun.BunRequest<string>) {
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
	}
}
