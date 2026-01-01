import Elysia from 'elysia'
import type { Cover } from 'nebulosa/src/indi.device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function cover(wsm: WebSocketMessageHandler, coverManager: CoverManager) {
	function coverFromParams(clientId: string, id: string) {
		return coverManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<Cover> = {
		added: (device: Cover) => {
			wsm.send<CoverAdded>('cover:add', { device })
			console.info('cover added:', device.name)
		},
		updated: (device: Cover, property: keyof Cover & string, state?: PropertyState) => {
			wsm.send<CoverUpdated>('cover:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Cover) => {
			wsm.send<CoverRemoved>('cover:remove', { device })
			console.info('cover removed:', device.name)
		},
	}

	coverManager.addHandler(handler)

	const app = new Elysia({ prefix: '/covers' })
		// Endpoints!
		.get('', ({ query }) => Array.from(coverManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => coverFromParams(query.clientId, params.id))
		.post('/:id/park', ({ params, query }) => coverManager.park(coverFromParams(query.clientId, params.id)))
		.post('/:id/stop', ({ params, query }) => coverManager.stop(coverFromParams(query.clientId, params.id)))
		.post('/:id/unpark', ({ params, query }) => coverManager.unpark(coverFromParams(query.clientId, params.id)))

	return app
}
