import Elysia from 'elysia'
import type { DefNumberVector, IndiClient, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { CoverUpdated, DewHeater, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from '../shared/types'
import type { ConnectionManager } from './connection'
import type { WebSocketMessageManager } from './message'

export function pwm(client: IndiClient, device: DewHeater, value: number) {
	if (device.properties.Heater) {
		client.sendNumber({ device: device.name, name: 'Heater', elements: { Heater: value } })
	}
}

export class DewHeaterManager {
	private readonly dewHeaters = new Map<string, DewHeater>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all dew heaters associated with the client
			this.dewHeaters.forEach((device) => this.remove(device))
		})
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.dewHeaters.get(message.device)

		if (!device) return

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

	update(device: DewHeater, property: keyof DewHeater, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }

		if (device.type === 'COVER') {
			this.wsm.send<CoverUpdated>({ type: 'cover:update', device: value, property, state })
			bus.emit('cover:update', value)
		}

		this.wsm.send<DewHeaterUpdated>({ type: 'dewHeater:update', device: value, property, state })
		bus.emit('dewHeater:update', value)
	}

	add(device: DewHeater) {
		this.dewHeaters.set(device.name, device)

		this.wsm.send<DewHeaterAdded>({ type: 'dewHeater:add', device })
		bus.emit('dewHeater:add', device)
		console.info('dew heater added:', device.name)
	}

	remove(device: DewHeater) {
		if (this.dewHeaters.has(device.name) && device.hasDewHeater) {
			device.hasDewHeater = false
			this.update(device, 'hasDewHeater')

			this.dewHeaters.delete(device.name)

			this.wsm.send<DewHeaterRemoved>({ type: 'dewHeater:remove', device })
			bus.emit('dewHeater:remove', device)
			console.info('dew heater removed:', device.name)
		}
	}

	list() {
		return Array.from(this.dewHeaters.values())
	}

	get(id: string) {
		return this.dewHeaters.get(id)
	}

	pwm(client: IndiClient, device: DewHeater, value: number) {
		pwm(client, device, value)
	}
}

export function dewHeater(dewHeater: DewHeaterManager, connection: ConnectionManager) {
	function dewHeaterFromParams(params: { id: string }) {
		return dewHeater.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/dewheaters' })
		// Endpoints!
		.get('', () => dewHeater.list())
		.get('/:id', ({ params }) => dewHeaterFromParams(params))
		.post('/:id/pwm', ({ params, body }) => dewHeater.pwm(connection.get(), dewHeaterFromParams(params), (body as never) || 0))

	return app
}
