import type { ConnectionStatus, ConnectionType, ConnectRequest, RemoteConnectRequest, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy, snapshot, subscribe } from 'valtio'
import { jsonInit, responseError } from '../http'
import { isRecord, parseJson, readText, writeText } from '../storage'

// Saved connections of the browser and the connections the server holds open. Saved connections are
// persisted in localStorage and shared by every profile and tab; which one a tab works with is the
// active profile's selection. The open connections mirror the server, which shares them between tabs.

// Default TCP port of a new connection: the standard INDI server port.
export const DEFAULT_PORT = 7624

// localStorage key of the saved connections.
export const CONNECTIONS_KEY = 'nebulosa:connections'

// localStorage key of the id of the saved connection last highlighted in the modal's list.
export const SELECTED_CONNECTION_KEY = 'nebulosa:selectedConnectionId'

// Editable fields of a saved connection. Host and port are ignored for simulator connections.
export interface ConnectionInput extends Omit<RemoteConnectRequest, 'type'> {
	// Display name, trimmed and non-empty once saved.
	readonly name: string
	// Backend the connection opens.
	readonly type: ConnectionType
}

// Connection saved in the browser.
export interface Connection extends ConnectionInput {
	// Unique id of the saved entry, generated on first save and kept across edits.
	readonly id: string
}

// Pending connect or disconnect request of the tab.
export interface ConnectionRequest {
	// Request kind.
	readonly kind: 'connect' | 'disconnect'
	// Id of the saved connection it acts on.
	readonly connectionId: string
}

// Shared state of the connections modal and the server connections.
export interface ConnectionState {
	// Whether the connections modal is shown.
	open: boolean
	// Saved connections, in insertion order.
	connections: Connection[]
	// Id of the saved connection highlighted in the modal's list.
	selected?: string
	// Connections the server holds open, for any tab.
	servers: ConnectionStatus[]
	// Pending connect or disconnect request; further requests are ignored until it settles.
	loading?: ConnectionRequest
	// Message of the last failed connect or disconnect of each saved connection, by saved connection id;
	// cleared by its next attempt, an edit, or the server opening it for any tab.
	errors: Record<string, string>
	// Message of the last failed write of the saved connections to storage.
	storageError?: string
}

// Connection state of the tab, starting closed with no saved connections.
export const connectionState = proxy<ConnectionState>({ open: false, connections: [], servers: [], errors: {} })

// Restores a persisted connection. Returns undefined when it lacks an id, name, or type.
function normalizeConnection(value: unknown): Connection | undefined {
	if (!isRecord(value)) return undefined
	const { id, name, host, port, type } = value
	if (typeof id !== 'string' || typeof name !== 'string' || (type !== 'INDI' && type !== 'ALPACA' && type !== 'SIMULATOR')) return undefined
	return { id, name, host: typeof host === 'string' ? host : '', port: typeof port === 'number' ? port : DEFAULT_PORT, type }
}

// Loads the saved connections into state and highlights the one last highlighted, or the first when it
// no longer exists. Unreadable entries are skipped; an unreadable list loads as empty and is left
// untouched until the next change.
export function loadConnections(state: ConnectionState, storage: Storage) {
	const text = readText(storage, CONNECTIONS_KEY)
	const data = text === undefined ? undefined : parseJson(text)
	const connections: Connection[] = []

	if (Array.isArray(data)) {
		for (const value of data) {
			const connection = normalizeConnection(value)
			if (connection && !connections.some((c) => c.id === connection.id)) connections.push(connection)
		}
	}

	const selected = readText(storage, SELECTED_CONNECTION_KEY)
	state.connections = connections
	state.selected = connections.some((c) => c.id === selected) ? selected : connections[0]?.id
}

// Persists every later change of the saved connections and of the highlighted one. Returns a function
// that stops it.
export function persistConnections(state: ConnectionState, storage: Storage): () => void {
	let { connections, selected } = snapshot(state)

	return subscribe(state, () => {
		const current = snapshot(state)

		if (current.selected !== selected) {
			selected = current.selected
			writeText(storage, SELECTED_CONNECTION_KEY, selected ?? '')
		}

		if (current.connections === connections) return
		connections = current.connections
		state.storageError = writeText(storage, CONNECTIONS_KEY, JSON.stringify(connections)) ? undefined : 'Unable to save connections: browser storage is unavailable or full.'
	})
}

