import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { ConnectionProvider } from './connection'
import { DeviceHandler, type IndiDeviceManager } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { GuideOutput, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse } from './types'

// Handler for managing guide output devices and their properties
export class GuideOutputHandler extends DeviceHandler<GuideOutput> {
	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {
		super()
	}

	deviceAdded(device: GuideOutput) {
		this.webSocketMessageHandler.send<GuideOutputAdded>({ type: 'guide_output.add', device })
	}

	deviceUpdated(device: GuideOutput, property: keyof GuideOutput, state?: PropertyState) {
		this.webSocketMessageHandler.send<GuideOutputUpdated>({ type: 'guide_output.update', device: device.name, property, value: device[property], state })
	}

	deviceRemoved(device: GuideOutput) {
		this.webSocketMessageHandler.send<GuideOutputRemoved>({ type: 'guide_output.remove', device })
	}

	guideNorth(client: IndiClient, device: GuideOutput, duration: number) {
		if (device.canPulseGuide) {
			client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_N: duration, TIMED_GUIDE_S: 0 } })
		}
	}

	guideSouth(client: IndiClient, device: GuideOutput, duration: number) {
		if (device.canPulseGuide) {
			client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_NS', elements: { TIMED_GUIDE_S: duration, TIMED_GUIDE_N: 0 } })
		}
	}

	guideWest(client: IndiClient, device: GuideOutput, duration: number) {
		if (device.canPulseGuide) {
			client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_W: duration, TIMED_GUIDE_E: 0 } })
		}
	}

	guideEast(client: IndiClient, device: GuideOutput, duration: number) {
		if (device.canPulseGuide) {
			client.sendNumber({ device: device.name, name: 'TELESCOPE_TIMED_GUIDE_WE', elements: { TIMED_GUIDE_E: duration, TIMED_GUIDE_W: 0 } })
		}
	}

	guide(client: IndiClient, device: GuideOutput, direction: string, duration: number) {
		if (direction === 'NORTH') this.guideNorth(client, device, duration)
		else if (direction === 'SOUTH') this.guideSouth(client, device, duration)
		else if (direction === 'WEST') this.guideWest(client, device, duration)
		else if (direction === 'EAST') this.guideEast(client, device, duration)
	}
}

// Manager for guide output operations
export class GuideOutputManager {
	constructor(
		private readonly handler: GuideOutputHandler,
		private readonly indi: IndiDeviceManager,
		private readonly connection: ConnectionProvider,
	) {}

	list() {
		return this.indi.guideOutputs()
	}

	get(id: string) {
		return this.indi.guideOutput(id)
	}

	pulse(id: string, req: GuidePulse) {
		this.handler.guide(this.connection.client(), this.get(id), req.direction, req.duration)
	}
}

// Creates an instance of Elysia with guide output endpoints
export function guideOutputs(guideOutput: GuideOutputManager) {
	const app = new Elysia({ prefix: '/guide-outputs' })

	app.get('', () => {
		return guideOutput.list()
	})

	app.get('/:id', ({ params }) => {
		return guideOutput.get(decodeURIComponent(params.id))
	})

	app.post('/:id/pulse', ({ params, body }) => {
		return guideOutput.pulse(decodeURIComponent(params.id), body as GuidePulse)
	})

	return app
}
