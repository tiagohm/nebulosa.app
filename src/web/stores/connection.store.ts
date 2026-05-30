import { nanoid } from 'nanoid'
import type { AlpacaDeviceServer } from 'nebulosa/src/alpaca.discovery'
import bus from 'src/shared/bus'
import type { ConnectionEvent, ConnectionStatus } from 'src/shared/types'
import { proxy } from 'valtio'
import { Api } from '../shared/api'
import { initProxy } from '../shared/proxy'
import { DEFAULT_CONNECTION, type Connection } from '../shared/types'

export type ConnectionStore = typeof connectionStore

export interface ConnectionState {
	readonly activeConnections: ConnectionStatus[]
	readonly connections: Connection[]
	connecting: boolean
	selected?: Connection
	readonly edited: Connection
	readonly alpaca: {
		servers: readonly AlpacaDeviceServer[]
		discovering: boolean
	}
}

export function isNetworkConnection(type: Connection['type']) {
	return type !== 'SIMULATOR'
}

export function ConnectionComparator(a: Connection, b: Connection) {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}

const state = proxy<ConnectionState>({
	activeConnections: [],
	connections: [],
	edited: structuredClone(DEFAULT_CONNECTION),
	connecting: false,
	alpaca: {
		servers: [],
		discovering: false,
	},
})

initProxy(state, 'connection', ['o:edited', 'o:connections'])
state.connections.sort(ConnectionComparator)
state.edited.id = nanoid() // start as new connection

const DEFAULT_CONNECTION_PORT = {
	INDI: DEFAULT_CONNECTION.port,
	ALPACA: 32323,
	SIMULATOR: 0,
} satisfies Record<Connection['type'], number>

bus.subscribe<ConnectionEvent>('connection:open', ({ reused }) => {
	!reused && void list()
})

bus.subscribe<ConnectionEvent>('connection:close', () => {
	void list()
})

async function list() {
	const connections = await Api.Connection.list()

	if (connections !== undefined) {
		state.activeConnections.length = 0
		Object.assign(state.activeConnections, connections)
	}
}

function create() {
	const connection = { ...DEFAULT_CONNECTION, id: nanoid() }
	Object.assign(state.edited, connection)
}

function edit(connection: Connection) {
	const { id, host, port, name, type, secured } = connection
	Object.assign(state.edited, { id, host, port, name, type, secured })
}

function add(connection: Connection) {
	state.connections.push(connection)
}

function duplicate(connection: Connection) {
	const { host, port, name, type, secured } = connection
	add({ id: nanoid(), host, port, name, type, secured })
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

function select(connection: Connection) {
	const selected = state.connections.find((e) => e.id === connection.id)
	if (selected) state.selected = selected
	else return console.warn('unknown connection:', connection)
	edit(selected)
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
	const selected = state.connections.find((e) => e.id === state.edited.id)

	if (selected) {
		Object.assign(selected, state.edited)
	} else {
		add({ ...state.edited })
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
		state.selected = undefined
	} else if (state.selected?.id === connection.id) {
		state.selected = connections[0]
	}
}

async function connect(connection: Connection) {
	if (state.activeConnections.some((c) => c.id === connection.id)) {
		console.warn('already connected:', connection)
		return
	}

	const selected = state.connections.find((e) => e.id === connection.id)

	try {
		state.connecting = true

		const status = await Api.Connection.connect(connection)

		if (status && selected) {
			selected.connectedAt = Date.now()
		}
	} finally {
		state.connecting = false
	}
}

async function disconnect(connection: ConnectionStatus) {
	if (state.activeConnections.some((c) => c.id === connection.id)) {
		await Api.Connection.disconnect(connection.id)
	}
}

async function connectToEdited() {
	await connect(state.edited)
}

async function connectToSelected() {
	if (state.selected !== undefined) await connect(state.selected)
}

function removeEdited() {
	return remove(state.edited)
}

void list()

export const connectionStore = {
	state,
	create,
	edit,
	update,
	discovery,
	select,
	save,
	connect,
	connectToEdited,
	connectToSelected,
	disconnect,
	duplicate,
	remove,
	removeEdited,
} as const