// Highlights the given saved connection, such as the one the active profile works with; the current
// highlight stays when it is absent or no longer saved.
export function highlightConnection(state: ConnectionState, connectionId: string | undefined) {
	if (state.connections.some((c) => c.id === connectionId)) state.selected = connectionId
}

// Returns the request that opens a saved connection.
function connectRequest(connection: ConnectionInput): ConnectRequest {
	return connection.type === 'SIMULATOR' ? { type: 'SIMULATOR' } : { type: connection.type, host: connection.host, port: connection.port }
}

// Returns the open server connection of a saved connection's endpoint. Hostnames compare
// case-insensitively, as on the server.
export function serverOf(servers: readonly ConnectionStatus[], connection: ConnectionInput | undefined): ConnectionStatus | undefined {
	if (!connection) return undefined

	return servers.find((s) => {
		if (s.type !== connection.type) return false
		if (s.type === 'SIMULATOR') return true
		return s.host.toLowerCase() === connection.host.toLowerCase() && s.port === connection.port
	})
}

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
	// An edit may change the endpoint, so a previous failure no longer applies.
	delete state.errors[connection.id]

	state.selected = connection.id

	return connection
}

// Removes the connection and selects the first remaining one. Profiles referencing it are updated by
// the caller.
export function removeConnection(state: ConnectionState, id: string) {
	state.connections = state.connections.filter((c) => c.id !== id)
	state.selected = state.connections[0]?.id
	delete state.errors[id]
}

// Records an open server connection, once per id, and clears the failures of the saved connections
// that address it.
function addServer(state: ConnectionState, status: ConnectionStatus) {
	if (!state.servers.some((s) => s.id === status.id)) state.servers.push(status)

	for (const connection of state.connections) {
		if (serverOf([status], connection)) delete state.errors[connection.id]
	}
}

// Replaces the open server connections with the server's current list. Failures leave them unchanged.
export async function refreshServers(state: ConnectionState) {
	try {
		const response = await fetch('/api/connections')
		if (response.ok) state.servers = (await response.json()) as ConnectionStatus[]
	} catch {
		// The server is unreachable; its events resynchronize the list once the socket reopens.
	}
}

// Opens the server connection of a saved connection, or reuses it when another tab opened it. Ignored
// while another request is pending. A failure is stored under the connection's id in state.errors.
export async function connect(state: ConnectionState, connection: Connection) {
	if (state.loading) return

	state.loading = { kind: 'connect', connectionId: connection.id }
	delete state.errors[connection.id]

	try {
		const response = await fetch('/api/connections', jsonInit('POST', connectRequest(connection)))

		if (response.ok) addServer(state, (await response.json()) as ConnectionStatus)
		else state.errors[connection.id] = await responseError(response)
	} catch (error) {
		state.errors[connection.id] = error instanceof Error ? error.message : 'Unable to connect'
	} finally {
		state.loading = undefined
	}
}

// Closes the server connection of a saved connection, for every tab sharing it. A connection the server
// no longer has (404) is treated as closed. A failure is stored under the connection's id in state.errors.
export async function disconnect(state: ConnectionState, connection: Connection) {
	const server = serverOf(state.servers, connection)
	if (state.loading || !server) return

	state.loading = { kind: 'disconnect', connectionId: connection.id }
	delete state.errors[connection.id]

	try {
		const response = await fetch(`/api/connections/${encodeURIComponent(server.id)}`, { method: 'DELETE' })

		if (response.ok || response.status === 404) state.servers = state.servers.filter((s) => s.id !== server.id)
		else state.errors[connection.id] = await responseError(response)
	} catch (error) {
		state.errors[connection.id] = error instanceof Error ? error.message : 'Unable to disconnect'
	} finally {
		state.loading = undefined
	}
}

// Applies a server event: an open or close from any tab, or from the server itself, updates the open
// server connections.
export function handleConnectionEvent(state: ConnectionState, event: ServerEvent) {
	if (event.type === 'connection:open') addServer(state, event.connection)
	else if (event.type === 'connection:close') state.servers = state.servers.filter((s) => s.id !== event.id)
}
