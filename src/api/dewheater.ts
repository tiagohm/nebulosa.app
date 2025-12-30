import Elysia from 'elysia'
import type { DewHeater } from 'nebulosa/src/indi.device'
import type { DeviceHandler, DewHeaterManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CoverUpdated, DewHeaterAdded, DewHeaterRemoved, DewHeaterUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function dewHeater(wsm: WebSocketMessageHandler, dewHeaterManager: DewHeaterManager) {
	function dewHeaterFromParams(params: { id: string }) {
		return dewHeaterManager.get(decodeURIComponent(params.id))!
	}

	const handler: DeviceHandler<DewHeater> = {
		added: (device: DewHeater) => {
			wsm.send<DewHeaterAdded>('dewHeater:add', { device })
			console.info('dew heater added:', device.name)
		},
		updated: (device: DewHeater, property: keyof DewHeater & string, state?: PropertyState) => {
			const event = { device: { name: device.name, [property]: device[property] }, property, state }

			if (device.type === 'COVER') wsm.send<CoverUpdated>('cover:update', event)
			wsm.send<DewHeaterUpdated>('dewHeater:update', event)
		},
		removed: (device: DewHeater) => {
			wsm.send<DewHeaterRemoved>('dewHeater:remove', { device })
			console.info('dew heater removed:', device.name)
		},
	}

	dewHeaterManager.addHandler(handler)

	const app = new Elysia({ prefix: '/dewheaters' })
		// Endpoints!
		.get('', () => dewHeaterManager.list())
		.get('/:id', ({ params }) => dewHeaterFromParams(params))
		.post('/:id/dutycycle', ({ params, body }) => dewHeaterManager.dutyCycle(dewHeaterFromParams(params), body as never))

	return app
}
