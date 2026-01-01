import Elysia from 'elysia'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function focuser(wsm: WebSocketMessageHandler, focuserManager: FocuserManager) {
	function focuserFromParams(clientId: string, id: string) {
		return focuserManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<Focuser> = {
		added: (device: Focuser) => {
			wsm.send<FocuserAdded>('focuser:add', { device })
			console.info('focuser added:', device.name)
		},
		updated: (device: Focuser, property: keyof Focuser & string, state?: PropertyState) => {
			wsm.send<FocuserUpdated>('focuser:update', { device: { name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Focuser) => {
			wsm.send<FocuserRemoved>('focuser:remove', { device })
			console.info('focuser removed:', device.name)
		},
	}

	focuserManager.addHandler(handler)

	const app = new Elysia({ prefix: '/focusers' })
		// Endpoints!
		.get('', ({ query }) => Array.from(focuserManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => focuserFromParams(query.clientId, params.id))
		.post('/:id/moveto', ({ params, query, body }) => focuserManager.moveTo(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/movein', ({ params, query, body }) => focuserManager.moveIn(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/moveout', ({ params, query, body }) => focuserManager.moveOut(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/sync', ({ params, query, body }) => focuserManager.syncTo(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/reverse', ({ params, query, body }) => focuserManager.reverse(focuserFromParams(query.clientId, params.id), body as never))
		.post('/:id/stop', ({ params, query }) => focuserManager.stop(focuserFromParams(query.clientId, params.id)))

	return app
}
