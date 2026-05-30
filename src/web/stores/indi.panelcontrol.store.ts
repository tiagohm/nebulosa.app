import type { Device, DeviceProperties, DeviceProperty } from 'nebulosa/src/indi.device'
import type { Message, NewVector } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { IndiDevicePropertyEvent } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { wsStore } from './ws.store'

export type IndiPanelControlStore = ReturnType<typeof indiPanelControlStore>

export interface IndiPanelControlState {
	show: boolean
	readonly groups: string[]
	group: string
	properties: Record<string, DeviceProperties>
	readonly messages: Message[]
	tab: 'property' | 'message'
}

function MessageComparator(a: Message, b: Message) {
	return b.timestamp!.localeCompare(a.timestamp!)
}

export function indiPanelControlStore(device: Device) {
	const state = proxy<IndiPanelControlState>({
		show: false,
		groups: [],
		group: '',
		properties: {},
		messages: [],
		tab: 'property',
	})

	console.info('indi panel control created:', device.name)

	const u: VoidFunction[] = []
	let mounted = false

	function mount() {
		if (mounted) return

		console.info('indi panel control mounted:', device.name)

		mounted = true

		u[0] = initProxy(state, `indi.panelcontrol.${device.id}`, ['p:show', 'p:tab', 'p:group'])

		u[1] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:add', (event) => {
			if (device.id === event.device) {
				addProperty(event.property)
			}
		})

		u[2] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:update', (event) => {
			if (device.id === event.device) {
				updateProperty(event.property)
			}
		})

		u[3] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:remove', (event) => {
			if (device.id === event.device) {
				removeProperty(event.property)
			}
		})

		u[4] = bus.subscribe<Message>('indi:message', (event) => {
			if (device.id === event.device) {
				state.messages.unshift(event)
			}
		})

		u[5] = bus.subscribe<Device>('indi:panelcontrol:toggle', (event) => {
			if (device === event) {
				state.show = !state.show
			}
		})

		u[6] = subscribeKey(state, 'show', (show) => {
			if (show) {
				void retrieveProperties()
				void retrieveMessages()

				listen()
			} else {
				unlisten()
			}
		})

		if (state.show) {
			void retrieveProperties()
			void retrieveMessages()

			listen()
		}
	}

	function unmount() {
		if (!mounted) return
		console.info('indi panel control unmounted:', device.name)
		unsubscribe(u)
		unlisten()
		mounted = false
	}

	function listen() {
		wsStore.send(`indi:listen:${device.id}`)
	}

	function unlisten() {
		wsStore.send(`indi:unlisten:${device.id}`)
	}

	async function retrieveProperties() {
		const properties = await Api.Indi.Properties.list(device)

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

	async function retrieveMessages() {
		const messages = await Api.Indi.messages(device, device.client)

		if (messages) {
			Object.assign(state.messages, messages.sort(MessageComparator))
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
		if (state.show) {
			await Api.Indi.Properties.send(device, property.type, message)
		}
	}

	function show() {
		state.show = true
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		device,
		mount,
		unmount,
		retrieveProperties,
		retrieveMessages,
		selectGroup,
		clear,
		send,
		show,
		hide,
	} as const
}
