import { molecule, onMount, use } from 'bunshi'
import type { Message, NewVector } from 'nebulosa/src/indi'
import type { Device, DeviceProperties, DeviceProperty } from 'nebulosa/src/indi.device'
import bus from 'src/shared/bus'
import type { ConnectionEvent, IndiDevicePropertyEvent } from 'src/shared/types'
import { unsubscribe } from 'src/shared/util'
import { proxy } from 'valtio'
import { Api } from '@/shared/api'
import { ConnectionMolecule } from '../connection'

export interface IndiPanelControlState {
	show: boolean
	devices: string[]
	device: string
	groups: string[]
	group: string
	properties: Record<string, DeviceProperties>
	messages: Message[]
}

const state = proxy<IndiPanelControlState>({
	show: false,
	devices: [],
	device: '',
	groups: [],
	group: '',
	properties: {},
	messages: [],
})

export const IndiPanelControlMolecule = molecule(() => {
	const connection = use(ConnectionMolecule)

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = bus.subscribe<ConnectionEvent>('connection:close', ({ status }) => {
			if (connection.state.connected?.id === status.id) {
				state.devices = []
				state.device = ''
				state.groups = []
				state.group = ''
				state.properties = {}
			}
		})

		unsubscribers[1] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:update', (event) => {
			if (state.device === event.device) {
				addProperty(event.property)
			}
		})

		unsubscribers[2] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:remove', (event) => {
			if (state.device === event.device) {
				removeProperty(event.property)
			}
		})

		unsubscribers[3] = bus.subscribe<Message>('indi:message', (event) => {
			if (event.device === state.device) {
				state.messages.unshift(event)
			}
		})

		const timer = setInterval(ping, 5000)

		void retrieveDevices()

		return () => {
			unsubscribe(unsubscribers)
			clearInterval(timer)
		}
	})

	async function retrieveDevices(device: Device | string = state.device) {
		const devices = await Api.Indi.devices()
		state.devices = devices?.sort() ?? []
		state.device = (typeof device === 'string' ? device : device?.name) || state.devices[0] || ''
		ping()
	}
	async function retrieveProperties(device: string = state.device) {
		if (device) {
			state.properties = {}
			const properties = await Api.Indi.Properties.list(device)
			properties && addProperties(properties)

			state.groups = Object.keys(state.properties).sort()
			state.group = state.groups[0] || ''
		}
	}

	async function retrieveMessages(device: string = state.device) {
		const messages = await Api.Indi.messages(device)
		if (messages) state.messages = messages.sort((a, b) => b.timestamp!.localeCompare(a.timestamp!))
	}

	function clearMessages() {
		state.messages = []
	}

	function addProperties(properties: DeviceProperties) {
		for (const key in properties) {
			addProperty(properties[key]!)
		}
	}

	function addProperty(property: DeviceProperty) {
		if (property.group) {
			if (!state.groups.includes(property.group)) {
				state.groups.push(property.group)
				state.groups.sort()
			}

			const group = state.properties[property.group] ?? {}
			if (property.name in group) Object.assign(group[property.name], property)
			else group[property.name] = property
			state.properties[property.group] = group
		}
	}

	function removeProperty(property: DeviceProperty) {
		if (property.group) {
			const group = state.properties[property.group]

			if (group && property.name in group) {
				delete group[property.name]

				if (Object.keys(group).length === 0) {
					delete state.properties[property.group]

					state.groups = state.groups.filter((e) => e !== property.group)
					if (state.group === property.group) state.group = state.groups[0] || ''
				}
			}
		}
	}

	function send(property: DeviceProperty, message: NewVector) {
		return Api.Indi.Properties.send(state.device, property.type, message)
	}

	function ping(device: string = state.device) {
		if (device && state.show) {
			void Api.Indi.Properties.ping(device)
		}
	}

	async function show(device?: Device | string) {
		if (!state.show) {
			await retrieveDevices(device)
		} else if (device) {
			state.device = typeof device === 'string' ? device : device.name
		}

		bus.emit('homeMenu:toggle', false)
		state.show = true
		ping()
	}

	function hide() {
		state.show = false
	}

	return { state, retrieveDevices, retrieveProperties, retrieveMessages, clearMessages, ping, send, show, hide }
})
