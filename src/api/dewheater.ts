import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { DewHeater } from 'nebulosa/src/indi.device'
import type { DeviceHandler, DewHeaterManager } from 'nebulosa/src/indi.manager'
import type { CoverUpdated, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class DewHeaterHandler implements DeviceHandler<DewHeater> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: DewHeater) {
		this.wsm.send<DewHeaterAdded>('dewHeater:add', { device })
		console.info('dew heater added:', device.name)
	}

	updated(client: IndiClient, device: DewHeater, property: keyof DewHeater, state?: PropertyState) {
		const event = { device: { name: device.name, [property]: device[property] }, property, state }

		if (device.type === 'COVER') this.wsm.send<CoverUpdated>('cover:update', event)
		this.wsm.send<DewHeaterUpdated>('dewHeater:update', event)
	}

	removed(client: IndiClient, device: DewHeater) {
		this.wsm.send<DewHeaterRemoved>('dewHeater:remove', { device })
		console.info('dew heater removed:', device.name)
	}
}

export function dewHeater(dewHeater: DewHeaterManager, connection: ConnectionHandler) {
	function dewHeaterFromParams(params: { id: string }) {
		return dewHeater.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/dewheaters' })
		// Endpoints!
		.get('', () => dewHeater.list())
		.get('/:id', ({ params }) => dewHeaterFromParams(params))
		.post('/:id/pwm', ({ params, body }) => dewHeater.pwm(connection.get(), dewHeaterFromParams(params), body as never))

	return app
}
