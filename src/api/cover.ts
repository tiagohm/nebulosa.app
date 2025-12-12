import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Cover } from 'nebulosa/src/indi.device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/indi.manager'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class CoverHandler implements DeviceHandler<Cover> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: Cover) {
		this.wsm.send<CoverAdded>('cover:add', { device })
		console.info('cover added:', device.name)
	}

	updated(client: IndiClient, device: Cover, property: keyof Cover, state?: PropertyState) {
		this.wsm.send<CoverUpdated>('cover:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	removed(client: IndiClient, device: Cover) {
		this.wsm.send<CoverRemoved>('cover:remove', { device })
		console.info('cover removed:', device.name)
	}
}

export function cover(cover: CoverManager, connection: ConnectionHandler) {
	function coverFromParams(params: { id: string }) {
		return cover.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/covers' })
		// Endpoints!
		.get('', () => cover.list())
		.get('/:id', ({ params }) => coverFromParams(params))
		.post('/:id/park', ({ params }) => cover.park(connection.get(), coverFromParams(params)))
		.post('/:id/unpark', ({ params }) => cover.unpark(connection.get(), coverFromParams(params)))

	return app
}
