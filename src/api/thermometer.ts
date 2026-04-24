import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Thermometer } from 'nebulosa/src/indi.device'
import type { DeviceHandler, ThermometerManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CameraUpdated, FocuserUpdated, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class ThermometerHandler implements DeviceHandler<Thermometer> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly thermometerManager: ThermometerManager,
	) {
		thermometerManager.addHandler(this)
	}

	added(device: Thermometer) {
		this.wsm.send('thermometer:add', { device } satisfies ThermometerAdded)
		console.info('thermometer added:', device.name)
	}

	updated(device: Thermometer, property: keyof Thermometer & string, state?: PropertyState) {
		const event = { device: { id: device.id, name: device.name, [property]: device[property] }, property, state } satisfies CameraUpdated | FocuserUpdated | ThermometerUpdated

		if (device.type === 'CAMERA') this.wsm.send('camera:update', event)
		else if (device.type === 'FOCUSER') this.wsm.send('focuser:update', event)
		this.wsm.send('thermometer:update', event)
	}

	removed(device: Thermometer) {
		this.wsm.send('thermometer:remove', { device } satisfies ThermometerRemoved)
		console.info('thermometer removed:', device.name)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.thermometerManager.list(client))
	}
}

export function thermometer(thermometerHandler: ThermometerHandler): Endpoints {
	const { thermometerManager } = thermometerHandler

	function thermometerFromParams(req: Bun.BunRequest) {
		return thermometerManager.get(query(req).client, req.params.id)!
	}

	return {
		'/thermometers': { GET: (req) => response(thermometerHandler.list(query(req).client)) },
		'/thermometers/:id': { GET: (req) => response(thermometerFromParams(req)) },
	}
}
