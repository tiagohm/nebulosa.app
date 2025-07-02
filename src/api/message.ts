import { molecule } from 'bunshi'
import type { WebSocketMessage } from '../shared/types'

// Interface for sending messages over WebSocket
export interface Messager {
	readonly sendText: (data: string) => void
}

// Molecule for managing WebSocket messages
export const WebSocketMessageMolecule = molecule(() => {
	const sockets = new Set<Messager>()

	// Opens a WebSocket connection
	function open(socket: Messager) {
		if (!sockets.has(socket)) {
			sockets.add(socket)
			console.info('WebSocket connected')
		}
	}

	// Handles incoming WebSocket messages
	function message(socket: Messager, message: string | Buffer) {
		//
	}

	// Closes a WebSocket connection
	function close(socket: Messager, code: number, reason: string) {
		if (sockets.has(socket)) {
			console.info('WebSocket closed: ', code, reason)
			sockets.delete(socket)
		}
	}

	// Sends a message to all connected WebSocket clients
	function send<T extends WebSocketMessage>(message: Readonly<T>) {
		if (sockets.size) {
			const data = JSON.stringify(message)
			sockets.forEach((socket) => socket.sendText(data))
		}
	}

	return { open, message, close, send } as const
})
