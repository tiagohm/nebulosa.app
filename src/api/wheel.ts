import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Wheel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { WheelAdded, WheelRemoved, WheelUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class WheelHandler implements DeviceHandler<Wheel> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly wheelManager: WheelManager,
	) {
		wheelManager.addHandler(this)
	}

	added(device: Wheel) {
		this.wsm.send<WheelAdded>('wheel:add', { device })
		console.info('wheel added:', device.name)
	}

	updated(device: Wheel, property: keyof Wheel & string, state?: PropertyState) {
		this.wsm.send<WheelUpdated>('wheel:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Wheel) {
		this.wsm.send<WheelRemoved>('wheel:remove', { device })
		console.info('wheel removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.wheelManager.list(client))
	}

	moveTo(device: Wheel, slot: number) {
		this.wheelManager.moveTo(device, slot)
	}
}

export function wheel(wheelHandler: WheelHandler): Endpoints {
	const { wheelManager } = wheelHandler

	function wheelFromParams(req: Bun.BunRequest<string>) {
		return wheelManager.get(query(req).client, req.params.id)!
	}

	return {
		'/wheels': { GET: (req) => response(wheelHandler.list(query(req).client)) },
		'/wheels/:id': { GET: (req) => response(wheelFromParams(req)) },
		'/wheels/:id/moveto': { POST: async (req) => response(wheelHandler.moveTo(wheelFromParams(req), await req.json())) },
		'/wheels/:id/names': { POST: async (req) => response(wheelManager.slots(wheelFromParams(req), await req.json())) },
	}
}
