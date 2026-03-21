import { molecule, onMount, use } from 'bunshi'
import type { Device, DeviceProperties, DeviceProperty } from 'nebulosa/src/indi.device'
import type { Message, NewVector } from 'nebulosa/src/indi.types'
import bus from 'src/shared/bus'
import type { ConnectionEvent, IndiDevicePropertyEvent } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { subscribeKey } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { ConnectionMolecule } from '../connection'

export interface IndiPanelControlState {
	show: boolean
	devices: string[]
	device: string
	groups: string[]
	group: string
	properties: Record<string, DeviceProperties>
	messages: Message[]
	tab: 'property' | 'message'
}

const state = proxy<IndiPanelControlState>({
	show: false,
	devices: [],
	device: '',
	groups: [],
	group: '',
	properties: {},
	messages: [],
	tab: 'property',
})

initProxy(state, 'indi', ['p:show', 'p:device', 'p:group', 'p:tab'])

export const IndiPanelControlMolecule = molecule(() => {
	const connection = use(ConnectionMolecule)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(7)

		unsubscribers[0] = bus.subscribe<ConnectionEvent>('connection:close', ({ status }) => {
			if (connection.state.connected?.id === status.id) {
				state.devices = []
				state.device = ''
				state.groups = []
				state.group = ''
				state.properties = {}
			}
		})

		unsubscribers[1] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:add', (event) => {
			if (state.device === event.device && connection.state.connected?.id === event.clientId) {
				addProperty(event.property)
			}
		})

		unsubscribers[2] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:update', (event) => {
			if (state.device === event.device && connection.state.connected?.id === event.clientId) {
				updateProperty(event.property)
			}
		})

		unsubscribers[3] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:remove', (event) => {
			if (state.device === event.device && connection.state.connected?.id === event.clientId) {
				removeProperty(event.property)
			}
		})

		unsubscribers[4] = bus.subscribe<Message & { clientId: string }>('indi:message', (event) => {
			if (event.device === state.device && connection.state.connected?.id === event.clientId) {
				state.messages.unshift(event)
			}
		})

		unsubscribers[5] = subscribeKey(connection.state, 'connected', (event) => {
			if (event && connection.state.connected?.id === event.id) {
				void retrieveDevices()
			}
		})

		unsubscribers[6] = subscribeKey(connection.state, 'show', (show) => {
			if (show) {
				void retrieveDevices()
			}
		})

		const timer = setInterval(ping, 5000)

		if (state.show && connection.state.connected) {
			void retrieveDevices()
		}

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(timer)
		}
	})

	async function retrieveDevices(device: Device | string = state.device) {
		const devices = connection.state.connected?.id ? await Api.Indi.devices(connection.state.connected) : []
		state.devices = devices?.sort() ?? []
		void changeDevice((typeof device === 'string' ? device : device.name) || state.devices[0] || '')
		ping()
	}

	async function retrieveProperties(device: string = state.device) {
		if (device) {
			const properties = await Api.Indi.Properties.list(device, connection.state.connected!)

			if (properties !== undefined) {
				const output = {}
				const groups = addProperties(properties, output)
				state.groups = Array.from(groups).sort()
				state.properties = output
				console.info('retrieved', device)
			} else {
				state.groups = []
				state.properties = {}
			}

			if (!state.group || !state.groups.includes(state.group)) {
				state.group = state.groups[0] || ''
			}
		}
	}

	async function retrieveMessages(device: string = state.device) {
		const messages = await Api.Indi.messages(device, connection.state.connected!)
		if (messages) state.messages = messages.sort((a, b) => b.timestamp!.localeCompare(a.timestamp!))
	}

	async function changeDevice(device: string) {
		if (device) {
			void retrieveMessages()
			device = state.devices.includes(device) ? device : state.devices[0] || ''
			await retrieveProperties(device)
			state.device = device
		}
	}

	function changeGroup(group: string) {
		state.group = group
	}

	function clearMessages() {
		state.messages = []
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
					delete group[property.group]

					if (Object.keys(group[property.group]).length === 0) {
						const index = state.groups.indexOf(property.group)

						if (index >= 0) {
							state.groups.splice(index, 1)
							if (state.group === property.group) state.group = state.groups[0] || ''
						}
					}
				}
			}
		}
	}

	function send(property: DeviceProperty, message: NewVector) {
		return Api.Indi.Properties.send(state.device, property.type, message, connection.state.connected!)
	}

	function ping(device: string = state.device) {
		if (device && state.show && connection.state.connected) {
			void Api.Indi.Properties.ping(device, connection.state.connected!)
		}
	}

	async function show(device?: Device | string) {
		if (!state.show) {
			await retrieveDevices(device)
		} else if (device) {
			await changeDevice(typeof device === 'string' ? device : device.name)
		}

		bus.emit('homeMenu:toggle', false)
		state.show = true
		ping()
	}

	function hide() {
		state.show = false
	}

	return {
		state,
		retrieveDevices,
		retrieveProperties,
		retrieveMessages,
		changeDevice,
		changeGroup,
		clearMessages,
		ping,
		send,
		show,
		hide,
	} as const
})
