import Elysia from 'elysia'
import type { PropertyState } from 'nebulosa/src/indi'
import { DeviceHandler, type IndiDeviceHandler } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { Thermometer, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from './types'

// Handler for managing thermometer devices and their properties
export class ThermometerHandler extends DeviceHandler<Thermometer> {
	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {
		super()
	}

	deviceAdded(device: Thermometer) {
		this.webSocketMessageHandler.send<ThermometerAdded>({ type: 'THERMOMETER_ADD', device })
	}

	deviceUpdated(device: Thermometer, property: keyof Thermometer, state?: PropertyState) {
		this.webSocketMessageHandler.send<ThermometerUpdated>({ type: 'THERMOMETER_UPDATE', device: { name: device.name, [property]: device[property] }, property, state })
	}

	deviceRemoved(device: Thermometer) {
		this.webSocketMessageHandler.send<ThermometerRemoved>({ type: 'THERMOMETER_REMOVE', device })
	}
}

// Manager for thermometer operations
export class ThermometerManager {
	constructor(
		private readonly handler: ThermometerHandler,
		private readonly indi: IndiDeviceHandler,
	) {}

	list() {
		return this.indi.thermometers()
	}

	get(id: string) {
		return this.indi.thermometer(id)
	}
}

// Creates an instance of Elysia with thermometer endpoints
export function thermometers(thermometer: ThermometerManager) {
	const app = new Elysia({ prefix: '/thermometers' })

	app.get('', () => {
		return thermometer.list()
	})

	app.get('/:id', ({ params }) => {
		return thermometer.get(decodeURIComponent(params.id))
	})

	return app
}
