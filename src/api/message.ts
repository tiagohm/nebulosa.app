import bus from 'src/shared/bus'
import type { IndiPropertyListenEvent } from 'src/shared/types'

const MESSAGE_SEPARATOR = '@'

export interface Messager {
	readonly sendText: (data: string) => void
}

export class WebSocketMessageHandler {
	private readonly sockets = new Set<Messager>()

	open(socket: Messager) {
		if (!this.sockets.has(socket)) {
			this.sockets.add(socket)
			bus.emit('ws:open', socket)
			console.info('web socket connected')
		}
	}

	message(socket: Messager, body: unknown) {
		if (typeof body !== 'string') return

		if (body.startsWith('indi:listen:')) {
			const id = body.slice(12)

			if (id.length > 0) {
				bus.emit('indi:listen', { id, socket } satisfies IndiPropertyListenEvent)
			}
		} else if (body.startsWith('indi:unlisten:')) {
			const id = body.slice(14)

			if (id.length > 0) {
				bus.emit('indi:unlisten', { id, socket } satisfies IndiPropertyListenEvent)
			}
		}
	}

	close(socket: Messager, code: number, reason: string) {
		if (this.sockets.has(socket)) {
			console.info('web socket closed:', code, reason)
			this.sockets.delete(socket)
			bus.emit('ws:close', socket)
		}
	}

	// oxlint-disable-next-line typescript/no-unnecessary-type-parameters
	send<T = unknown>(type: string, message: T | undefined | null, socket?: Messager) {
		// bus.emit(type, message)

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
				bus.emit('ws:close', socket)
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
