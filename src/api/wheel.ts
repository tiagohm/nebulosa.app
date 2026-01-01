import Elysia from 'elysia'
import type { Wheel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { WheelAdded, WheelRemoved, WheelUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function wheel(wsm: WebSocketMessageHandler, wheelManager: WheelManager) {
	function wheelFromParams(clientId: string, id: string) {
		return wheelManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<Wheel> = {
		added: (device: Wheel) => {
			wsm.send<WheelAdded>('wheel:add', { device })
			console.info('wheel added:', device.name)
		},
		updated: (device: Wheel, property: keyof Wheel & string, state?: PropertyState) => {
			wsm.send<WheelUpdated>('wheel:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: Wheel) => {
			wsm.send<WheelRemoved>('wheel:remove', { device })
			console.info('wheel removed:', device.name)
		},
	}

	wheelManager.addHandler(handler)

	const app = new Elysia({ prefix: '/wheels' })
		// Endpoints!
		.get('', ({ query }) => Array.from(wheelManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => wheelFromParams(query.clientId, params.id))
		.post('/:id/moveto', ({ params, query, body }) => wheelManager.moveTo(wheelFromParams(query.clientId, params.id), body as never))
		.post('/:id/slots', ({ params, query, body }) => wheelManager.slots(wheelFromParams(query.clientId, params.id), body as never))

	return app
}
