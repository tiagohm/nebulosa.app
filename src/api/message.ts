import bus from 'src/shared/bus'

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageHandler {
	private readonly sockets = new Set<Messager>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('web socket connected')
		}
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('web socket closed:', code, reason)
			this.sockets.delete(socket)
		}
	}

	send<T extends object>(type: string, message: T | undefined | null, socket?: Messager) {
		bus.emit(type, message)

		if (this.sockets.size) {
			const data = `${type}@${message ? JSON.stringify(message) : ''}`

			if (socket) {
				socket.sendText(data)
			} else {
				this.sockets.forEach((socket) => socket.sendText(data))
			}
		}
	}
}
