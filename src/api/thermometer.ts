import { molecule } from 'bunshi'
import Elysia from 'elysia'
import type { DefNumberVector, IndiClient, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import { BusMolecule } from '../shared/bus'
import type { CameraUpdated, Thermometer, ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from '../shared/types'
import { WebSocketMessageMolecule } from './message'

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
		if (device.type === 'CAMERA') wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
		wsm.send<ThermometerUpdated>({ type: 'thermometer:update', device: value, property, state })
		bus.emit('thermometer:update', value)
	}

	// Adds a thermometer device
	function add(device: Thermometer) {
		thermometers.set(device.name, device)
		wsm.send<ThermometerAdded>({ type: 'thermometer:add', device })
		bus.emit('thermometer:add', device)
		console.info('thermometer added:', device.name)
	}

	// Removes a thermometer device
	function remove(device: Thermometer) {
		if (thermometers.has(device.name)) {
			thermometers.delete(device.name)

			device.hasThermometer = false
			sendUpdate(device, 'hasThermometer')

			wsm.send<ThermometerRemoved>({ type: 'thermometer:remove', device })
			bus.emit('thermometer:remove', device)
			console.info('thermometer removed:', device.name)
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
