import type { MountRemoteProtocol, MountRemoteServer, MountRemoteSnapshot, MountRemoteStartRequest, ServerEvent } from 'api'
import { proxy } from 'valtio'
import { jsonInit, responseError } from '../../http'

// Mirror of the Mount Remote Control listeners of the server, of every mount and connection, and the requests this tab
// sends to start and stop them and to close their clients. The listeners are the server's: this mirror is fed by
// GET /api/mount-remote-control and the mountRemoteControl:updated events, and no tab, profile, or route change starts,
// stops, or rebinds one. Revisions order the snapshot and the events within one server process (epoch), so a snapshot
// or a start response older than an event already applied never brings back a stopped listener.

// Listeners known to the tab and the requests in flight.
export interface MountRemoteControlState {
	// Server process the listeners belong to; absent before the first snapshot or event.
	epoch?: string
	// Latest revision applied from the server.
	revision: number
	// Running listeners by remoteKey.
	servers: Record<string, MountRemoteServer>
	// Start or stop request in flight, by remoteKey.
	pending: Record<string, 'start' | 'stop'>
	// Disconnections in flight, by clientKey.
	disconnecting: Record<string, true>
	// Why the last request of a listener failed, by remoteKey.
	errors: Record<string, string>
}

// Display name of each protocol.
export const MOUNT_REMOTE_PROTOCOL_LABELS: Readonly<Record<MountRemoteProtocol, string>> = { lx200: 'LX200', stellarium: 'Stellarium' }

// Listeners of the server, shared by every view of the tab.
export const mountRemoteControlState = proxy<MountRemoteControlState>({ revision: 0, servers: {}, pending: {}, disconnecting: {}, errors: {} })

// Generation of the latest snapshot request; an older response is dropped.
let generation = 0

// Key of a listener: the exact mount of an open connection and the protocol.
export function remoteKey(connectionId: string, deviceId: string, protocol: MountRemoteProtocol) {
	return JSON.stringify([connectionId, deviceId, protocol])
}

// Key of one client of a listener.
export function clientKey(key: string, clientId: string) {
	return `${key}#${clientId}`
}

// Address of a client as IP:port, with an IPv6 address in brackets.
export function formatEndpoint(ip: string, port: number) {
	return ip.includes(':') ? `[${ip}]:${port}` : `${ip}:${port}`
}

// Whether a host only accepts clients of this machine.
export function isLoopback(host: string) {
	const name = host.trim().toLowerCase()
	return name === 'localhost' || name.startsWith('127.') || name === '::1' || name === '[::1]'
}

// Replaces the listeners with a snapshot of the server, unless it is older than the events already applied.
export function applyMountRemoteSnapshot(state: MountRemoteControlState, snapshot: MountRemoteSnapshot) {
	if (snapshot.epoch === state.epoch && snapshot.revision < state.revision) return
	state.epoch = snapshot.epoch
	state.revision = snapshot.revision
	state.servers = Object.fromEntries(snapshot.servers.map((server) => [remoteKey(server.connectionId, server.deviceId, server.protocol), server]))
	forgetDisconnected(state)
}

// Fetches the listeners again; called on every socket (re)open, since they may have changed while it was closed.
export async function refreshMountRemoteControl(state: MountRemoteControlState, request: typeof fetch = fetch) {
	const current = ++generation

	try {
		const response = await request('/api/mount-remote-control')
		if (!response.ok || current !== generation) return
		const snapshot = (await response.json()) as MountRemoteSnapshot
		if (current === generation) applyMountRemoteSnapshot(state, snapshot)
	} catch {
		// The server is unreachable; the next socket open refreshes the listeners.
	}
}

