import bus from 'src/shared/bus'

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageManager {
	private readonly sockets = new Set<Messager>()
	private readonly events = new Map<string, unknown>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			console.info('web socket connected')
		}
	}

	message(socket: Messager, message: unknown) {
		if (message === 'RESEND') {
			this.resend(undefined, socket)
			return
		}
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('web socket closed:', code, reason)
			this.sockets.delete(socket)
		}
	}

	send<T = unknown>(type: string, message: T, socket?: Messager) {
		bus.emit(type, message)

		if (this.sockets.size) {
			const data = `${type}@${JSON.stringify(message)}`

			if (socket) {
				socket.sendText(data)
			} else {
				this.sockets.forEach((socket) => socket.sendText(data))

				if (!type.endsWith(':add') && !type.endsWith(':remove')) {
					this.events.set(type, message)
				}
			}
		}
	}

	resend(type?: string, socket?: Messager) {
		if (!this.events.size) return

		console.info('web socket resending')

		if (!type) {
			this.events.forEach((message, type) => this.send(type, message, socket))
		} else {
			const message = this.events.get(type)
			message !== undefined && this.send(type, message, socket)
		}
	}

	event<T = unknown>(type: string) {
		return this.events.get(type) as T | undefined
	}
}
