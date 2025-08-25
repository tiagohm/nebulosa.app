import Elysia from 'elysia'
import type { DefNumberVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { CameraUpdated, FocuserUpdated, Thermometer, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from '../shared/types'
import type { WebSocketMessageManager } from './message'

export class ThermometerManager implements IndiClientHandler {
	private readonly thermometers = new Map<string, Thermometer>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all thermometers associated with the client
			this.thermometers.forEach((device) => this.remove(device))
		})
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.thermometers.get(message.device)

		if (!device || !device.hasThermometer) return

		let temperature = device.temperature

		switch (message.name) {
			case 'CCD_TEMPERATURE':
				temperature = message.elements.CCD_TEMPERATURE_VALUE!.value
				break
			case 'FOCUS_TEMPERATURE':
				temperature = message.elements.TEMPERATURE!.value
				break
			default:
				return
		}

		if (temperature !== device.temperature) {
			device.temperature = temperature
			this.update(device, 'temperature', message.state)
		}
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.thermometers.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: Thermometer, property: keyof Thermometer, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }

		if (device.type === 'CAMERA') {
			this.wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
			bus.emit('camera:update', value)
		} else if (device.type === 'FOCUSER') {
			this.wsm.send<FocuserUpdated>({ type: 'focuser:update', device: value, property, state })
			bus.emit('focuser:update', value)
		}

		this.wsm.send<ThermometerUpdated>({ type: 'thermometer:update', device: value, property, state })
		bus.emit('thermometer:update', value)
	}

	add(device: Thermometer) {
		this.thermometers.set(device.name, device)
		this.wsm.send<ThermometerAdded>({ type: 'thermometer:add', device })
		bus.emit('thermometer:add', device)
		console.info('thermometer added:', device.name)
	}

	has(device: Thermometer) {
		return this.thermometers.has(device.name)
	}

	remove(device: Thermometer) {
		if (this.thermometers.has(device.name) && device.hasThermometer) {
			device.hasThermometer = false
			this.update(device, 'hasThermometer')

			this.thermometers.delete(device.name)

			this.wsm.send<ThermometerRemoved>({ type: 'thermometer:remove', device })
			bus.emit('thermometer:remove', device)
			console.info('thermometer removed:', device.name)
		}
	}

	list() {
		return Array.from(this.thermometers.values())
	}

	get(id: string) {
		return this.thermometers.get(id)
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
