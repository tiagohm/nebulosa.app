import { Api } from '@shared/api'
import { connectionBus } from '@shared/bus'
import { initProxy } from '@shared/proxy'
import { nanoid } from 'nanoid'
import type { AlpacaDeviceServer } from 'nebulosa/src/devices/alpaca/discovery'
import type { ClientType } from 'nebulosa/src/devices/indi/device'
import { unsubscribe } from 'src/shared/util'
import { DEFAULT_CONNECTION_PORTS, connectionComparator, DEFAULT_CONNECTION } from 'src/types/connection'
import type { Connection, ConnectionStatus } from 'src/types/connection'
import { proxy } from 'valtio'

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

let mounted = false
const u: VoidFunction[] = []

function mount() {
	if (mounted) return unmount

	console.info('connection mounted')

	mounted = true

	u[0] = initProxy(state, 'connection', ['o:edited', 'o:connections'])
	state.connections.sort(connectionComparator)
	state.edited.id = nanoid() // start as new connection

	u[1] = connectionBus.subscribe('open', ({ reused }) => {
		!reused && void list()
	})

	u[2] = connectionBus.subscribe('close', () => {
		void list()
	})

	void list()

	return unmount
}

function unmount() {
	if (!mounted) return
	console.info('connection unmounted')
	unsubscribe(u)
	mounted = false
}

async function list() {
	const connections = await Api.Connection.list()

	if (connections !== undefined) {
		state.activeConnections.length = 0
		Object.assign(state.activeConnections, connections)
	}
}

function create() {
	state.selected = undefined
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

function setName(value: string) {
	state.edited.name = value
}

function setHost(value: string) {
	state.edited.host = value
}

function setPort(value: number) {
	state.edited.port = value
}

function setType(value: ClientType) {
	const previousType = state.edited.type
	const previousPort = state.edited.port

	state.edited.type = value

	if (previousPort === DEFAULT_CONNECTION_PORTS[previousType]) {
		state.edited.port = DEFAULT_CONNECTION_PORTS[value]
	}

	if (value !== 'ALPACA') {
		state.edited.secured = false
	}
}

function setSecured(value: boolean) {
	state.edited.secured = value
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

export const connectionStore = {
	state,
	mount,
	unmount,
	create,
	edit,
	setName,
	setHost,
	setPort,
	setType,
	setSecured,
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
