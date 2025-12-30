import Elysia from 'elysia'
import type { Rotator } from 'nebulosa/src/indi.device'
import type { DeviceHandler, RotatorManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function rotator(wsm: WebSocketMessageHandler, rotator: RotatorManager) {
	function rotatorFromParams(params: { id: string }) {
		return rotator.get(decodeURIComponent(params.id))!
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

	rotator.addHandler(handler)

	const app = new Elysia({ prefix: '/rotators' })
		// Endpoints!
		.get('', () => rotator.list())
		.get('/:id', ({ params }) => rotatorFromParams(params))
		.post('/:id/moveto', ({ params, body }) => rotator.moveTo(rotatorFromParams(params), body as never))
		.post('/:id/sync', ({ params, body }) => rotator.syncTo(rotatorFromParams(params), body as never))
		.post('/:id/home', ({ params }) => rotator.home(rotatorFromParams(params)))
		.post('/:id/reverse', ({ params, body }) => rotator.reverse(rotatorFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => rotator.stop(rotatorFromParams(params)))

	return app
}
