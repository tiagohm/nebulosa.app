import { EventBus } from 'src/shared/bus'
import { indiBus } from './indi'

const MESSAGE_SEPARATOR = '@'

export interface WebSocketBusEvents {
	readonly open: Messager
	readonly close: Messager
}

export const webSocketBus = new EventBus<WebSocketBusEvents>()

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageHandler {
	private readonly sockets = new Set<Messager>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			webSocketBus.emit('open', socket)
			console.info('web socket connected')
		}
	}

	message(socket: Messager, body: unknown) {
		if (typeof body !== 'string') return

		if (body.startsWith('indi:listen:')) {
			const id = body.slice(12)

			if (id.length > 0) {
				indiBus.emit('listen', { id, socket })
			}
		} else if (body.startsWith('indi:unlisten:')) {
			const id = body.slice(14)

			if (id.length > 0) {
				indiBus.emit('unlisten', { id, socket })
			}
		}
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('web socket closed:', code, reason)
			this.sockets.delete(socket)
			webSocketBus.emit('close', socket)
		}
	}

	send<T = unknown>(type: string, message: T | undefined | null, socket?: Messager) {
		const data = serializeMessage(type, message)

		if (data === undefined) return

		if (socket) {
			this.sendText(socket, data)
		} else if (this.sockets.size > 0) {
			for (const socket of this.sockets) this.sendText(socket, data)
		}
	}

	private sendText(socket: Messager, data: string) {
		try {
			socket.sendText(data)
		} catch (e) {
			if (this.sockets.delete(socket)) {
				webSocketBus.emit('close', socket)
			}

			console.error('failed to send web socket message', e)
		}
	}
}

function serializeMessage(type: string, message: unknown) {
	if (type.length === 0 || type.includes(MESSAGE_SEPARATOR)) return
	if (message === undefined || message === null) return `${type}${MESSAGE_SEPARATOR}`

	try {
		return `${type}${MESSAGE_SEPARATOR}${JSON.stringify(message) ?? ''}`
	} catch (e) {
		console.error('failed to serialize web socket message', e)
	}
}
