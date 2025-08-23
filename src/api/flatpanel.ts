import Elysia from 'elysia'
import type { DefNumberVector, DefSwitchVector, DefTextVector, IndiClient, PropertyState, SetNumberVector, SetSwitchVector, SetTextVector } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import { DEFAULT_FLAT_PANEL, type FlatPanel, type FlatPanelAdded, type FlatPanelRemoved, type FlatPanelUpdated } from '../shared/types'
import type { ConnectionManager } from './connection'
import { addProperty, ask, connectionFor, DeviceInterfaceType, isInterfaceType } from './indi'
import type { WebSocketMessageManager } from './message'

export function intensity(client: IndiClient, device: FlatPanel, value: number) {
	if (device.enabled) {
		client.sendNumber({ device: device.name, name: 'FLAT_LIGHT_INTENSITY', elements: { FLAT_LIGHT_INTENSITY_VALUE: value } })
	}
}

export function enable(client: IndiClient, device: FlatPanel, enabled: boolean) {
	client.sendSwitch({ device: device.name, name: 'FLAT_LIGHT_CONTROL', elements: { [enabled ? 'FLAT_LIGHT_ON' : 'FLAT_LIGHT_OFF']: true } })
}

export class FlatPanelManager {
	private readonly flatpanels = new Map<string, FlatPanel>()

	constructor(readonly wsm: WebSocketMessageManager) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove all flat panels associated with the client
			this.flatpanels.forEach((device) => this.remove(device))
		})
	}

	switchVector(client: IndiClient, message: DefSwitchVector | SetSwitchVector, tag: string) {
		const device = this.flatpanels.get(message.device)

		if (!device) return

		addProperty(device, message, tag)

		switch (message.name) {
			case 'CONNECTION':
				if (connectionFor(client, device, message)) {
					this.update(device, 'connected', message.state)
				}

				return
			case 'FLAT_LIGHT_CONTROL': {
				const enabled = message.elements.FLAT_LIGHT_ON?.value === true

				if (enabled !== device.enabled) {
					device.enabled = enabled
					this.update(device, 'enabled', message.state)
				}

				return
			}
		}
	}

	numberVector(client: IndiClient, message: DefNumberVector | SetNumberVector, tag: string) {
		const device = this.flatpanels.get(message.device)

		if (!device) return

		addProperty(device, message, tag)

		switch (message.name) {
			case 'FLAT_LIGHT_INTENSITY': {
				let update = false

				if (tag[0] === 'd') {
					const { min, max } = (message as DefNumberVector).elements.FLAT_LIGHT_INTENSITY_VALUE
					device.intensity.min = min
					device.intensity.max = max
					update = true
				}

				const value = message.elements.FLAT_LIGHT_INTENSITY_VALUE?.value ?? 0

				if (value !== device.intensity.value) {
					device.intensity.value = value
					update = true
				}

				if (update) {
					this.update(device, 'intensity', message.state)
				}

				return
			}
		}
	}

	textVector(client: IndiClient, message: DefTextVector | SetTextVector, tag: string) {
		if (message.name === 'DRIVER_INFO') {
			const type = +message.elements.DRIVER_INTERFACE!.value

			if (isInterfaceType(type, DeviceInterfaceType.LIGHTBOX)) {
				const executable = message.elements.DRIVER_EXEC!.value
				const version = message.elements.DRIVER_VERSION!.value

				if (!this.flatpanels.has(message.device)) {
					const panel: FlatPanel = { ...structuredClone(DEFAULT_FLAT_PANEL), id: message.device, name: message.device, driver: { executable, version } }
					this.add(panel)
					addProperty(panel, message, tag)
					ask(client, panel)
				}
			} else if (this.flatpanels.has(message.device)) {
				this.remove(this.flatpanels.get(message.device)!)
			}

			return
		}
	}

	update(device: FlatPanel, property: keyof FlatPanel, state?: PropertyState) {
		const value = { name: device.name, [property]: device[property] }
		this.wsm.send<FlatPanelUpdated>({ type: 'flatPanel:update', device: value, property, state })
		bus.emit('flatPanel:update', value)
	}

	add(device: FlatPanel) {
		this.flatpanels.set(device.name, device)

		this.wsm.send<FlatPanelAdded>({ type: 'flatPanel:add', device })
		bus.emit('flatPanel:add', device)
		console.info('flatPanel added:', device.name)
	}

	remove(device: FlatPanel) {
		if (this.flatpanels.has(device.name)) {
			this.flatpanels.delete(device.name)

			this.wsm.send<FlatPanelRemoved>({ type: 'flatPanel:remove', device })
			bus.emit('flatPanel:remove', device)
			console.info('flatPanel removed:', device.name)
		}
	}

	list() {
		return Array.from(this.flatpanels.values())
	}

	get(id: string) {
		return this.flatpanels.get(id)
	}

	intensity(client: IndiClient, device: FlatPanel, value: number) {
		intensity(client, device, value)
	}

	enable(client: IndiClient, device: FlatPanel) {
		enable(client, device, true)
	}

	disable(client: IndiClient, device: FlatPanel) {
		enable(client, device, false)
	}
}

export function flatPanel(flatPanel: FlatPanelManager, connection: ConnectionManager) {
	function flatPanelFromParams(params: { id: string }) {
		return flatPanel.get(decodeURIComponent(params.id))!
	}

	const app = new Elysia({ prefix: '/flatpanels' })
		// Endpoints!
		.get('', () => flatPanel.list())
		.get('/:id', ({ params }) => flatPanelFromParams(params))
		.post('/:id/enable', ({ params }) => flatPanel.enable(connection.get(), flatPanelFromParams(params)))
		.post('/:id/disable', ({ params }) => flatPanel.disable(connection.get(), flatPanelFromParams(params)))
		.post('/:id/intensity', ({ params, body }) => flatPanel.intensity(connection.get(), flatPanelFromParams(params), body as never))

	return app
}
