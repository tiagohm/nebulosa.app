import Elysia from 'elysia'
import type { DefNumberVector, DefSwitchVector, DefTextVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import bus from 'src/shared/bus'
import { DEFAULT_WHEEL, type Wheel, type WheelAdded, type WheelRemoved, type WheelUpdated } from 'src/shared/types'
import type { ConnectionManager } from './connection'
import { ask, connectionFor, DeviceInterfaceType, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'

export function moveTo(client: IndiClient, wheel: Wheel, value: number) {
	client.sendNumber({ device: wheel.name, name: 'FILTER_SLOT', elements: { FILTER_SLOT_VALUE: value + 1 } })
}

export function slots(client: IndiClient, wheel: Wheel, names: string[]) {
	const elements: Record<string, string> = {}
	names.forEach((name, index) => (elements[`FILTER_SLOT_NAME_${index + 1}`] = name))
	client.sendText({ device: wheel.name, name: 'FILTER_NAME', elements })
}

export class WheelManager implements IndiClientHandler {
	private readonly wheels = new Map<string, Wheel>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all wheels associated with the client
			this.wheels.forEach((device) => this.remove(device))
		})
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.wheels.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'CONNECTION':
				if (connectionFor(client, device, message)) {
					this.update(device, 'connected', message.state)
				}

				return
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.wheels.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'FILTER_SLOT': {
				const value = message.elements.FILTER_SLOT_VALUE.value - 1

				if (device.position !== value) {
					device.position = value
					this.update(device, 'position', message.state)
				}

				const moving = message.state === 'Busy'

				if (device.moving !== moving) {
					device.moving = moving
					this.update(device, 'moving', message.state)
				}

				return
			}
		}
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = +message.elements.DRIVER_INTERFACE!.value

			if (isInterfaceType(type, DeviceInterfaceType.FILTER)) {
				if (!this.wheels.has(message.device)) {
					const executable = message.elements.DRIVER_EXEC!.value
					const version = message.elements.DRIVER_VERSION!.value

					const wheel: Wheel = { ...structuredClone(DEFAULT_WHEEL), id: message.device, name: message.device, driver: { executable, version } }
					this.add(wheel)
					ask(client, wheel)
				}
			} else if (this.wheels.has(message.device)) {
				this.remove(this.wheels.get(message.device)!)
			}

			return
		}

		const device = this.wheels.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'FILTER_NAME': {
				const slots = Object.values(message.elements)

				if (slots.length !== device.slots.length || slots.some((e, index) => e.value !== device.slots[index])) {
					device.slots = slots.map((e) => e.value)
					this.update(device, 'slots', message.state)
				}

				return
			}
		}
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.wheels.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: Wheel, property: keyof Wheel, state?: PropertyState) {
		this.wsm.send<WheelUpdated>('wheel:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	add(device: Wheel) {
		this.wheels.set(device.name, device)
		this.wsm.send<WheelAdded>('wheel:add', { device })
		console.info('wheel added:', device.name)
	}

	has(device: Wheel) {
		return this.wheels.has(device.name)
	}

	remove(device: Wheel) {
		if (this.wheels.has(device.name)) {
			this.wheels.delete(device.name)

			this.wsm.send<WheelRemoved>('wheel:remove', { device })
			console.info('wheel removed:', device.name)
		}
	}

	list() {
		return Array.from(this.wheels.values())
	}

	get(id: string) {
		return this.wheels.get(id)
	}
}

export function wheel(wheel: WheelManager, connection: ConnectionManager) {
	function wheelFromParams(params: { id: string }) {
		return wheel.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/wheels' })
		// Endpoints!
		.get('', () => wheel.list())
		.get('/:id', ({ params }) => wheelFromParams(params))
		.post('/:id/moveto', ({ params, body }) => moveTo(connection.get(), wheelFromParams(params), body as never))
		.post('/:id/slots', ({ params, body }) => slots(connection.get(), wheelFromParams(params), body as never))

	return app
}
