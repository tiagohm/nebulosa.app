import { molecule } from 'bunshi'
import Elysia from 'elysia'
import type { DefNumberVector, IndiClient, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import { BusMolecule } from './bus'
import { WebSocketMessageMolecule } from './message'
import type { CameraUpdated, Thermometer, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from './types'

export const ThermometerMolecule = molecule((m) => {
	const bus = m(BusMolecule)
	const wsm = m(WebSocketMessageMolecule)

	const thermometers = new Map<string, Thermometer>()

	bus.subscribe('indi:close', (client: IndiClient) => {
		// Remove all thermometers associated with the client
		thermometers.forEach((device) => remove(device))
	})

	function numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = thermometers.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'CCD_TEMPERATURE':
				if (device.hasThermometer) {
					const temperature = message.elements.CCD_TEMPERATURE_VALUE!.value

					if (temperature !== device.temperature) {
						device.temperature = temperature
						sendUpdate(device, 'temperature', message.state)
					}
				}

				return
		}
	}

	// Sends an update for a thermometer device
	function sendUpdate(device: Thermometer, property: keyof Thermometer, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		if (device.type === 'CAMERA') wsm.send<CameraUpdated>({ type: 'CAMERA_UPDATE', device: value, property, state })
		wsm.send<ThermometerUpdated>({ type: 'THERMOMETER_UPDATE', device: value, property, state })
		bus.emit('thermometer:update', value)
	}

	// Adds a thermometer device
	function add(device: Thermometer) {
		thermometers.set(device.name, device)
		wsm.send<ThermometerAdded>({ type: 'THERMOMETER_ADD', device })
		bus.emit('thermometer:add', device)
	}

	// Removes a thermometer device
	function remove(device: Thermometer) {
		if (thermometers.has(device.name)) {
			thermometers.delete(device.name)

			device.hasThermometer = false
			sendUpdate(device, 'hasThermometer')

			wsm.send<ThermometerRemoved>({ type: 'THERMOMETER_REMOVE', device })
			bus.emit('thermometer:remove', device)
		}
	}

	// Lists all thermometer devices
	function list() {
		return Array.from(thermometers.values())
	}

	// Gets a thermometer device by its id
	function get(id: string) {
		return thermometers.get(id)
	}

	const app = new Elysia({ prefix: '/thermometers' })

	app.get('', () => {
		return list()
	})

	app.get('/:id', ({ params }) => {
		return get(decodeURIComponent(params.id))
	})

	return { numberVector, add, remove, list, get, app } as const
})
