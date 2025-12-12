import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class FocuserHandler implements DeviceHandler<Focuser> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: Focuser) {
		this.wsm.send<FocuserAdded>('focuser:add', { device })
		console.info('focuser added:', device.name)
	}

	updated(client: IndiClient, device: Focuser, property: keyof Focuser, state?: PropertyState) {
		this.wsm.send<FocuserUpdated>('focuser:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	removed(client: IndiClient, device: Focuser) {
		this.wsm.send<FocuserRemoved>('focuser:remove', { device })
		console.info('focuser removed:', device.name)
	}
}

export function focuser(focuser: FocuserManager, connection: ConnectionHandler) {
	function focuserFromParams(params: { id: string }) {
		return focuser.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/focusers' })
		// Endpoints!
		.get('', () => focuser.list())
		.get('/:id', ({ params }) => focuserFromParams(params))
		.post('/:id/moveto', ({ params, body }) => focuser.moveTo(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/movein', ({ params, body }) => focuser.moveIn(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/moveout', ({ params, body }) => focuser.moveOut(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/sync', ({ params, body }) => focuser.sync(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/reverse', ({ params, body }) => focuser.reverse(connection.get(), focuserFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => focuser.stop(connection.get(), focuserFromParams(params)))

	return app
}
