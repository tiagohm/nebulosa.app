import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { ServerEvent } from './connection'

// WebSocket endpoint that pushes server events to every open browser tab.

// Sockets of the currently open tabs.
const sockets = new Set<ServerWebSocket>()

// Bun WebSocket handler tracking open sockets. Messages from tabs are ignored: the channel is
// server-to-client only.
export const websocket: WebSocketHandler<undefined> = {
	open(ws) {
		sockets.add(ws)
	},
	message() {},
	close(ws) {
		sockets.delete(ws)
	},
}

// Sends an event as JSON to every open socket.
export function broadcast(event: ServerEvent) {
	const data = JSON.stringify(event)
	for (const ws of sockets) ws.send(data)
}
