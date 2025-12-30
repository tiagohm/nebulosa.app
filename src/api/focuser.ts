import Elysia from 'elysia'
import type { Focuser } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FocuserManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function focuser(wsm: WebSocketMessageHandler, focuser: FocuserManager) {
	function focuserFromParams(params: { id: string }) {
		return focuser.get(decodeURIComponent(params.id))!
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

	focuser.addHandler(handler)

	const app = new Elysia({ prefix: '/focusers' })
		// Endpoints!
		.get('', () => focuser.list())
		.get('/:id', ({ params }) => focuserFromParams(params))
		.post('/:id/moveto', ({ params, body }) => focuser.moveTo(focuserFromParams(params), body as never))
		.post('/:id/movein', ({ params, body }) => focuser.moveIn(focuserFromParams(params), body as never))
		.post('/:id/moveout', ({ params, body }) => focuser.moveOut(focuserFromParams(params), body as never))
		.post('/:id/sync', ({ params, body }) => focuser.syncTo(focuserFromParams(params), body as never))
		.post('/:id/reverse', ({ params, body }) => focuser.reverse(focuserFromParams(params), body as never))
		.post('/:id/stop', ({ params }) => focuser.stop(focuserFromParams(params)))

	return app
}
