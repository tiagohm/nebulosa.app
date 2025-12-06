import { molecule, onMount } from 'bunshi'
import bus, { unsubscribe } from 'src/shared/bus'
import type { ConnectionStatus } from 'src/shared/types'
import { proxy } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from '@/shared/api'
import { initProxy } from '@/shared/proxy'
import { type Connection, DEFAULT_CONNECTION } from '@/shared/types'

export interface ConnectionState {
	show: boolean
	readonly connections: Connection[]
	mode: 'create' | 'edit'
	loading: boolean
	selected?: Connection
	edited?: Connection
	connected?: ConnectionStatus
}

export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}

const state = proxy<ConnectionState>({
	show: false,
	connections: [],
	mode: 'create',
	loading: false,
})

initProxy(state, 'connection', ['p:show', 'o:connections'])
state.connections.sort(ConnectionComparator)

export const ConnectionMolecule = molecule(() => {
	if (state.connections.length === 0) {
		state.connections.push(structuredClone(DEFAULT_CONNECTION))
	}
	if (!state.selected) {
		state.selected = state.connections[0]
	}

	// Connect to an existing connection
	void Api.Connections.list().then((connections) => {
		if (!connections?.length) return

		for (const connection of connections) {
			const index = state.connections.findIndex((c) => c.id === connection.id || (c.port === connection.port && (c.host === connection.host || c.host === connection.ip) && c.type === connection.type))

			if (index >= 0) {
				state.selected = state.connections[index]
				state.connected = connection

				void Api.Cameras.list().then((cameras) => cameras?.forEach((camera) => bus.emit('camera:add', camera)))
				void Api.Mounts.list().then((mounts) => mounts?.forEach((mount) => bus.emit('mount:add', mount)))
				void Api.Focusers.list().then((focusers) => focusers?.forEach((focuser) => bus.emit('focuser:add', focuser)))
				void Api.Wheels.list().then((wheels) => wheels?.forEach((wheel) => bus.emit('wheel:add', wheel)))
				void Api.Thermometers.list().then((thermometers) => thermometers?.forEach((thermometer) => bus.emit('thermometer:add', thermometer)))
				void Api.GuideOutputs.list().then((guideOutputs) => guideOutputs?.forEach((guideOutput) => bus.emit('guideOutput:add', guideOutput)))
				void Api.Covers.list().then((covers) => covers?.forEach((cover) => bus.emit('cover:add', cover)))
				void Api.FlatPanels.list().then((flatPanels) => flatPanels?.forEach((flatPanel) => bus.emit('flatPanel:add', flatPanel)))
				void Api.DewHeaters.list().then((dewHeaters) => dewHeaters?.forEach((dewHeater) => bus.emit('dewHeater:add', dewHeater)))

				break
			}
		}
	})

	onMount(() => {
		const unsubscribers = new Array<VoidFunction>(2)

		unsubscribers[0] = bus.subscribe<ConnectionStatus>('connection:close', (status) => {
			if (state.connected?.id === status.id) {
				state.connected = undefined
			}
		})

		unsubscribers[1] = bus.subscribe('ws:close', () => {
			state.connected = undefined
		})

		return () => {
			unsubscribe(unsubscribers)
		}
	})

	function create() {
		state.mode = 'create'
		state.edited = structuredClone(DEFAULT_CONNECTION)
		state.show = true
	}

	function edit(connection: Connection) {
		state.mode = 'edit'
		state.edited = deepClone(connection)
		state.show = true
	}

	function add(connection: Connection) {
		state.connections.push(connection)
	}

	function duplicate(connection: Connection) {
		const duplicated = deepClone(connection)
		if (duplicated.id === DEFAULT_CONNECTION.id) duplicated.id = Date.now().toFixed(0)
		add(duplicated)
	}

	function update<K extends keyof Connection>(name: K, value: Connection[K]) {
		if (state.edited) {
			state.edited[name] = value
		}
	}

	function select(connection: Connection | string) {
		if (typeof connection === 'string') {
			const selected = state.connections.find((e) => e.id === connection)
			if (selected) state.selected = selected
			else console.warn('unknown connection', connection)
		} else if (state.connections.includes(connection)) {
			state.selected = connection
		} else {
			select(connection.id)
		}
	}

	function save() {
		const { edited } = state

		if (edited) {
			if (edited.id === DEFAULT_CONNECTION.id) {
				// If the edited connection is the default one, we remove it first
				if (state.mode === 'edit') {
					removeOnly(DEFAULT_CONNECTION)
				}

				// Generate a new id for the edited connection
				edited.id = Date.now().toFixed(0)

				// Add the edited connection to the list
				add(edited)

				// Set the edited connection as the selected one
				state.selected = edited
			} else {
				const index = state.connections.findIndex((e) => e.id === edited.id)

				if (index >= 0) {
					state.connections[index] = edited
				}
			}

			state.show = false
		}
	}

	function removeOnly(connection: Connection) {
		const { connections } = state
		const index = connections.findIndex((e) => e.id === connection.id)
		if (index < 0) return false
		connections.splice(index, 1)
		return true
	}

	function remove(connection: Connection) {
		if (!removeOnly(connection)) return

		const { connections } = state

		if (connections.length === 0) {
			connections.push(structuredClone(DEFAULT_CONNECTION))
			state.selected = connections[0]
		} else if (state.selected?.id === connection.id) {
			state.selected = connections[0]
		}
	}

	async function connect() {
		if (state.connected) {
			void Api.Connections.disconnect(state.connected.id)
			state.connected = undefined
		} else if (state.selected) {
			try {
				state.loading = true

				const status = await Api.Connections.connect(state.selected)

				if (status) {
					state.connected = status
					state.selected.connectedAt = Date.now()
				}
			} finally {
				state.loading = false
			}
		}
	}

	function hide() {
		state.show = false
	}

	return { state, create, edit, update, select, save, connect, duplicate, remove, hide } as const
})
