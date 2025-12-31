import Elysia from 'elysia'
import type { Cover } from 'nebulosa/src/indi.device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function cover(wsm: WebSocketMessageHandler, coverManager: CoverManager) {
	function coverFromParams(params: { id: string }) {
		return coverManager.get(decodeURIComponent(params.id))!
	}

	const handler: DeviceHandler<Cover> = {
		added: (device: Cover) => {
			wsm.send<CoverAdded>('cover:add', { device })
			console.info('cover added:', device.name)
		},
		updated: (device: Cover, property: keyof Cover & string, state?: PropertyState) => {
			wsm.send<CoverUpdated>('cover:update', { device: { name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Cover) => {
			wsm.send<CoverRemoved>('cover:remove', { device })
			console.info('cover removed:', device.name)
		},
	}

	coverManager.addHandler(handler)

	const app = new Elysia({ prefix: '/covers' })
		// Endpoints!
		.get('', () => coverManager.list())
		.get('/:id', ({ params }) => coverFromParams(params))
		.post('/:id/park', ({ params }) => coverManager.park(coverFromParams(params)))
		.post('/:id/stop', ({ params }) => coverManager.stop(coverFromParams(params)))
		.post('/:id/unpark', ({ params }) => coverManager.unpark(coverFromParams(params)))

	return app
}
