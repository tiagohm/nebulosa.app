import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Cover } from 'nebulosa/src/devices/indi/device'
import type { CoverManager, DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { CoverAdded, CoverRemoved, CoverUpdated } from '#/cover'
import type { OperationResult } from '#/orchestration'
import type { CoverCommander } from './cover.commander'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import { detachOperation } from './operation.notify'
import { resourceKey } from './resource'

export interface CoverBusEvents {
	readonly add: CoverAdded
	readonly update: CoverUpdated
	readonly remove: CoverRemoved
}

export const coverBus = new EventBus<CoverBusEvents>()

// Publishes cover transport events and delegates every mutation to CoverCommander.
export class CoverHandler implements DeviceHandler<Cover> {
	// Registers the cover transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly coverManager: CoverManager,
		readonly notification: NotificationHandler,
		readonly commander: CoverCommander,
		readonly coordinator: OperationCoordinator,
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

	// Closes the cover as a whole operation tree owning it. The travel takes longer than the request that
	// asked for it, so it reports through cover events.
	park(cover: Cover) {
		this.#detach(cover, 'park', () => this.commander.park(this.coordinator, cover))
	}

	// Opens the cover, which also outlasts the request.
	unpark(cover: Cover) {
		this.#detach(cover, 'unpark', () => this.commander.unpark(this.coordinator, cover))
	}

	// Stops the cover: first by cancelling whatever operation owns it, so its own cleanup runs, and then by
	// the physical abort, which also covers motion nobody here started.
	async stop(cover: Cover) {
		await this.coordinator.cancelByResource(resourceKey(cover))
		return await this.commander.stopMotion(cover)
	}

	// Runs a command whose physical completion outlasts the request that asked for it, notifying its failure.
	#detach(cover: Cover, action: string, command: () => Promise<OperationResult<unknown>>) {
		detachOperation(this.notification, 'COVER', cover.name, action, command)
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
		'/covers/:id/stop': { POST: async (req) => response<OperationResult<void>>(await coverHandler.stop(coverFromParams(req))) },
		'/covers/:id/unpark': { POST: (req) => response(coverHandler.unpark(coverFromParams(req))) },
	} as const satisfies Endpoints
}
