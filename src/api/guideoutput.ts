import Elysia from 'elysia'
import type { DefNumberVector, DelProperty, IndiClient, IndiClientHandler, PropertyState, SetNumberVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { CameraUpdated, GuideOutput, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse, MountUpdated } from '../shared/types'
import type { ConnectionManager } from './connection'
import type { WebSocketMessageManager } from './message'

export function pulseNorth(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_N: duration, TIMED_GUIDE_S: 0 } })
	}
}

export function pulseSouth(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_S: duration, TIMED_GUIDE_N: 0 } })
	}
}

export function pulseWest(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_W: duration, TIMED_GUIDE_E: 0 } })
	}
}

export function pulseEast(client: IndiClient, device: GuideOutput, duration: number) {
	if (device.canPulseGuide) {
		client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_E: duration, TIMED_GUIDE_W: 0 } })
	}
}

export class GuideOutputManager implements IndiClientHandler {
	private readonly guideOutputs = new Map<string, GuideOutput>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all guide outputs associated with the client
			this.guideOutputs.forEach((device) => this.remove(device))
		})
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.guideOutputs.get(message.device)

		if (!device || !device.canPulseGuide) return

		switch (message.name) {
			case 'TELESCOPE_TIMED_GUIDE_NS':
			case 'TELESCOPE_TIMED_GUIDE_WE': {
				const pulseGuiding = message.state === 'Busy'

				if (pulseGuiding !== device.pulseGuiding) {
					device.pulseGuiding = pulseGuiding
					this.update(device, 'pulseGuiding', message.state)
				}

				return
			}
		}
	}

	delProperty(client: IndiClient, message: DelProperty) {
		if (!message.name) {
			const device = this.guideOutputs.get(message.device)
			device && this.remove(device)
		}
	}

	update(device: GuideOutput, property: keyof GuideOutput, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }

		if (device.type === 'CAMERA') {
			this.wsm.send<CameraUpdated>({ type: 'camera:update', device: value, property, state })
			bus.emit('camera:update', value)
		} else if (device.type === 'MOUNT') {
			this.wsm.send<MountUpdated>({ type: 'mount:update', device: value, property, state })
			bus.emit('mount:update', value)
		}

		this.wsm.send<GuideOutputUpdated>({ type: 'guideOutput:update', device: value, property, state })
		bus.emit('guideOutput:update', value)
	}

	add(device: GuideOutput) {
		this.guideOutputs.set(device.name, device)

		this.wsm.send<GuideOutputAdded>({ type: 'guideOutput:add', device })
		bus.emit('guideOutput:add', device)
		console.info('guide output added:', device.name)
	}

	has(device: GuideOutput) {
		return this.guideOutputs.has(device.name)
	}

	remove(device: GuideOutput) {
		if (this.guideOutputs.has(device.name) && device.canPulseGuide) {
			device.canPulseGuide = false
			this.update(device, 'canPulseGuide')

			this.guideOutputs.delete(device.name)

			this.wsm.send<GuideOutputRemoved>({ type: 'guideOutput:remove', device })
			bus.emit('guideOutput:remove', device)
			console.info('guide output removed:', device.name)
		}
	}

	list() {
		return Array.from(this.guideOutputs.values())
	}

	get(id: string) {
		return this.guideOutputs.get(id)
	}

	pulse(client: IndiClient, device: GuideOutput, req: GuidePulse) {
		if (req.direction === 'NORTH') pulseNorth(client, device, req.duration)
		else if (req.direction === 'SOUTH') pulseSouth(client, device, req.duration)
		else if (req.direction === 'WEST') pulseWest(client, device, req.duration)
		else if (req.direction === 'EAST') pulseEast(client, device, req.duration)
	}
}

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
