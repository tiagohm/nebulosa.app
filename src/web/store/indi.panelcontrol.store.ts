import type { Device, DeviceProperties, DeviceProperty } from 'nebulosa/src/indi.device'
import type { Message, NewVector } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { ConnectionEvent, ConnectionStatus, IndiDevicePropertyEvent } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { connectionStore } from 'src/web/store/connection.store'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { equipmentStore } from './equipment.store'

export type IndiPanelControlStore = ReturnType<typeof indiPanelControlStore>

export interface IndiPanelControlState {
	show: boolean
	readonly devices: Device[]
	device?: Device
	readonly groups: string[]
	group: string
	properties: Record<string, DeviceProperties>
	readonly messages: Message[]
	tab: 'property' | 'message'
}

function MessageComparator(a: Message, b: Message) {
	return b.timestamp!.localeCompare(a.timestamp!)
}

function DeviceComparator(a: Device, b: Device) {
	return a.name.localeCompare(b.name)
}

export function indiPanelControlStore(connection: ConnectionStatus) {
	const state = proxy<IndiPanelControlState>({
		show: false,
		devices: [],
		device: undefined,
		groups: [],
		group: '',
		properties: {},
		messages: [],
		tab: 'property',
	})

	console.info('indi panel control created:', connection.id)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('indi panel control mounted:', connection.id)

		mounted = true

		u[0] = initProxy(state, 'indi', ['p:show', 'p:tab'])

		u[1] = bus.subscribe<ConnectionEvent>('connection:close', ({ status }) => {
			if (connectionStore.state.connected?.id === status.id) {
				state.devices.length = 0
				state.device = undefined
				state.groups.length = 0
				state.group = ''
				state.properties = {}
			}
		})

		u[2] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:add', (event) => {
			if (state.device?.id === event.device && connectionStore.state.connected?.id === event.client) {
				addProperty(event.property)
			}
		})

		u[3] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:update', (event) => {
			if (state.device?.id === event.device && connectionStore.state.connected?.id === event.client) {
				updateProperty(event.property)
			}
		})

		u[4] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:remove', (event) => {
			if (state.device?.id === event.device && connectionStore.state.connected?.id === event.client) {
				removeProperty(event.property)
			}
		})

		u[5] = bus.subscribe<Message & { clientId: string }>('indi:message', (event) => {
			if (event.device === state.device && connectionStore.state.connected?.id === event.clientId) {
				state.messages.unshift(event)
			}
		})

		retrieveDevices()
	}

	function unmount() {
		if (!mounted) return
		console.info('indi panel control unmounted:', connection.id)
		unsubscribe(u)
		mounted = false
	}

	function retrieveDevices() {
		Object.assign(state.devices, equipmentStore.list(connection).sort(DeviceComparator))
	}

	async function retrieveProperties(device = state.device) {
		if (device) {
			const properties = await Api.Indi.Properties.list(device, connectionStore.state.connected!)

			if (properties !== undefined) {
				const output = {}
				const groups = addProperties(properties, output)
				Object.assign(state.groups, Array.from(groups).sort())
				state.properties = output
			} else {
				state.groups.length = 0
				state.properties = {}
			}

			if (!state.group || !state.groups.includes(state.group)) {
				state.group = state.groups[0] || ''
			}
		}
	}

	async function retrieveMessages(device = state.device) {
		const messages = connectionStore.state.connected && (await Api.Indi.messages(device, connectionStore.state.connected))

		if (messages) {
			Object.assign(state.messages, messages.sort(MessageComparator))
		}
	}

	async function selectDevice(device?: Device) {
		if (device) {
			void retrieveMessages()
			device = state.devices.find((e) => e.id === device!.id) ?? state.devices[0] ?? undefined
			await retrieveProperties(device)
			state.device = device
		}
	}

	function selectGroup(group: string) {
		state.group = group
	}

	function clear() {
		state.messages.length = 0
	}

	function addProperties(properties: DeviceProperties, out = state.properties) {
		const groups = new Set<string>()

		for (const key in properties) {
			const p = properties[key]
			addProperty(p, out)
			p.group && groups.add(p.group)
		}

		return groups
	}

	function addProperty(property: DeviceProperty, out = state.properties) {
		if (property.group) {
			let group = out[property.group]

			if (group === undefined) {
				group = { [property.name]: property }
				out[property.group] = group
			} else {
				group[property.name] = property
			}

			if (!state.groups.includes(property.group)) {
				state.groups.push(property.group)
				state.groups.sort()
			}
		}
	}

	function updateProperty(property: DeviceProperty) {
		if (property.group) {
			const group = state.properties[property.group]
			Object.assign(group[property.name], property)
		}
	}

	function removeProperty(property: DeviceProperty) {
		if (property.group) {
			const group = state.properties[property.group]

			if (group && property.name in group) {
				delete group[property.name]

				if (Object.keys(group).length === 0) {
					delete state.properties[property.group]

					const index = state.groups.indexOf(property.group)

					if (index >= 0) {
						state.groups.splice(index, 1)
						if (state.group === property.group) state.group = state.groups[0] || ''
					}
				}
			}
		}
	}

	async function send(property: DeviceProperty, message: NewVector) {
		if (state.device && state.show && connectionStore.state.connected) {
			await Api.Indi.Properties.send(state.device, property.type, message, connectionStore.state.connected)
		}
	}

	async function show(device?: Device) {
		if (!state.show) {
			retrieveDevices()
		} else if (device) {
			await selectDevice(device)
		}

		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		mount,
		unmount,
		retrieveDevices,
		retrieveProperties,
		retrieveMessages,
		selectDevice,
		selectGroup,
		clear,
		send,
		show,
		hide,
	} as const
}
