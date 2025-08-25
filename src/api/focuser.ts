import Elysia from 'elysia'
import type { DefNumberVector, DefSwitchVector, DefTextVector, IndiClient, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import bus from 'src/shared/bus'
import { DEFAULT_FOCUSER, type Focuser, type FocuserAdded, type FocuserRemoved, type FocuserUpdated } from 'src/shared/types'
import type { ConnectionManager } from './connection'
import { ask, connectionFor, DeviceInterfaceType, type IndiDevicePropertyManager, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'
import type { ThermometerManager } from './thermometer'

export function stop(client: IndiClient, focuser: Focuser) {
	if (focuser.canAbort) {
		client.sendSwitch({ device: focuser.name, name: 'FOCUS_ABORT_MOTION', elements: { ABORT: true } })
	}
}

export function moveIn(client: IndiClient, focuser: Focuser, value: number) {
	if (focuser.canRelativeMove) {
		client.sendSwitch({ device: focuser.name, name: 'FOCUS_MOTION', elements: { FOCUS_INWARD: true } })
		client.sendNumber({ device: focuser.name, name: 'REL_FOCUS_POSITION', elements: { FOCUS_RELATIVE_POSITION: value } })
	}
}

export function moveOut(client: IndiClient, focuser: Focuser, value: number) {
	if (focuser.canRelativeMove) {
		client.sendSwitch({ device: focuser.name, name: 'FOCUS_MOTION', elements: { FOCUS_OUTWARD: true } })
		client.sendNumber({ device: focuser.name, name: 'REL_FOCUS_POSITION', elements: { FOCUS_RELATIVE_POSITION: value } })
	}
}

export function moveTo(client: IndiClient, focuser: Focuser, value: number) {
	if (focuser.canAbsoluteMove) {
		client.sendNumber({ device: focuser.name, name: 'ABS_FOCUS_POSITION', elements: { FOCUS_ABSOLUTE_POSITION: value } })
	}
}

export function sync(client: IndiClient, focuser: Focuser, value: number) {
	if (focuser.canSync) {
		client.sendNumber({ device: focuser.name, name: 'FOCUS_SYNC', elements: { FOCUS_SYNC_VALUE: value } })
	}
}

export function reverse(client: IndiClient, focuser: Focuser, enabled: boolean) {
	if (focuser.canSync) {
		client.sendSwitch({ device: focuser.name, name: 'FOCUS_REVERSE_MOTION', elements: { [enabled ? 'INDI_ENABLED' : 'INDI_DISABLED']: true } })
	}
}

export class FocuserManager {
	private readonly focusers = new Map<string, Focuser>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly thermometer: ThermometerManager,
		readonly properties: IndiDevicePropertyManager,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all focusers associated with the client
			this.focusers.forEach((device) => this.remove(device))
		})
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.focusers.get(message.device)

		if (!device) return

		this.properties.add(device, message, tag)

		switch (message.name) {
			case 'CONNECTION':
				if (connectionFor(client, device, message)) {
					if (this.thermometer.has(device)) {
						this.thermometer.update(device, 'connected', message.state)
					} else {
						this.update(device, 'connected', message.state)
					}

					if (!device.connected) {
						this.thermometer.remove(device)
					}
				}

				return
			case 'FOCUS_ABORT_MOTION':
				if (tag[0] === 'd' && !device.canAbort) {
					device.canAbort = true
					this.update(device, 'canAbort', message.state)
				}

				return
			case 'FOCUS_REVERSE_MOTION': {
				if (tag[0] === 'd' && !device.canReverse) {
					device.canReverse = true
					this.update(device, 'canReverse', message.state)
				}

				const reversed = message.elements.INDI_ENABLED?.value === true

				if (device.reversed !== reversed) {
					device.reversed = reversed
					this.update(device, 'reversed', message.state)
				}

				return
			}
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.focusers.get(message.device)

		if (!device) return

		this.properties.add(device, message, tag)

		switch (message.name) {
			case 'FOCUS_TEMPERATURE':
				if (tag[0] === 'd' && !device.hasThermometer) {
					device.hasThermometer = true
					this.update(device, 'hasThermometer', message.state)
					this.thermometer.add(device)
				}

				return
			case 'FOCUS_SYNC':
				if (tag[0] === 'd' && !device.canSync) {
					device.canSync = true
					this.update(device, 'canSync', message.state)
				}
				return
			case 'REL_FOCUS_POSITION': {
				if (tag[0] === 'd' && !device.canRelativeMove) {
					device.canRelativeMove = true
					this.update(device, 'canRelativeMove', message.state)
				}

				const moving = message.state === 'Busy'

				if (moving !== device.moving) {
					device.moving = moving
					this.update(device, 'moving', message.state)
				}

				return
			}
			case 'ABS_FOCUS_POSITION': {
				if (tag[0] === 'd') {
					if (!device.canAbsoluteMove) {
						device.canAbsoluteMove = true
						this.update(device, 'canAbsoluteMove', message.state)
					}

					const { min, max, value } = (message as DefNumberVector).elements.FOCUS_ABSOLUTE_POSITION

					if (device.position.min !== min || device.position.max !== max || device.position.value !== value) {
						device.position.min = min
						device.position.max = max
						device.position.value = value
						this.update(device, 'position', message.state)
					}
				} else {
					const position = message.elements.FOCUS_ABSOLUTE_POSITION.value

					if (device.position.value !== position) {
						device.position.value = position
						this.update(device, 'position', message.state)
					}
				}

				const moving = message.state === 'Busy'

				if (moving !== device.moving) {
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

			if (isInterfaceType(type, DeviceInterfaceType.FOCUSER)) {
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!this.focusers.has(message.device)) {
					const focuser: Focuser = { ...structuredClone(DEFAULT_FOCUSER), id: message.device, name: message.device, driver: { executable, version } }
					this.add(focuser)
					this.properties.add(focuser, message, tag, false)
					ask(client, focuser)
				}
			} else if (this.focusers.has(message.device)) {
				this.remove(this.focusers.get(message.device)!)
			}

			return
		}

		const device = this.focusers.get(message.device)

		if (!device) return

		this.properties.add(device, message, tag)
	}

	update(device: Focuser, property: keyof Focuser, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		this.wsm.send<FocuserUpdated>({ type: 'focuser:update', device: value, property, state })
		bus.emit('focuser:update', value)
	}

	add(device: Focuser) {
		this.focusers.set(device.name, device)
		this.wsm.send<FocuserAdded>({ type: 'focuser:add', device })
		bus.emit('focuser:add', device)
		console.info('focuser added:', device.name)
	}

	has(device: Focuser) {
		return this.focusers.has(device.name)
	}

	remove(device: Focuser) {
		if (this.focusers.has(device.name)) {
			this.focusers.delete(device.name)

			// TODO: Call it on deleteProperty
			this.thermometer.remove(device)

			this.wsm.send<FocuserRemoved>({ type: 'focuser:remove', device })
			bus.emit('focuser:remove', device)
			console.info('focuser removed:', device.name)
		}
	}

	list() {
		return Array.from(this.focusers.values())
	}

	get(id: string) {
		return this.focusers.get(id)
	}
}

export function focuser(focuser: FocuserManager, connection: ConnectionManager) {
	function focuserFromParams(params: { id: string }) {
		return focuser.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/focusers' })
		// Endpoints!
		.get('', () => focuser.list())
		.get('/:id', ({ params }) => focuserFromParams(params))
		.post('/:id/moveto', ({ params, body }) => moveTo(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/movein', ({ params, body }) => moveIn(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/moveout', ({ params, body }) => moveOut(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/sync', ({ params, body }) => sync(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/reverse', ({ params, body }) => reverse(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => stop(connection.get(), focuserFromParams(params)))

	return app
}
