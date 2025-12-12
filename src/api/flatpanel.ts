import Elysia from 'elysia'
import type { IndiClient, PropertyState } from 'nebulosa/src/indi'
import type { FlatPanel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FlatPanelManager } from 'nebulosa/src/indi.manager'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'
import type { ConnectionHandler } from './connection'
import type { WebSocketMessageHandler } from './message'

export class FlatPanelHandler implements DeviceHandler<FlatPanel> {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	added(client: IndiClient, device: FlatPanel) {
		this.wsm.send<FlatPanelAdded>('flatPanel:add', { device })
		console.info('flat panel added:', device.name)
	}

	updated(client: IndiClient, device: FlatPanel, property: keyof FlatPanel, state?: PropertyState) {
		this.wsm.send<FlatPanelUpdated>('flatPanel:update', { device: { name: device.name, [property]: device[property] }, property, state })
	}

	removed(client: IndiClient, device: FlatPanel) {
		this.wsm.send<FlatPanelRemoved>('flatPanel:remove', { device })
		console.info('flat panel removed:', device.name)
	}
}

export function flatPanel(flatPanel: FlatPanelManager, connection: ConnectionHandler) {
	function flatPanelFromParams(params: { id: string }) {
		return flatPanel.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/flatpanels' })
		// Endpoints!
		.get('', () => flatPanel.list())
		.get('/:id', ({ params }) => flatPanelFromParams(params))
		.post('/:id/enable', ({ params }) => flatPanel.enable(connection.get(), flatPanelFromParams(params)))
		.post('/:id/disable', ({ params }) => flatPanel.disable(connection.get(), flatPanelFromParams(params)))
		.post('/:id/toggle', ({ params }) => flatPanel.toggle(connection.get(), flatPanelFromParams(params)))
		.post('/:id/intensity', ({ params, body }) => flatPanel.intensity(connection.get(), flatPanelFromParams(params), body as never))

	return app
}
