import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Thermometer } from 'nebulosa/src/indi.device'
import type { DeviceHandler, ThermometerManager } from 'nebulosa/src/indi.manager'
import type { CameraUpdated, FocuserUpdated, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function thermometer(wsm: WebSocketMessageHandler, thermometerManager: ThermometerManager) {
	function thermometerFromParams(params: { id: string }) {
		return thermometerManager.get(decodeURIComponent(params.id))!
	}

	const handler: DeviceHandler<Thermometer> = {
		added: (client: IndiClient, device: Thermometer) => {
			wsm.send<ThermometerAdded>('thermometer:add', { device })
			console.info('thermometer added:', device.name)
		},
		updated: (client: IndiClient, device: Thermometer, property: keyof Thermometer, state?: PropertyState) => {
			const event = { device: { name: device.name, [property]: device[property] }, property, state }

			if (device.type === 'CAMERA') wsm.send<CameraUpdated>('camera:update', event)
			else if (device.type === 'FOCUSER') wsm.send<FocuserUpdated>('focuser:update', event)
			wsm.send<ThermometerUpdated>('thermometer:update', event)
		},
		removed: (client: IndiClient, device: Thermometer) => {
			wsm.send<ThermometerRemoved>('thermometer:remove', { device })
			console.info('thermometer removed:', device.name)
		},
	}

	thermometerManager.addHandler(handler)

	const app = new Elysia({ prefix: '/thermometers' })
		// Endpoints!
		.get('', () => thermometerManager.list())
		.get('/:id', ({ params }) => thermometerFromParams(params))

	return app
}
