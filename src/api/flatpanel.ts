import type { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { FlatPanel } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager/device'
import type { FlatPanelManager } from 'nebulosa/src/devices/indi/manager/flatpanel'
import type { PropertyState } from 'nebulosa/src/devices/indi/types'
import type { OperationCoordinator } from 'src/api/operation'
import { EventBus } from 'src/shared/bus'
import type { FlatPanelAdded, FlatPanelRemoved, FlatPanelUpdated } from '#/flatpanel'
import type { OperationResult } from '#/orchestration'
import type { FlatPanelCommander } from './flatpanel.commander'
import { query, response } from './http'
import type { Endpoints } from './http'
import { webSocketBus } from './message'
import type { WebSocketMessageHandler } from './message'

export interface FlatPanelBusEvents {
	readonly add: FlatPanelAdded
	readonly update: FlatPanelUpdated
	readonly remove: FlatPanelRemoved
}

export const flatPanelBus = new EventBus<FlatPanelBusEvents>()

// Publishes flat panel transport events and delegates every mutation to FlatPanelCommander.
export class FlatPanelHandler implements DeviceHandler<FlatPanel> {
	// Registers the flat panel transport adapter and its presentation-event fanout.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly flatPanelManager: FlatPanelManager,
		readonly commander: FlatPanelCommander,
		readonly coordinator: OperationCoordinator,
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

	// Turns the light on, which the driver applies without any motion.
	enable(panel: FlatPanel) {
		return this.commander.enable(this.coordinator, panel)
	}

	// Turns the light off.
	disable(panel: FlatPanel) {
		return this.commander.disable(this.coordinator, panel)
	}

	// Inverts the light state last reported by the driver.
	toggle(panel: FlatPanel) {
		return this.commander.toggle(this.coordinator, panel)
	}

	// Sets the brightness, in the driver's own intensity units.
	intensity(panel: FlatPanel, value: number) {
		return this.commander.intensity(this.coordinator, panel, value)
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
		'/flatpanels/:id/enable': { POST: async (req) => response<OperationResult<void>>(await flatPanelHandler.enable(flatPanelFromParams(req))) },
		'/flatpanels/:id/disable': { POST: async (req) => response<OperationResult<void>>(await flatPanelHandler.disable(flatPanelFromParams(req))) },
		'/flatpanels/:id/toggle': { POST: async (req) => response<OperationResult<void>>(await flatPanelHandler.toggle(flatPanelFromParams(req))) },
		'/flatpanels/:id/intensity': { POST: async (req) => response<OperationResult<void>>(await flatPanelHandler.intensity(flatPanelFromParams(req), await req.json())) },
	} as const satisfies Endpoints
}
