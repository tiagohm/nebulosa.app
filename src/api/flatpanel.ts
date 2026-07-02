import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler, FlatPanelManager } from 'nebulosa/src/devices/indi/manager'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import { EventBus } from 'src/shared/bus'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import { webSocketBus, type WebSocketMessageHandler } from './message'

export interface FlatPanelBusEvents {
	readonly add: FlatPanelAdded
	readonly update: FlatPanelUpdated
	readonly remove: FlatPanelRemoved
}

export const flatPanelBus = new EventBus<FlatPanelBusEvents>()

export class FlatPanelHandler implements DeviceHandler<FlatPanel> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly flatPanelManager: FlatPanelManager,
	) {
		flatPanelManager.addHandler(this)

		webSocketBus.subscribe('open', (socket) => {
			for (const device of flatPanelManager.list()) {
				wsm.send<FlatPanelAdded>('flatPanel:add', { device }, socket)
			}
		})

		flatPanelBus.subscribe('add', (event) => wsm.send('flatPanel:add', event))
		flatPanelBus.subscribe('update', (event) => wsm.send('flatPanel:update', event))
		flatPanelBus.subscribe('remove', (event) => wsm.send('flatPanel:remove', event))
	}

	added(device: FlatPanel) {
		flatPanelBus.emit('add', { device })
		console.info('flat panel added:', device.name, device.id)
	}

	updated(device: FlatPanel, property: keyof FlatPanel & string, state?: PropertyState) {
		flatPanelBus.emit('update', { device: { id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: FlatPanel) {
		flatPanelBus.emit('remove', { device })
		console.info('flat panel removed:', device.name, device.id)
	}

	list(client?: string | IndiClient) {
		return Array.from(this.flatPanelManager.list(client))
	}
}

export function flatPanel(flatPanelHandler: FlatPanelHandler) {
	const { flatPanelManager } = flatPanelHandler

	function flatPanelFromParams(req: Bun.BunRequest) {
		return flatPanelManager.get(query(req).client, req.params.id)!
	}

	return {
		'/flatpanels': { GET: (req) => response(flatPanelHandler.list(query(req).client)) },
		'/flatpanels/:id': { GET: (req) => response(flatPanelFromParams(req)) },
		'/flatpanels/:id/enable': { POST: (req) => response(flatPanelManager.enable(flatPanelFromParams(req))) },
		'/flatpanels/:id/disable': { POST: (req) => response(flatPanelManager.disable(flatPanelFromParams(req))) },
		'/flatpanels/:id/toggle': { POST: (req) => response(flatPanelManager.toggle(flatPanelFromParams(req))) },
		'/flatpanels/:id/intensity': { POST: async (req) => response(flatPanelManager.intensity(flatPanelFromParams(req), await req.json())) },
	} as const satisfies Endpoints
}
