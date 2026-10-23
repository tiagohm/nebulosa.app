import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { ServerEvent } from './connection'

// WebSocket endpoint that pushes server events to every open browser tab. A tab names itself with the client id
// it opens the socket with (/api/ws?client=<id>), the same for every socket it reopens, so services can keep
// what the tab holds across reconnects.

// What the upgrade attaches to a socket.
export interface WebSocketData {
	// Client id of the tab; absent when it gave none.
	readonly client?: string
}

// Receiver of the sockets of a client that open and close.
export interface ClientListener {
	// A socket of the client opened.
	readonly connected: (client: string) => void
	// A socket of the client closed.
	readonly disconnected: (client: string) => void
}

// Sockets of the currently open tabs.
const sockets = new Set<ServerWebSocket<WebSocketData>>()

// Receivers of the sockets of named clients.
const clientListeners = new Set<ClientListener>()

// Bun WebSocket handler tracking open sockets. Messages from tabs are ignored: the channel is
// server-to-client only.
export const websocket: WebSocketHandler<WebSocketData> = {
	open(ws) {
		sockets.add(ws)
		const { client } = ws.data
		if (client) for (const listener of clientListeners) listener.connected(client)
	},
	message() {},
	close(ws) {
		sockets.delete(ws)
		const { client } = ws.data
		if (client) for (const listener of clientListeners) listener.disconnected(client)
	},
}

// Registers a receiver of the sockets of named clients. Returns a function that removes it.
export function listenClients(listener: ClientListener): () => void {
	clientListeners.add(listener)
	return () => clientListeners.delete(listener)
}

// Sends an event as JSON to every open socket.
export function broadcast(event: ServerEvent) {
	const data = JSON.stringify(event)
	for (const ws of sockets) ws.send(data)
}
