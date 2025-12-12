import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Thermometer } from 'nebulosa/src/indi.device'
import type { DeviceHandler, ThermometerManager } from 'nebulosa/src/indi.manager'
import type { CameraUpdated, FocuserUpdated, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export class ThermometerHandler implements DeviceHandler<Thermometer> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: Thermometer) {
		this.wsm.send<ThermometerAdded>('thermometer:add', { device })
		console.info('thermometer added:', device.name)
	}

	updated(client: IndiClient, device: Thermometer, property: keyof Thermometer, state?: PropertyState) {
		const event = { device: { name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'CAMERA') this.wsm.send<CameraUpdated>('camera:update', event)
		else if (device.type === 'FOCUSER') this.wsm.send<FocuserUpdated>('focuser:update', event)
		this.wsm.send<ThermometerUpdated>('thermometer:update', event)
	}

	removed(client: IndiClient, device: Thermometer) {
		this.wsm.send<ThermometerRemoved>('thermometer:remove', { device })
		console.info('thermometer removed:', device.name)
	}
}

export function thermometer(thermometer: ThermometerManager) {
	function thermometerFromParams(params: { id: string }) {
		return thermometer.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/thermometers' })
		// Endpoints!
		.get('', () => thermometer.list())
		.get('/:id', ({ params }) => thermometerFromParams(params))

	return app
}
