import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Cover } from 'nebulosa/src/devices/indi/device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface CoverBusEvents {
	readonly add: CoverAdded
	readonly update: CoverUpdated
	readonly remove: CoverRemoved
}

export const coverBus = new EventBus<CoverBusEvents>()

export class CoverHandler implements DeviceHandler<Cover> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly coverManager: CoverManager,
	) {
		coverManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of coverManager.list()) {
				wsm.send<CoverAdded>('cover:add', { device }, socket)
			}
		})

		coverBus.subscribe('add', (event) => wsm.send('cover:add', event))
		coverBus.subscribe('update', (event) => wsm.send('cover:update', event))
		coverBus.subscribe('remove', (event) => wsm.send('cover:remove', event))
	}

	added(device: Cover) {
		coverBus.emit('add', { device })
		console.info('cover added:', device.name, device.id)
	}

	updated(device: Cover, property: keyof Cover & string, state?: PropertyState) {
		coverBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Cover) {
		coverBus.emit('remove', { device })
		console.info('cover removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.coverManager.list(client))
	}

	park(device: Cover) {
		return this.coverManager.park(device)
	}

	unpark(device: Cover) {
		return this.coverManager.unpark(device)
	}

	stop(device: Cover) {
		return this.coverManager.stop(device)
	}
}

export function cover(coverHandler: CoverHandler) {
	const { coverManager } = coverHandler

	function coverFromParams(req: Bun.BunRequest) {
		return coverManager.get(query(req).client, req.params.id)!
	}

	return {
		'/covers': { GET: (req) => response(coverHandler.list(query(req).client)) },
		'/covers/:id': { GET: (req) => response(coverFromParams(req)) },
		'/covers/:id/park': { POST: (req) => response(coverHandler.park(coverFromParams(req))) },
		'/covers/:id/stop': { POST: (req) => response(coverHandler.stop(coverFromParams(req))) },
		'/covers/:id/unpark': { POST: (req) => response(coverHandler.unpark(coverFromParams(req))) },
	} as const satisfies Endpoints
}
