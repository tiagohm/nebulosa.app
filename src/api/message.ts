import bus from 'src/shared/bus'

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageManager {
	private readonly sockets = new Set<Messager>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('web socket connected')
		}
	}

	message(socket: Messager, message: string | Buffer) {
		//
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('web socket closed: ', code, reason)
			this.sockets.delete(socket)
		}
	}

	send<T = unknown>(type: string, message: T) {
		bus.emit(type, message)

		if (this.sockets.size) {
			const data = `${type}@${JSON.stringify(message)}`
			this.sockets.forEach((socket) => socket.sendText(data))
		}
	}
}
