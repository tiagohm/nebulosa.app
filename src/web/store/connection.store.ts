import type { AlpacaDeviceServer } from 'nebulosa/src/alpaca.discovery'
import bus from 'src/shared/bus'
import type { ConnectionEvent, ConnectionStatus } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { DEFAULT_CONNECTION, type Connection } from '../shared/types'

export type ConnectionStore = typeof connection

export interface ConnectionState {
	show: boolean
	readonly connections: Connection[]
	mode: 'new' | 'edit'
	loading: boolean
	selected?: Connection & { id?: string }
	readonly edited: Connection
	connected?: ConnectionStatus
	readonly alpaca: {
		servers: readonly AlpacaDeviceServer[]
		discovering: boolean
	}
}

export function ConnectionComparator(a: Connection, b: Connection) {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}

const state = proxy<ConnectionState>({
	show: false,
	connections: [],
	mode: 'new',
	edited: structuredClone(DEFAULT_CONNECTION),
	loading: false,
	alpaca: {
		servers: [],
		discovering: false,
	},
})

initProxy(state, 'connection', ['p:show', 'p:mode', 'o:edited', 'o:connections'])
state.connections.sort(ConnectionComparator)

const DEFAULT_CONNECTION_PORT = {
	INDI: DEFAULT_CONNECTION.port,
	ALPACA: 32323,
	SIMULATOR: 0,
} satisfies Record<Connection['type'], number>

if (state.connections.length === 0) {
	state.connections.push(structuredClone(DEFAULT_CONNECTION))
}

state.selected ??= state.connections[0]

bus.subscribe<ConnectionEvent>('connection:open', ({ status, reused }) => {
	reused && list(status)
})

bus.subscribe<ConnectionEvent>('connection:close', ({ status }) => {
	if (state.connected?.id === status.id) {
		state.connected = undefined
	}
})

function list(connection: ConnectionStatus) {
	//
}

function createConnectionId() {
	let id = Date.now().toFixed(0)

	while (state.connections.some((connection) => connection.id === id)) {
		id = (+id + 1).toFixed(0)
	}

	return id
}

function create() {
	state.mode = 'new'
	Object.assign(state.edited, structuredClone(DEFAULT_CONNECTION))
	state.show = true
}

function edit(connection: Connection) {
	state.mode = 'edit'
	Object.assign(state.edited, connection)
	state.show = true
}

function add(connection: Connection) {
	state.connections.push(connection)
}

function duplicate(connection: Connection) {
	const { host, port, name, type, secured } = connection
	add({ id: createConnectionId(), host, port, name, type, secured })
}

function update<K extends keyof Connection>(name: K, value: Connection[K]) {
	if (name === 'type') {
		const previousType = state.edited.type
		const previousPort = state.edited.port
		const nextType = value as Connection['type']

		state.edited.type = nextType

		if (previousPort === DEFAULT_CONNECTION_PORT[previousType]) {
			state.edited.port = DEFAULT_CONNECTION_PORT[nextType]
		}

		if (nextType !== 'ALPACA') {
			state.edited.secured = false
		}

		return
	}

	state.edited[name] = value
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

async function discovery() {
	if (state.edited.type === 'ALPACA') {
		try {
			state.alpaca.discovering = true
			const servers = await Api.Alpaca.discovery()
			state.alpaca.servers = servers ?? []
		} finally {
			state.alpaca.discovering = false
		}
	}
}

function save() {
	const edited = { ...state.edited }

	if (edited.id === DEFAULT_CONNECTION.id) {
		// If the edited connection is the default one, we remove it first
		if (state.mode === 'edit') {
			removeOnly(DEFAULT_CONNECTION)
		}

		// Generate a new id for the edited connection
		edited.id = createConnectionId()

		// Add the edited connection to the list
		add(edited)

		// Set the edited connection as the selected one
		state.selected = edited
	} else {
		const index = state.connections.findIndex((e) => e.id === edited.id)

		if (index >= 0) {
			state.connections[index] = edited

			if (state.selected?.id === edited.id) {
				state.selected = edited
			}
		}
	}

	state.show = false
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
		void Api.Connection.disconnect(state.connected.id)
		state.connected = undefined
	} else if (state.selected) {
		try {
			state.loading = true

			const status = await Api.Connection.connect(state.selected)

			if (status) {
				state.connected = status
				state.selected.connectedAt = Date.now()
				state.selected.id = status.id
			}
		} finally {
			state.loading = false
		}
	}
}

function hide() {
	state.show = false
}

export const connection = {
	state,
	create,
	edit,
	update,
	discovery,
	select,
	save,
	connect,
	duplicate,
	remove,
	hide,
} as const
