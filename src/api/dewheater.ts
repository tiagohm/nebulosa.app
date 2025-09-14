import Elysia from 'elysia'
import type { DefNumberVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { CoverUpdated, DeviceProperties, DewHeater, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from '../shared/types'
import type { ConnectionManager } from './connection'
import type { IndiDevicePropertyManager } from './indi'
import type { WebSocketMessageManager } from './message'

export function pwm(client: IndiClient, device: DewHeater, value: number, properties: DeviceProperties) {
	if (properties.Heater) {
		client.sendNumber({ device: device.name, name: 'Heater', elements: { Heater: value } })
	}
}

export class DewHeaterManager implements IndiClientHandler {
	private readonly dewHeaters = new Map<string, DewHeater>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all dew heaters associated with the client
			this.dewHeaters.forEach((device) => this.remove(device))
		})
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.dewHeaters.get(message.device)

		if (!device || !device.hasDewHeater) return

		switch (message.name) {
			// WandererCover V4 EC
			case 'Heater': {
				const value = message.elements.Heater?.value ?? 0

				if (value !== device.pwm.value) {
					device.pwm.value = value
					this.update(device, 'pwm', message.state)
				}

				return
			}
		}
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.dewHeaters.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: DewHeater, property: keyof DewHeater, state?: PropertyState) {
		const event = { device: { name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'COVER') this.wsm.send<CoverUpdated>('cover:update', event)
		this.wsm.send<DewHeaterUpdated>('dewHeater:update', event)
	}

	add(device: DewHeater) {
		this.dewHeaters.set(device.name, device)

		this.wsm.send<DewHeaterAdded>('dewHeater:add', { device })
		console.info('dew heater added:', device.name)
	}

	has(device: DewHeater) {
		return this.dewHeaters.has(device.name)
	}

	remove(device: DewHeater) {
		if (this.dewHeaters.has(device.name) && device.hasDewHeater) {
			device.hasDewHeater = false
			this.update(device, 'hasDewHeater')

			this.dewHeaters.delete(device.name)

			this.wsm.send<DewHeaterRemoved>('dewHeater:remove', { device })
			console.info('dew heater removed:', device.name)
		}
	}

	list() {
		return Array.from(this.dewHeaters.values())
	}

	get(id: string) {
		return this.dewHeaters.get(id)
	}

	pwm(client: IndiClient, device: DewHeater, value: number, property: IndiDevicePropertyManager) {
		pwm(client, device, value, property.get(device)!)
	}
}

export function dewHeater(dewHeater: DewHeaterManager, connection: ConnectionManager, property: IndiDevicePropertyManager) {
	function dewHeaterFromParams(params: { id: string }) {
		return dewHeater.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/dewheaters' })
		// Endpoints!
		.get('', () => dewHeater.list())
		.get('/:id', ({ params }) => dewHeaterFromParams(params))
		.post('/:id/pwm', ({ params, body }) => dewHeater.pwm(connection.get(), dewHeaterFromParams(params), body as never, property))

	return app
}
