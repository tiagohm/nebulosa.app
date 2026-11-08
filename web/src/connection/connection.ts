import type { ConnectionStatus, ConnectionType, ConnectRequest, RemoteConnectRequest, ServerEvent } from 'api'
import { nanoid } from 'nanoid'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../http'
import { SnapshotRefreshes } from '../refresh'

// Saved connections of the workspace and the connections the server holds open. Saved connections belong to the server
// (sync.ts of the profiles) and are shared by every profile, tab, and browser; the actions here change the tab at once,
// and the synchronization writes what changed. Which one a tab works with is the active profile's selection. The open
// connections mirror the server, which shares them between tabs.

// Default TCP port of a new connection: the standard INDI server port.
export const DEFAULT_PORT = 7624

// Editable fields of a saved connection. Host and port are ignored for simulator connections.
export interface ConnectionInput extends Omit<RemoteConnectRequest, 'type'> {
	// Display name, trimmed and non-empty once saved.
	readonly name: string
	// Backend the connection opens.
	readonly type: ConnectionType
}

// Connection saved in the workspace.
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
	// Id of the saved connection highlighted in the modal's list; tab memory.
	selected?: string
	// Connections the server holds open, for any tab.
	servers: ConnectionStatus[]
	// Pending connect or disconnect request; further requests are ignored until it settles.
	loading?: ConnectionRequest
	// Message of the last failed connect or disconnect of each saved connection, by saved connection id;
	// cleared by its next attempt, an edit, or the server opening it for any tab.
	errors: Record<string, string>
}

// Connection state of the tab, starting closed with no saved connections.
export const connectionState = proxy<ConnectionState>({ open: false, connections: [], servers: [], errors: {} })

// Highlights the given saved connection, such as the one the active profile works with; the current
// highlight stays when it is absent or no longer saved.
export function highlightConnection(state: ConnectionState, connectionId: string | undefined) {
	if (state.connections.some((c) => c.id === connectionId)) state.selected = connectionId
}

// Returns the request that opens a saved connection.
function connectRequest(connection: ConnectionInput): ConnectRequest {
	return connection.type === 'SIMULATOR' ? { type: 'SIMULATOR' } : { type: connection.type, host: connection.host, port: connection.port }
}

// Whether a server endpoint is the endpoint of a saved connection. Hostnames compare case-insensitively, as on the
// server.
export function sameEndpoint(endpoint: ConnectRequest, connection: ConnectionInput) {
	if (endpoint.type !== connection.type) return false
	if (endpoint.type === 'SIMULATOR') return true
	return endpoint.host.toLowerCase() === connection.host.toLowerCase() && endpoint.port === connection.port
}

// Returns the open server connection of a saved connection's endpoint.
export function serverOf(servers: readonly ConnectionStatus[], connection: ConnectionInput | undefined): ConnectionStatus | undefined {
	return connection && servers.find((s) => sameEndpoint(s, connection))
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

// Refreshes of the open server connections, ordered against the events and answers that open or close one meanwhile.
const serverRefreshes = new SnapshotRefreshes()

// Records an open server connection, once per id, and clears the failures of the saved connections
// that address it.
function addServer(state: ConnectionState, status: ConnectionStatus) {
	serverRefreshes.updated(status.id)
	if (!state.servers.some((s) => s.id === status.id)) state.servers.push(status)

	for (const connection of state.connections) {
		if (serverOf([status], connection)) delete state.errors[connection.id]
	}
}

// Replaces the open server connections with the server's current list, but for a connection an event or an answer opened
// or closed while the list was fetched, which stays as that left it. Failures leave them unchanged.
export async function refreshServers(state: ConnectionState, request: typeof fetch = fetch) {
	const token = serverRefreshes.start()

	try {
		const response = await request('/api/connections')
		if (!response.ok || !serverRefreshes.current(token)) return
		const listed = (await response.json()) as ConnectionStatus[]
		if (!serverRefreshes.current(token)) return
		const kept = state.servers.filter(({ id }) => serverRefreshes.changed(id))
		state.servers = [...listed.filter(({ id }) => !serverRefreshes.changed(id)), ...kept]
	} catch {
		// The server is unreachable; its events resynchronize the list once the socket reopens.
	} finally {
		serverRefreshes.end(token)
	}
}

// Forgets an open server connection that closed.
function removeServer(state: ConnectionState, id: string) {
	serverRefreshes.updated(id)
	state.servers = state.servers.filter((s) => s.id !== id)
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

		if (response.ok || response.status === 404) removeServer(state, server.id)
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
	else if (event.type === 'connection:close') removeServer(state, event.id)
}
