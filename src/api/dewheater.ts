import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { DewHeater } from 'nebulosa/src/indi.device'
import type { DeviceHandler, DewHeaterManager } from 'nebulosa/src/indi.manager'
import type { CoverUpdated, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export function dewHeater(wsm: WebSocketMessageHandler, dewHeaterManager: DewHeaterManager, connectionHandler: ConnectionHandler) {
	function dewHeaterFromParams(params: { id: string }) {
		return dewHeaterManager.get(decodeURIComponent(params.id))!
	}

	const handler: DeviceHandler<DewHeater> = {
		added: (client: IndiClient, device: DewHeater) => {
			wsm.send<DewHeaterAdded>('dewHeater:add', { device })
			console.info('dew heater added:', device.name)
		},
		updated: (client: IndiClient, device: DewHeater, property: keyof DewHeater, state?: PropertyState) => {
			const event = { device: { name: device.name, [property]: device[property] }, property, state }

			if (device.type === 'COVER') wsm.send<CoverUpdated>('cover:update', event)
			wsm.send<DewHeaterUpdated>('dewHeater:update', event)
		},
		removed: (client: IndiClient, device: DewHeater) => {
			wsm.send<DewHeaterRemoved>('dewHeater:remove', { device })
			console.info('dew heater removed:', device.name)
		},
	}

	dewHeaterManager.addHandler(handler)

	const app = new Elysia({ prefix: '/dewheaters' })
		// Endpoints!
		.get('', () => dewHeaterManager.list())
		.get('/:id', ({ params }) => dewHeaterFromParams(params))
		.post('/:id/dutycycle', ({ params, body }) => dewHeaterManager.dutyCycle(connectionHandler.get(), dewHeaterFromParams(params), body as never))

	return app
}
