import type { WebSocketHandler } from 'bun'
import type { WebSocketMessage } from './types'

// Interface for WebSocket message sending
export interface Messager {
	readonly sendText: (data: string) => void
}

// Handles WebSocket messages and connections
export class WebSocketMessageHandler implements WebSocketHandler {
	private readonly sockets = new Set<Messager>()

	// Open a WebSocket connection
	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('WebSocket connected')
		}
	}

	// Handles incoming WebSocket messages
	message(socket: Messager, message: string | Buffer) {
		//
	}

	// Closes a WebSocket connection
	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('WebSocket closed: ', code, reason)
			this.sockets.delete(socket)
		}
	}

	// Sends a message to all connected WebSocket clients
	send<T extends WebSocketMessage>(message: Readonly<T>) {
		if (this.sockets.size) {
			const data = JSON.stringify(message)
			this.sockets.forEach((socket) => socket.sendText(data))
		}
	}
}
