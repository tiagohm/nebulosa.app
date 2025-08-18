import type { WebSocketMessage } from '../shared/types'

// Interface for sending messages over WebSocket
export interface Messager {
	readonly sendText: (data: string) => void
}

// Manager for managing WebSocket messages
export class WebSocketMessageManager {
	private readonly sockets = new Set<Messager>()

	// Opens a WebSocket connection
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
