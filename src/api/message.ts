import type { WebSocketMessage } from '../shared/types'

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageManager {
	private readonly sockets = new Set<Messager>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('WebSocket connected')
		}
	}

	message(socket: Messager, message: string | Buffer) {
		//
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('WebSocket closed: ', code, reason)
			this.sockets.delete(socket)
		}
	}

	send<T extends WebSocketMessage>(message: Readonly<T>) {
		if (this.sockets.size) {
			const data = JSON.stringify(message)
			this.sockets.forEach((socket) => socket.sendText(data))
		}
	}
}