// Applies a listener event; any other event is ignored. An event of another server process starts over from it, and
// an event already contained in what the tab knows is dropped.
export function handleMountRemoteControlEvent(state: MountRemoteControlState, event: ServerEvent) {
	if (event.type !== 'mountRemoteControl:updated') return

	if (event.epoch !== state.epoch) {
		state.epoch = event.epoch
		state.servers = {}
	} else if (event.revision <= state.revision) {
		return
	}

	state.revision = event.revision
	const { connectionId, deviceId, protocol } = event.key
	const key = remoteKey(connectionId, deviceId, protocol)

	if (event.server) state.servers[key] = event.server
	else delete state.servers[key]

	forgetDisconnected(state)
}

// Starts the listener of a protocol for a mount with a binding. Returns whether it runs; a failure is kept in errors.
export async function startRemoteServer(state: MountRemoteControlState, connectionId: string, deviceId: string, protocol: MountRemoteProtocol, binding: MountRemoteStartRequest, request: typeof fetch = fetch) {
	const key = remoteKey(connectionId, deviceId, protocol)
	if (state.pending[key]) return false

	state.pending[key] = 'start'
	delete state.errors[key]

	try {
		const response = await request(`${remoteUrl(connectionId, deviceId, protocol)}/start`, jsonInit('POST', binding))

		if (!response.ok) {
			state.errors[key] = await responseError(response, 'The server could not be started.')
			return false
		}

		const server = (await response.json()) as MountRemoteServer
		// Its event may have been applied already, or a later one stopped it again.
		if (server.revision > state.revision) state.servers[key] = server
		return true
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Stops the listener of a protocol for a mount; it disappears with its event. Returns whether the stop succeeded.
export async function stopRemoteServer(state: MountRemoteControlState, connectionId: string, deviceId: string, protocol: MountRemoteProtocol, request: typeof fetch = fetch) {
	const key = remoteKey(connectionId, deviceId, protocol)
	if (state.pending[key]) return false

	state.pending[key] = 'stop'
	delete state.errors[key]

	try {
		const response = await request(`${remoteUrl(connectionId, deviceId, protocol)}/stop`, { method: 'POST' })
		if (response.ok) return true
		state.errors[key] = await responseError(response, 'The server could not be stopped.')
		return false
	} catch {
		state.errors[key] = 'The server is unreachable.'
		return false
	} finally {
		delete state.pending[key]
	}
}

// Closes one client of a listener; its row disappears with the event. A client that left meanwhile is not an error.
export async function disconnectRemoteClient(state: MountRemoteControlState, server: Pick<MountRemoteServer, 'connectionId' | 'deviceId' | 'protocol'>, clientId: string, request: typeof fetch = fetch) {
	const { connectionId, deviceId, protocol } = server
	const key = remoteKey(connectionId, deviceId, protocol)
	const pending = clientKey(key, clientId)
	if (state.disconnecting[pending]) return

	state.disconnecting[pending] = true
	delete state.errors[key]

	try {
		const response = await request(`${remoteUrl(connectionId, deviceId, protocol)}/clients/${encodeURIComponent(clientId)}`, { method: 'DELETE' })
		if (!response.ok) state.errors[key] = await responseError(response, 'The client could not be disconnected.')
	} catch {
		state.errors[key] = 'The server is unreachable.'
	} finally {
		if (!state.servers[key]?.clients.some((client) => client.id === clientId)) delete state.disconnecting[pending]
	}
}

// Base URL of the routes of a listener.
function remoteUrl(connectionId: string, deviceId: string, protocol: MountRemoteProtocol) {
	return `/api/connections/${encodeURIComponent(connectionId)}/mounts/${encodeURIComponent(deviceId)}/remote-control/${protocol}`
}

// Ends the pending disconnections of clients that are no longer connected.
function forgetDisconnected(state: MountRemoteControlState) {
	for (const pending of Object.keys(state.disconnecting)) {
		const separator = pending.lastIndexOf('#')
		const server = state.servers[pending.slice(0, separator)]
		const id = pending.slice(separator + 1)
		if (!server?.clients.some((client) => client.id === id)) delete state.disconnecting[pending]
	}
}
