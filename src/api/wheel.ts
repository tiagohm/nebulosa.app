import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { Wheel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, WheelManager } from 'nebulosa/src/indi.manager'
import type { WheelAdded, WheelRemoved, WheelUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class WheelHandler implements DeviceHandler<Wheel> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: Wheel) {
		this.wsm.send<WheelAdded>('wheel:add', { device })
		console.info('wheel added:', device.name)
	}

	updated(client: IndiClient, device: Wheel, property: keyof Wheel, state?: PropertyState) {
		this.wsm.send<WheelUpdated>('wheel:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	removed(client: IndiClient, device: Wheel) {
		this.wsm.send<WheelRemoved>('wheel:remove', { device })
		console.info('wheel removed:', device.name)
	}
}

export function wheel(wheel: WheelManager, connection: ConnectionHandler) {
	function wheelFromParams(params: { id: string }) {
		return wheel.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/wheels' })
		// Endpoints!
		.get('', () => wheel.list())
		.get('/:id', ({ params }) => wheelFromParams(params))
		.post('/:id/moveto', ({ params, body }) => wheel.moveTo(connection.get(), wheelFromParams(params), body as never))
		.post('/:id/slots', ({ params, body }) => wheel.slots(connection.get(), wheelFromParams(params), body as never))

	return app
}
