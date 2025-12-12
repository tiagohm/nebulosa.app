import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { GuideOutput } from 'nebulosa/src/indi.device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/indi.manager'
import type { CameraUpdated, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse, MountUpdated } from '../shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class GuideOutputHandler implements DeviceHandler<GuideOutput> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: GuideOutput) {
		this.wsm.send<GuideOutputAdded>('guideOutput:add', { device })
		console.info('guide output added:', device.name)
	}

	updated(client: IndiClient, device: GuideOutput, property: keyof GuideOutput, state?: PropertyState) {
		const event = { device: { name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'CAMERA') this.wsm.send<CameraUpdated>('camera:update', event)
		else if (device.type === 'MOUNT') this.wsm.send<MountUpdated>('mount:update', event)
		this.wsm.send<GuideOutputUpdated>('guideOutput:update', event)
	}

	removed(client: IndiClient, device: GuideOutput) {
		this.wsm.send<GuideOutputRemoved>('guideOutput:remove', { device })
		console.info('guide output removed:', device.name)
	}
}

export function guideOutput(guideOutput: GuideOutputManager, connection: ConnectionHandler) {
	function guideOutputFromParams(params: { id: string }) {
		return guideOutput.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/guideoutputs' })
		// Endpoints!
		.get('', () => guideOutput.list())
		.get('/:id', ({ params }) => guideOutputFromParams(params))
		.post('/:id/pulse', ({ params, body }) => guideOutput.pulse(connection.get(), guideOutputFromParams(params), (body as GuidePulse).direction, (body as GuidePulse).duration))

	return app
}
