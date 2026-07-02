import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { DewHeater } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, DewHeaterManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface DewHeaterBusEvents {
	readonly add: DewHeaterAdded
	readonly update: DewHeaterUpdated
	readonly remove: DewHeaterRemoved
}

export const dewHeaterBus = new EventBus<DewHeaterBusEvents>()

export class DewHeaterHandler implements DeviceHandler<DewHeater> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly dewHeaterManager: DewHeaterManager,
	) {
		dewHeaterManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of dewHeaterManager.list()) {
				wsm.send<DewHeaterAdded>('dewHeater:add', { device }, socket)
			}
		})

		dewHeaterBus.subscribe('add', (event) => wsm.send('dewHeater:add', event))
		dewHeaterBus.subscribe('update', (event) => wsm.send('dewHeater:update', event))
		dewHeaterBus.subscribe('remove', (event) => wsm.send('dewHeater:remove', event))
	}

	added(device: DewHeater) {
		dewHeaterBus.emit('add', { device })
		console.info('dew heater added:', device.name, device.id)
	}

	updated(device: DewHeater, property: keyof DewHeater & string, state?: PropertyState) {
		dewHeaterBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: DewHeater) {
		dewHeaterBus.emit('remove', { device })
		console.info('dew heater removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.dewHeaterManager.list(client))
	}
}

export function dewHeater(dewHeaterHandler: DewHeaterHandler) {
	const { dewHeaterManager } = dewHeaterHandler

	function dewHeaterFromParams(req: Bun.BunRequest) {
		return dewHeaterManager.get(query(req).client, req.params.id)!
	}

	return {
		'/dewheaters': { GET: (req) => response(dewHeaterHandler.list(query(req).client)) },
		'/dewheaters/:id': { GET: (req) => response(dewHeaterFromParams(req)) },
		'/dewheaters/:id/dutycycle': { POST: async (req) => response(dewHeaterManager.dutyCycle(dewHeaterFromParams(req), await req.json())) },
	} as const satisfies Endpoints
}
