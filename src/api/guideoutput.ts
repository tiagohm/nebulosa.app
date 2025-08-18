import Elysia from 'elysia'
import type { DefNumberVector, IndiClient, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { CameraUpdated, GuideOutput, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from '../shared/types'
import type { ConnectionManager } from './connection'
import type { WebSocketMessageManager } from './message'

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

// Manager for handling guide output-related operations
export class GuideOutputManager {
	private readonly guideOutputs = new Map<string, GuideOutput>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all guide outputs associated with the client
			this.guideOutputs.forEach((device) => this.remove(device))
		})
	}

	// Handles incoming number vector messages.
	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.guideOutputs.get(message.device)

		if (!device) return

		switch (message.name) {
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE':
				if (device.canPulseGuide) {
					const pulseGuiding = message.state === 'Busy'

					if (pulseGuiding !== device.pulseGuiding) {
						device.pulseGuiding = pulseGuiding
						this.sendUpdate(device, 'pulseGuiding', message.state)
					}
				}

				return
		}
	}

	// Sends an update for a guide output device
	sendUpdate(device: GuideOutput, property: keyof GuideOutput, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		if (device.type === 'CAMERA') this.wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
		this.wsm.send<GuideOutputUpdated>({ type: 'guideOutput:update', device: value, property, state })
		bus.emit('guideOutput:update', value)
	}

	// Adds a guide output device
	add(device: GuideOutput) {
		this.guideOutputs.set(device.name, device)

		this.wsm.send<GuideOutputAdded>({ type: 'guideOutput:add', device })
		bus.emit('guideOutput:add', device)
		console.info('guide output added:', device.name)
	}

	// Removes a guide output device
	remove(device: GuideOutput) {
		if (this.guideOutputs.has(device.name)) {
			this.guideOutputs.delete(device.name)

			device.canPulseGuide = false
			this.sendUpdate(device, 'canPulseGuide')

			this.wsm.send<GuideOutputRemoved>({ type: 'guideOutput:remove', device })
			bus.emit('guideOutput:remove', device)
			console.info('guide output removed:', device.name)
		}
	}

	// Lists all guide output devices
	list() {
		return Array.from(this.guideOutputs.values())
	}

	// Gets a guide output device by its id
	get(id: string) {
		return this.guideOutputs.get(id)
	}

	// Pulses the guide output towards the specified direction for the given duration
	pulse(client: IndiClient, device: GuideOutput, req: GuidePulse) {
		if (req.direction === 'NORTH') pulseNorth(client, device, req.duration)
		else if (req.direction === 'SOUTH') pulseSouth(client, device, req.duration)
		else if (req.direction === 'WEST') pulseWest(client, device, req.duration)
		else if (req.direction === 'EAST') pulseEast(client, device, req.duration)
	}
}

// Endpoints for managing guide outputs-related requests
export function guideOutput(guideOutput: GuideOutputManager, connection: ConnectionManager) {
	function guideOutputFromParams(params: { id: string }) {
		return guideOutput.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/guideoutputs' })
		// Endpoints!
		.get('', () => guideOutput.list())
		.get('/:id', ({ params }) => guideOutputFromParams(params))
		.post('/:id/pulse', ({ params, body }) => guideOutput.pulse(connection.get(), guideOutputFromParams(params), body as GuidePulse))

	return app
}
