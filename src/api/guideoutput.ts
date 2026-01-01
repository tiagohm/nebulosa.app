import Elysia from 'elysia'
import type { GuideOutput } from 'nebulosa/src/indi.device'
import type { DeviceHandler, GuideOutputManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CameraUpdated, GuideOutputAdded, GuideOutputRemoved, GuideOutputUpdated, GuidePulse, MountUpdated } from '../shared/types'
import type { WebSocketMessageHandler } from './message'

export function guideOutput(wsm: WebSocketMessageHandler, guideOutputManager: GuideOutputManager) {
	function guideOutputFromParams(clientId: string, id: string) {
		return guideOutputManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<GuideOutput> = {
		added: (device: GuideOutput) => {
			wsm.send<GuideOutputAdded>('guideOutput:add', { device })
			console.info('guide output added:', device.name)
		},
		updated: (device: GuideOutput, property: keyof GuideOutput & string, state?: PropertyState) => {
			const event = { device: { name: device.name, [property]: device[property] }, property, state }

			if (device.type === 'CAMERA') wsm.send<CameraUpdated>('camera:update', event)
			else if (device.type === 'MOUNT') wsm.send<MountUpdated>('mount:update', event)
			wsm.send<GuideOutputUpdated>('guideOutput:update', event)
		},
		removed: (device: GuideOutput) => {
			wsm.send<GuideOutputRemoved>('guideOutput:remove', { device })
			console.info('guide output removed:', device.name)
		},
	}

	guideOutputManager.addHandler(handler)

	const app = new Elysia({ prefix: '/guideoutputs' })
		// Endpoints!
		.get('', ({ query }) => Array.from(guideOutputManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => guideOutputFromParams(query.clientId, params.id))
		.post('/:id/pulse', ({ params, query, body }) => guideOutputManager.pulse(guideOutputFromParams(query.clientId, params.id), (body as GuidePulse).direction, (body as GuidePulse).duration))

	return app
}
