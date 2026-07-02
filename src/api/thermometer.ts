import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Thermometer } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, ThermometerManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface ThermometerBusEvents {
	readonly add: ThermometerAdded
	readonly update: ThermometerUpdated
	readonly remove: ThermometerRemoved
}

export const thermometerBus = new EventBus<ThermometerBusEvents>()

export class ThermometerHandler implements DeviceHandler<Thermometer> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly thermometerManager: ThermometerManager,
	) {
		thermometerManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of thermometerManager.list()) {
				wsm.send<ThermometerAdded>('thermometer:add', { device }, socket)
			}
		})

		thermometerBus.subscribe('add', (event) => wsm.send('thermometer:add', event))
		thermometerBus.subscribe('update', (event) => wsm.send('thermometer:update', event))
		thermometerBus.subscribe('remove', (event) => wsm.send('thermometer:remove', event))
	}

	added(device: Thermometer) {
		thermometerBus.emit('add', { device })
		console.info('thermometer added:', device.name, device.id)
	}

	updated(device: Thermometer, property: keyof Thermometer & string, state?: PropertyState) {
		thermometerBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Thermometer) {
		thermometerBus.emit('remove', { device })
		console.info('thermometer removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.thermometerManager.list(client))
	}
}

export function thermometer(thermometerHandler: ThermometerHandler) {
	const { thermometerManager } = thermometerHandler

	function thermometerFromParams(req: Bun.BunRequest) {
		return thermometerManager.get(query(req).client, req.params.id)!
	}

	return {
		'/thermometers': { GET: (req) => response(thermometerHandler.list(query(req).client)) },
		'/thermometers/:id': { GET: (req) => response(thermometerFromParams(req)) },
	} as const satisfies Endpoints
}
