import type { IndiClient } from 'nebulosa/src/indi.client'
import type { Cover } from 'nebulosa/src/indi.device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { WebSocketMessageHandler } from './message'

export class CoverHandler implements DeviceHandler<Cover> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly coverManager: CoverManager,
	) {
		coverManager.addHandler(this)
	}

	added(device: Cover) {
		this.wsm.send<CoverAdded>('cover:add', { device })
		console.info('cover added:', device.name)
	}

	updated(device: Cover, property: keyof Cover & string, state?: PropertyState) {
		this.wsm.send<CoverUpdated>('cover:update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: Cover) {
		this.wsm.send<CoverRemoved>('cover:remove', { device })
		console.info('cover removed:', device.name)
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

export function cover(coverHandler: CoverHandler): Endpoints {
	const { coverManager } = coverHandler

	function coverFromParams(req: Bun.BunRequest<string>) {
		return coverManager.get(query(req).get('client'), req.params.id)!
	}

	return {
		'/covers': { GET: (req) => response(coverHandler.list(query(req).get('client'))) },
		'/covers/:id': { GET: (req) => response(coverFromParams(req)) },
		'/covers/:id/park': { POST: (req) => response(coverHandler.park(coverFromParams(req))) },
		'/covers/:id/stop': { POST: (req) => response(coverHandler.stop(coverFromParams(req))) },
		'/covers/:id/unpark': { POST: (req) => response(coverHandler.unpark(coverFromParams(req))) },
	}
}
