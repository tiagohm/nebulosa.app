import type { ConnectionEvent, ConnectionStatus, ConnectionType, ConnectRequest } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import type { RemoteConnectRequest } from '../../../api/src/connection'

// Saved connections of the tab and the single server connection the tab holds open.

// Default TCP port of a new connection: the standard INDI server port.
export const DEFAULT_PORT = 7624

// Editable fields of a saved connection. Host and port are ignored for simulator connections.
export interface ConnectionInput extends Omit<RemoteConnectRequest, 'type'> {
	// Display name, trimmed and non-empty once saved.
	readonly name: string
	// Backend the connection opens.
	readonly type: ConnectionType
}

// Connection saved in the tab.
export interface Connection extends ConnectionInput {
	// Unique id of the saved entry, generated on first save and kept across edits.
	readonly id: string
}

// Server connection held open by this tab.
export interface ActiveConnection {
	// Id of the saved connection it was opened from.
	readonly connectionId: string
	// Id of the open connection on the server, shared by every tab connected to the same endpoint.
	readonly serverId: string
}

// Shared state of the connections modal.
export interface ConnectionState {
	// Whether the connections modal is shown.
	open: boolean
	// Saved connections, in insertion order.
	connections: Connection[]
	// Id of the saved connection selected in the list.
	selected?: string
	// The tab's open connection; a tab holds at most one.
	active?: ActiveConnection
	// Pending connect or disconnect request; further requests are ignored until it settles.
	loading?: 'connect' | 'disconnect'
	// Message of the last failed connect or disconnect, cleared by the next attempt.
	error?: string
}

// Connection state of the tab, starting closed with no saved connections.
export const connectionState = proxy<ConnectionState>({ open: false, connections: [] })

// Adds a connection, or replaces the one with the given id, and selects it.
// Returns undefined when the name is blank, or the host is blank for a non-simulator connection.
export function saveConnection(state: ConnectionState, input: ConnectionInput, id?: string): Connection | undefined {
	const name = input.name.trim()
	const host = input.host.trim()
	if (!name || (!host && input.type !== 'SIMULATOR')) return undefined

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

// Reads the error message of a failed API response, falling back to its status text.
async function responseError(response: Response): Promise<string> {
	try {
		const body = (await response.json()) as { error?: unknown }
		if (typeof body.error === 'string') return body.error
	} catch {
		// Not a JSON error body.
	}

	return `${response.status} ${response.statusText}`.trim()
}

// Opens the server connection for a saved connection and makes it the tab's active one. Ignored while
// another request is pending or the tab already holds a connection. Failures are stored in state.error.
export async function connect(state: ConnectionState, connection: Connection) {
	if (state.loading || state.active) return

	state.loading = 'connect'
	state.error = undefined

	const request: ConnectRequest = connection.type === 'SIMULATOR' ? { type: 'SIMULATOR' } : { type: connection.type, host: connection.host, port: connection.port }

	try {
		const response = await fetch('/api/connections', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) })

		if (response.ok) {
			const status = (await response.json()) as ConnectionStatus
			state.active = { connectionId: connection.id, serverId: status.id }
		} else {
			state.error = await responseError(response)
		}
	} catch (error) {
		state.error = error instanceof Error ? error.message : 'Unable to connect'
	} finally {
		state.loading = undefined
	}
}

// Closes the tab's active connection on the server, for every tab sharing it. A connection the server
// no longer has (404) is treated as closed. Failures are stored in state.error.
export async function disconnect(state: ConnectionState) {
	const active = state.active
	if (state.loading || !active) return

	state.loading = 'disconnect'
	state.error = undefined

	try {
		const response = await fetch(`/api/connections/${encodeURIComponent(active.serverId)}`, { method: 'DELETE' })

		if (response.ok || response.status === 404) {
			if (state.active?.serverId === active.serverId) state.active = undefined
		} else {
			state.error = await responseError(response)
		}
	} catch (error) {
		state.error = error instanceof Error ? error.message : 'Unable to disconnect'
	} finally {
		state.loading = undefined
	}
}

// Applies a server event: a close of the tab's active connection, from any tab or from the server
// itself, releases it.
export function handleConnectionEvent(state: ConnectionState, event: ConnectionEvent) {
	if (event.type === 'connection:close' && state.active?.serverId === event.id) {
		state.active = undefined
	}
}
