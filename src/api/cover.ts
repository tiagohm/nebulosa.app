import Elysia from 'elysia'
import type { DefNumberVector, DefSwitchVector, DefTextVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import { type Cover, type CoverAdded, type CoverRemoved, type CoverUpdated, DEFAULT_COVER } from '../shared/types'
import type { ConnectionManager } from './connection'
import type { DewHeaterManager } from './dewheater'
import { ask, connectionFor, DeviceInterfaceType, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'

export function unpark(client: IndiClient, device: Cover) {
	if (device.canPark) {
		client.sendSwitch({ device: device.name, name: 'CAP_PARK', elements: { UNPARK: true } })
	}
}

export function park(client: IndiClient, device: Cover) {
	if (device.canPark) {
		client.sendSwitch({ device: device.name, name: 'CAP_PARK', elements: { PARK: true } })
	}
}

export class CoverManager implements IndiClientHandler {
	private readonly covers = new Map<string, Cover>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly dewHeater: DewHeaterManager,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all covers associated with the client
			this.covers.forEach((device) => this.remove(device))
		})
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.covers.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'CONNECTION':
				if (connectionFor(client, device, message)) {
					if (this.dewHeater.has(device)) {
						this.dewHeater.update(device, 'connected', message.state)
					} else {
						this.update(device, 'connected', message.state)
					}

					if (!device.connected) {
						this.dewHeater.remove(device)
					}
				}

				return
			case 'CAP_PARK': {
				if (tag[0] === 'd') {
					const canPark = (message as DefSwitchVector).permission !== 'ro'

					if (device.canPark !== canPark) {
						device.canPark = canPark
						this.update(device, 'canPark', message.state)
					}
				}

				const parking = message.state === 'Busy'

				if (parking !== device.parking) {
					device.parking = parking
					this.update(device, 'parking', message.state)
				}

				const parked = message.elements.PARK?.value === true

				if (parked !== device.parked) {
					device.parked = parked
					this.update(device, 'parked', message.state)
				}

				return
			}
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.covers.get(message.device)

		if (!device) return

		switch (message.name) {
			// WandererCover V4 EC
			case 'Heater':
				if (tag[0] === 'd' && !device.hasDewHeater) {
					device.hasDewHeater = true
					this.update(device, 'hasDewHeater', message.state)

					const { min, max, value } = (message as DefNumberVector).elements.Heater
					device.pwm.min = min
					device.pwm.max = max
					device.pwm.value = value
					this.update(device, 'pwm', message.state)

					this.dewHeater.add(device)
				}

				return
		}
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = +message.elements.DRIVER_INTERFACE!.value

			if (isInterfaceType(type, DeviceInterfaceType.DUSTCAP)) {
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!this.covers.has(message.device)) {
					const cover: Cover = { ...structuredClone(DEFAULT_COVER), id: message.device, name: message.device, driver: { executable, version } }
					this.add(cover)
					ask(client, cover)
				}
			} else if (this.covers.has(message.device)) {
				this.remove(this.covers.get(message.device)!)
			}

			return
		}

		const device = this.covers.get(message.device)

		if (!device) return
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.covers.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: Cover, property: keyof Cover, state?: PropertyState) {
		this.wsm.send<CoverUpdated>('cover:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	add(device: Cover) {
		this.covers.set(device.name, device)

		this.wsm.send<CoverAdded>('cover:add', { device })
		console.info('cover added:', device.name)
	}

	has(device: Cover) {
		return this.covers.has(device.name)
	}

	remove(device: Cover) {
		if (this.covers.has(device.name)) {
			this.covers.delete(device.name)

			// TODO: Call it on deleteProperty
			this.dewHeater.remove(device)

			this.wsm.send<CoverRemoved>('cover:remove', { device })
			console.info('cover removed:', device.name)
		}
	}

	list() {
		return Array.from(this.covers.values())
	}

	get(id: string) {
		return this.covers.get(id)
	}
}

export function cover(cover: CoverManager, connection: ConnectionManager) {
	function coverFromParams(params: { id: string }) {
		return cover.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/covers' })
		// Endpoints!
		.get('', () => cover.list())
		.get('/:id', ({ params }) => coverFromParams(params))
		.post('/:id/park', ({ params }) => park(connection.get(), coverFromParams(params)))
		.post('/:id/unpark', ({ params }) => unpark(connection.get(), coverFromParams(params)))

	return app
}
