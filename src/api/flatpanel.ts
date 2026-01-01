import Elysia from 'elysia'
import type { FlatPanel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FlatPanelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function flatPanel(wsm: WebSocketMessageHandler, flatPanelManager: FlatPanelManager) {
	function flatPanelFromParams(clientId: string, id: string) {
		return flatPanelManager.get(clientId, decodeURIComponent(id))!
	}

	const handler: DeviceHandler<FlatPanel> = {
		added: (device: FlatPanel) => {
			wsm.send<FlatPanelAdded>('flatPanel:add', { device })
			console.info('flat panel added:', device.name)
		},
		updated: (device: FlatPanel, property: keyof FlatPanel & string, state?: PropertyState) => {
			wsm.send<FlatPanelUpdated>('flatPanel:update', { device: { name: device.name, [property]: device[property] }, property, state })
		},
		removed: (device: FlatPanel) => {
			wsm.send<FlatPanelRemoved>('flatPanel:remove', { device })
			console.info('flat panel removed:', device.name)
		},
	}

	flatPanelManager.addHandler(handler)

	const app = new Elysia({ prefix: '/flatpanels' })
		// Endpoints!
		.get('', ({ query }) => Array.from(flatPanelManager.list(query.clientId)))
		.get('/:id', ({ params, query }) => flatPanelFromParams(query.clientId, params.id))
		.post('/:id/enable', ({ params, query }) => flatPanelManager.enable(flatPanelFromParams(query.clientId, params.id)))
		.post('/:id/disable', ({ params, query }) => flatPanelManager.disable(flatPanelFromParams(query.clientId, params.id)))
		.post('/:id/toggle', ({ params, query }) => flatPanelManager.toggle(flatPanelFromParams(query.clientId, params.id)))
		.post('/:id/intensity', ({ params, query, body }) => flatPanelManager.intensity(flatPanelFromParams(query.clientId, params.id), body as never))

	return app
}
