import type { WebSocketHandler } from 'bun'
import type { WebSocketMessage } from './types'

export interface MessageSender {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageHandler implements WebSocketHandler {
	private readonly sockets = new Set<MessageSender>()

	open(socket: MessageSender) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('WebSocket connected')
		}
	}

	message(socket: MessageSender, message: string | Buffer) {
		//
	}

	close(socket: MessageSender, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('WebSocket closed: ', code, reason)
			this.sockets.delete(socket)
		}
	}

	send<T extends WebSocketMessage>(message: T) {
		if (this.sockets.size) {
			const data = JSON.stringify(message)
			this.sockets.forEach((socket) => socket.sendText(data))
		}
	}
}
