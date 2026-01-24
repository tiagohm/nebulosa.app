import type { IndiClient } from 'nebulosa/src/indi.client'
import type { DewHeater } from 'nebulosa/src/indi.device'
import type { DeviceHandler, DewHeaterManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CoverUpdated, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class DewHeaterHandler implements DeviceHandler<DewHeater> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly dewHeaterManager: DewHeaterManager,
	) {
		dewHeaterManager.addHandler(this)
	}

	added(device: DewHeater) {
		this.wsm.send<DewHeaterAdded>('dewHeater:add', { device })
		console.info('dew heater added:', device.name)
	}

	updated(device: DewHeater, property: keyof DewHeater & string, state?: PropertyState) {
		const event = { device: { id: device.id, name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'COVER') this.wsm.send<CoverUpdated>('cover:update', event)
		this.wsm.send<DewHeaterUpdated>('dewHeater:update', event)
	}

	removed(device: DewHeater) {
		this.wsm.send<DewHeaterRemoved>('dewHeater:remove', { device })
		console.info('dew heater removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.dewHeaterManager.list(client))
	}
}

export function dewHeater(dewHeaterHandler: DewHeaterHandler): Endpoints {
	const { dewHeaterManager } = dewHeaterHandler

	function dewHeaterFromParams(req: Bun.BunRequest<string>) {
		return dewHeaterManager.get(query(req).client, req.params.id)!
	}

	return {
		'/dewheaters': { GET: (req) => response(dewHeaterHandler.list(query(req).client)) },
		'/dewheaters/:id': { GET: (req) => response(dewHeaterFromParams(req)) },
		'/dewheaters/:id/dutycycle': { POST: async (req) => response(dewHeaterManager.dutyCycle(dewHeaterFromParams(req), await req.json())) },
	}
}
