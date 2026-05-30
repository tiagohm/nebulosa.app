import type { IndiClient } from 'nebulosa/src/indi.client'
import type { FlatPanel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FlatPanelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'
import { type Endpoints, query, response } from './http'
import type { Messager, WebSocketMessageHandler } from './message'

export class FlatPanelHandler implements DeviceHandler<FlatPanel> {
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly flatPanelManager: FlatPanelManager,
	) {
		flatPanelManager.addHandler(this)

		bus.subscribe<Messager>('ws:open', (socket) => {
			for (const device of flatPanelManager.list()) {
				this.wsm.send<FlatPanelAdded>('flatPanel:add', { device }, socket)
			}
		})
	}

	added(device: FlatPanel) {
		this.wsm.send<FlatPanelAdded>('flatPanel:add', { device })
		console.info('flat panel added:', device.name, device.id)
	}

	updated(device: FlatPanel, property: keyof FlatPanel & string, state?: PropertyState) {
		this.wsm.send<FlatPanelUpdated>('flatPanel:update', { device: { type: 'flatPanel', id: device.id, name: device.name, [property]: device[property] }, property, state })
	}

	removed(device: FlatPanel) {
		this.wsm.send<FlatPanelRemoved>('flatPanel:remove', { device })
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
