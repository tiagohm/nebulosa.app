import Elysia from 'elysia'
import type { Rotator } from 'nebulosa/src/indi.device'
import type { DeviceHandler, RotatorManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function rotator(wsm: WebSocketMessageHandler, rotatorManager: RotatorManager) {
	function rotatorFromParams(clientId: string, id: string) {
		return rotatorManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<Rotator> = {
		added: (device: Rotator) => {
			wsm.send<RotatorAdded>('rotator:add', { device })
			console.info('rotator added:', device.name)
		},
		updated: (device: Rotator, property: keyof Rotator & string, state?: PropertyState) => {
			wsm.send<RotatorUpdated>('rotator:update', { device: { name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Rotator) => {
			wsm.send<RotatorRemoved>('rotator:remove', { device })
			console.info('rotator removed:', device.name)
		},
	}

	rotatorManager.addHandler(handler)

	const app = new Elysia({ prefix: '/rotators' })
		// Endpoints!
		.get('', ({ query }) => Array.from(rotatorManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => rotatorFromParams(query.clientId, params.id))
		.post('/:id/moveto', ({ params, query, body }) => rotatorManager.moveTo(rotatorFromParams(query.clientId, params.id), body as never))
		.post('/:id/sync', ({ params, query, body }) => rotatorManager.syncTo(rotatorFromParams(query.clientId, params.id), body as never))
		.post('/:id/home', ({ params, query }) => rotatorManager.home(rotatorFromParams(query.clientId, params.id)))
		.post('/:id/reverse', ({ params, query, body }) => rotatorManager.reverse(rotatorFromParams(query.clientId, params.id), body as never))
		.post('/:id/stop', ({ params, query }) => rotatorManager.stop(rotatorFromParams(query.clientId, params.id)))

	return app
}
