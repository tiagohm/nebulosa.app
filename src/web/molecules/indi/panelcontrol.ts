import { molecule, onMount } from 'bunshi'
import type { NewVector } from 'nebulosa/src/indi'
import bus, { unsubscribe } from 'src/shared/bus'
import type { ConnectionStatus, DeviceProperties, DeviceProperty, IndiDevicePropertyEvent } from 'src/shared/types'
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
}

export const IndiPanelControlMolecule = molecule((m) => {
	const connection = m(ConnectionMolecule)

	const state = proxy<IndiPanelControlState>({
		show: false,
		devices: [],
		device: '',
		groups: [],
		group: '',
		properties: {},
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(4)

		unsubscribers[0] = bus.subscribe<ConnectionStatus>('connection:open', (status) => {
			if (connection.state.connected?.id === status.id) {
				void retrieveDevices()
			}
		})

		unsubscribers[1] = bus.subscribe<ConnectionStatus>('connection:close', (status) => {
			if (connection.state.connected?.id === status.id) {
				state.devices = []
				state.device = ''
				state.groups = []
				state.group = ''
				state.properties = {}
			}
		})

		unsubscribers[2] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:update', (event) => {
			if (state.device === event.device) {
				addProperty(event.property)
			}
		})

		unsubscribers[3] = bus.subscribe<IndiDevicePropertyEvent>('indi:property:remove', (event) => {
			if (state.device === event.device) {
				removeProperty(event.property)
			}
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	void retrieveDevices()

	async function retrieveDevices() {
		const devices = await Api.Indi.devices()
		state.devices = devices?.sort() ?? []

		if (devices?.length) {
			state.device = devices[0]
			await retrieveProperties()
		}
	}

	async function retrieveProperties() {
		if (state.device) {
			state.properties = {}
			const properties = await Api.Indi.Properties.list(state.device)
			properties && addProperties(properties)

			state.groups = Object.keys(state.properties).sort()
			state.group = state.groups[0] || ''
		}
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

	function sendProperty(property: DeviceProperty, message: NewVector) {
		return Api.Indi.Properties.send(state.device, property.type, message)
	}

	function show() {
		bus.emit('homeMenu:toggle', false)
		state.show = true
	}

	function close() {
		state.show = false
	}

	return { state, sendProperty, show, close }
})
