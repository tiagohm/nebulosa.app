import { nanoid } from 'nanoid'
import { proxy } from 'valtio'

export const CONNECTION_TYPES = ['INDI', 'ALPACA', 'SIMULATOR'] as const

export type ConnectionType = (typeof CONNECTION_TYPES)[number]

export const DEFAULT_PORT = 7624

export interface ConnectionInput {
	readonly name: string
	readonly host: string
	readonly port: number
	readonly type: ConnectionType
}

export interface Connection extends ConnectionInput {
	readonly id: string
}

export interface ConnectionState {
	open: boolean
	connections: Connection[]
	selected?: string
}

export const connectionState = proxy<ConnectionState>({ open: false, connections: [] })

// Adds a connection, or replaces the one with the given id, and selects it.
// Returns undefined when the name or host is blank.
export function saveConnection(state: ConnectionState, input: ConnectionInput, id?: string): Connection | undefined {
	const name = input.name.trim()
	const host = input.host.trim()
	if (!name || !host) return undefined

	const index = state.connections.findIndex((c) => c.id === id)
	const connection: Connection = { id: index >= 0 && id ? id : nanoid(), name, host, port: input.port, type: input.type }
	if (index >= 0) state.connections[index] = connection
	else state.connections.push(connection)

	state.selected = connection.id

	return connection
}

// Removes the connection and selects the first remaining one.
export function removeConnection(state: ConnectionState, id: string) {
	state.connections = state.connections.filter((c) => c.id !== id)
	state.selected = state.connections[0]?.id
}
