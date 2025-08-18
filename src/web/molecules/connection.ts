import { molecule, onMount } from 'bunshi'
import bus from 'src/shared/bus'
import type { ConnectionStatus } from 'src/shared/types'
import { proxy, subscribe } from 'valtio'
import { deepClone } from 'valtio/utils'
import { Api } from '@/shared/api'
import { simpleLocalStorage } from '@/shared/storage'
import { type Connection, DEFAULT_CONNECTION } from '@/shared/types'

export interface ConnectionState {
	showModal: boolean
	mode: 'create' | 'edit'
	readonly connections: Connection[]
	loading: boolean
	selected: Connection
	edited?: Connection
	connected?: ConnectionStatus
}

// Compares two connections based on their connectedAt timestamp
export const ConnectionComparator = (a: Connection, b: Connection) => {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}

// Molecule that manages connections
export const ConnectionMolecule = molecule((m) => {
	const connections = simpleLocalStorage.get('connections', () => [structuredClone(DEFAULT_CONNECTION)])
	connections.sort(ConnectionComparator)

	const state = proxy<ConnectionState>({
		showModal: false,
		mode: 'create',
		edited: undefined,
		connected: undefined,
		connections,
		loading: false,
		selected: connections[0],
	})

	// Connect to an existing connection
	Api.Connections.list().then((connections) => {
		if (!connections) return

		for (const connection of connections) {
			const index = state.connections.findIndex((c) => c.id === connection.id || (c.port === connection.port && (c.host === connection.host || c.host === connection.ip) && c.type === connection.type))

			if (index >= 0) {
				state.selected = state.connections[index]
				state.connected = connection

				Api.Cameras.list().then((cameras) => cameras?.forEach((camera) => bus.emit('camera:add', camera)))
				Api.Mounts.list().then((mounts) => mounts?.forEach((mount) => bus.emit('mount:add', mount)))
				Api.Thermometers.list().then((thermometers) => thermometers?.forEach((thermometer) => bus.emit('thermometer:add', thermometer)))
				Api.GuideOutputs.list().then((guideOutputs) => guideOutputs?.forEach((guideOutput) => bus.emit('guideOutput:add', guideOutput)))

				break
			}
		}
	})

	onMount(() => {
		const unsubscribe = subscribe(state.connections, () => simpleLocalStorage.set('connections', state.connections))

		return () => unsubscribe()
	})

	// Shows the modal for creating a new connection
	function create() {
		state.mode = 'create'
		state.edited = deepClone(DEFAULT_CONNECTION)
		state.showModal = true
	}

	// Shows the modal for editing an existing connection
	function edit(connection: Connection) {
		state.mode = 'edit'
		state.edited = deepClone(connection)
		state.showModal = true
	}

	// Adds a new connection to the list
	function add(connection: Connection) {
		state.connections.push(connection)
	}

	// Duplicates an existing connection
	// If the connection is the default one, it generates a new id
	function duplicate(connection: Connection) {
		const duplicated = deepClone(connection)
		if (duplicated.id === DEFAULT_CONNECTION.id) duplicated.id = Date.now().toFixed(0)
		add(duplicated)
	}

	// Updates a specific property of the edited connection
	function update<K extends keyof Connection>(name: K, value: Connection[K]) {
		if (state.edited) {
			state.edited[name] = value
		}
	}

	// Selects a connection
	function select(connection: Connection) {
		state.selected = connection
	}

	// Selects a connection by its id
	function selectWith(id: string) {
		const selected = state.connections.find((c) => c.id === id)
		selected && select(selected)
	}

	// Saves the edited connection
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

			state.showModal = false
		}
	}

	// Removes a connection only if it exists in the list
	// Returns true if the connection was removed, false otherwise
	function removeOnly(connection: Connection) {
		const { connections } = state
		const index = connections.findIndex((e) => e.id === connection.id)
		if (index < 0) return false
		connections.splice(index, 1)
		return true
	}

	// Removes a connection
	function remove(connection: Connection) {
		if (!removeOnly(connection)) return

		const { connections } = state

		if (connections.length === 0) {
			connections.push(structuredClone(DEFAULT_CONNECTION))
			state.selected = connections[0]
		} else if (state.selected.id === connection.id) {
			state.selected = connections[0]
		}
	}

	// Connects to the selected connection
	// If already connected, it disconnects
	async function connect() {
		if (state.connected) {
			void Api.Connections.disconnect(state.connected.id)
			state.connected = undefined
		} else {
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

	function close() {
		state.showModal = false
	}

	return { state, create, edit, update, select, selectWith, save, connect, duplicate, remove, close } as const
})
