import { getDefaultInjector, molecule } from 'bunshi'
import Elysia from 'elysia'
import type { DefNumberVector, IndiClient, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import { BusMolecule } from '../shared/bus'
import type { CameraUpdated, GuideOutput, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '../shared/types'
import { ConnectionMolecule } from './connection'
import { WebSocketMessageMolecule } from './message'

const injector = getDefaultInjector()

// Pulses the guide output towards the north direction for the given duration
export function pulseNorth(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_N: duration, TIMED_GUIDE_S: 0 } })
	}
}

// Pulses the guide output towards the south direction for the given duration
export function pulseSouth(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_S: duration, TIMED_GUIDE_N: 0 } })
	}
}

// Pulses the guide output towards the west direction for the given duration
export function pulseWest(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_W: duration, TIMED_GUIDE_E: 0 } })
	}
}

// Pulses the guide output towards the east direction for the given duration
export function pulseEast(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_E: duration, TIMED_GUIDE_W: 0 } })
	}
}

// Molecule for managing guide output devices
export const GuideOutputMolecule = molecule((m) => {
	const bus = m(BusMolecule)
	const wsm = m(WebSocketMessageMolecule)

	const guideOutputs = new Map<string, GuideOutput>()

	bus.subscribe('indi:close', (client: IndiClient) => {
		// Remove all guide outputs associated with the client
		guideOutputs.forEach((device) => remove(device))
	})

	// Handles incoming number vector messages.
	function numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = guideOutputs.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE':
				if (device.canPulseGuide) {
					const pulseGuiding = message.state === 'Busy'

					if (pulseGuiding !== device.pulseGuiding) {
						device.pulseGuiding = pulseGuiding
						sendUpdate(device, 'pulseGuiding', message.state)
					}
				}

				return
		}
	}

	// Sends an update for a guide output device
	function sendUpdate(device: GuideOutput, property: keyof GuideOutput, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		if (device.type === 'CAMERA') wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
		wsm.send<GuideOutputUpdated>({ type: 'guideOutput:update', device: value, property, state })
		bus.emit('guideOutput:update', value)
	}

	// Adds a guide output device
	function add(device: GuideOutput) {
		guideOutputs.set(device.name, device)

		wsm.send<GuideOutputAdded>({ type: 'guideOutput:add', device })
		bus.emit('guideOutput:add', device)
	}

	// Removes a guide output device
	function remove(device: GuideOutput) {
		if (guideOutputs.has(device.name)) {
			guideOutputs.delete(device.name)

			device.canPulseGuide = false
			sendUpdate(device, 'canPulseGuide')

			wsm.send<GuideOutputRemoved>({ type: 'guideOutput:remove', device })
			bus.emit('guideOutput:remove', device)
		}
	}

	// Lists all guide output devices
	function list() {
		return Array.from(guideOutputs.values())
	}

	// Gets a guide output device by its id
	function get(id: string) {
		return guideOutputs.get(id)
	}

	// Pulses the guide output towards the specified direction for the given duration
	function pulse(client: IndiClient, device: GuideOutput, req: GuidePulse) {
		if (req.direction === 'NORTH') pulseNorth(client, device, req.duration)
		else if (req.direction === 'SOUTH') pulseSouth(client, device, req.duration)
		else if (req.direction === 'WEST') pulseWest(client, device, req.duration)
		else if (req.direction === 'EAST') pulseEast(client, device, req.duration)
	}

	// The endpoints for managing guide outputs
	const app = new Elysia({ prefix: '/guide-outputs' })

	app.get('', () => {
		return list()
	})

	app.get('/:id', ({ params }) => {
		return get(decodeURIComponent(params.id))
	})

	app.post('/:id/pulse', ({ params, body }) => {
		const connection = injector.get(ConnectionMolecule)
		return pulse(connection.get(), get(decodeURIComponent(params.id))!, body as GuidePulse)
	})

	return { numberVector, add, remove, list, get, pulse, app } as const
})
