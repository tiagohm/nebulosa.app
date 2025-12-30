import Elysia from 'elysia'
import type { FlatPanel } from 'nebulosa/src/indi.device'
import type { DeviceHandler, FlatPanelManager } from 'nebulosa/src/indi.manager'
import type { PropertyState } from 'nebulosa/src/indi.types'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from 'src/shared/types'
import type { WebSocketMessageHandler } from './message'

export function flatPanel(wsm: WebSocketMessageHandler, flatPanelManager: FlatPanelManager) {
	function flatPanelFromParams(params: { id: string }) {
		return flatPanelManager.get(decodeURIComponent(params.id))!
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
		.get('', () => flatPanelManager.list())
		.get('/:id', ({ params }) => flatPanelFromParams(params))
		.post('/:id/enable', ({ params }) => flatPanelManager.enable(flatPanelFromParams(params)))
		.post('/:id/disable', ({ params }) => flatPanelManager.disable(flatPanelFromParams(params)))
		.post('/:id/toggle', ({ params }) => flatPanelManager.toggle(flatPanelFromParams(params)))
		.post('/:id/intensity', ({ params, body }) => flatPanelManager.intensity(flatPanelFromParams(params), body as never))

	return app
}
