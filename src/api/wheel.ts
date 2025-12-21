import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Wheel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/indi.manager'
import type { WheelAdded, WheelRemoved, WheelUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export function wheel(wsm: WebSocketMessageHandler, wheelManager: WheelManager, connectionHandler: ConnectionHandler) {
	function wheelFromParams(params: { id: string }) {
		return wheelManager.get(decodeURIComponent(params.id))!
	}

	const handler: DeviceHandler<Wheel> = {
		added: (client: IndiClient, device: Wheel) => {
			wsm.send<WheelAdded>('wheel:add', { device })
			console.info('wheel added:', device.name)
		},
		updated: (client: IndiClient, device: Wheel, property: keyof Wheel, state?: PropertyState) => {
			wsm.send<WheelUpdated>('wheel:update', { device: { name: device.name, [property]: device[property] }, property, state })
		},
		removed: (client: IndiClient, device: Wheel) => {
			wsm.send<WheelRemoved>('wheel:remove', { device })
			console.info('wheel removed:', device.name)
		},
	}

	wheelManager.addHandler(handler)

	const app = new Elysia({ prefix: '/wheels' })
		// Endpoints!
		.get('', () => wheelManager.list())
		.get('/:id', ({ params }) => wheelFromParams(params))
		.post('/:id/moveto', ({ params, body }) => wheelManager.moveTo(connectionHandler.get(), wheelFromParams(params), body as never))
		.post('/:id/slots', ({ params, body }) => wheelManager.slots(connectionHandler.get(), wheelFromParams(params), body as never))

	return app
}
