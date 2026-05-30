import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Thermometer } from 'nebulosa/src/indi.device'
import type { DeviceHandler, ThermometerManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { Messager, WebSocketMessageHandler } from './message'

export class ThermometerHandler implements DeviceHandler<Thermometer> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly thermometerManager: ThermometerManager,
	) {
		thermometerManager.addHandler(this)

		bus.subscribe<Messager>('ws:open', (socket) => {
			for (const device of thermometerManager.list()) {
				this.wsm.send<ThermometerAdded>('thermometer:add', { device }, socket)
			}
		})
	}

	added(device: Thermometer) {
		this.wsm.send<ThermometerAdded>('thermometer:add', { device })
		console.info('thermometer added:', device.name, device.id)
	}

	updated(device: Thermometer, property: keyof Thermometer & string, state?: PropertyState) {
		const event: ThermometerUpdated = { device: { type: device.type, id: device.id, name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'camera') this.wsm.send('camera:update', event)
		else if (device.type === 'focuser') this.wsm.send('focuser:update', event)
		this.wsm.send('thermometer:update', event)
	}

	removed(device: Thermometer) {
		this.wsm.send<ThermometerRemoved>('thermometer:remove', { device })
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
