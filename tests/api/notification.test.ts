import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { WebSocketMessageHandler, type Messager } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import type { Notification } from 'src/shared/types'
import { SocketMessager } from './util'

const wsm = new WebSocketMessageHandler()
const notificationHandler = new NotificationHandler(wsm)
const socket = new SocketMessager()
const secondarySocket = new SocketMessager()

afterEach(() => {
	wsm.close(socket, 1000, 'reset')
	wsm.close(secondarySocket, 1000, 'reset')
	socket.clear()
	secondarySocket.clear()
})

function notification(overrides: Partial<Notification> = {}): Notification {
	return { color: 'success', title: 'NOTIFICATION', description: 'Notification description', ...overrides }
}

describe('notification handler', () => {
	test('sends notification through websocket message handler', () => {
		const message = notification()

		wsm.open(socket)
		notificationHandler.send(message)

		expect(socket.messages).toEqual([{ type: 'notification', body: message }])
	})

	test('broadcasts notification to all open sockets', () => {
		const message = notification({ color: 'warning', title: 'BROADCAST' })

		wsm.open(socket)
		wsm.open(secondarySocket)
		notificationHandler.send(message)

		expect(socket.messages).toEqual([{ type: 'notification', body: message }])
		expect(secondarySocket.messages).toEqual([{ type: 'notification', body: message }])
	})

	test('does not send to closed sockets', () => {
		const message = notification({ color: 'danger', title: 'CLOSED' })

		wsm.open(socket)
		wsm.open(secondarySocket)
		wsm.close(socket, 1000, 'closed')
		notificationHandler.send(message)

		expect(socket.messages).toHaveLength(0)
		expect(secondarySocket.messages).toEqual([{ type: 'notification', body: message }])
	})

	test('preserves notification target and payload fields', () => {
		const message = notification({ target: 'camera', color: 'primary', title: 'CAMERA', description: 'Camera notification' })

		wsm.open(socket)
		notificationHandler.send(message)

		expect(socket.find<Notification>((entry) => entry.type === 'notification')?.body).toEqual(message)
	})

	test('does nothing when there are no open sockets', () => {
		expect(() => notificationHandler.send(notification())).not.toThrow()
		expect(socket.messages).toHaveLength(0)
	})

	test('removes a socket that fails while sending', () => {
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const failingSocket: Messager = {
			sendText() {
				throw new Error('send failed')
			},
		}
		const message = notification({ title: 'RETRY' })

		try {
			wsm.open(failingSocket)
			wsm.open(socket)
			notificationHandler.send(message)
			socket.clear()
			notificationHandler.send(message)

			expect(socket.messages).toEqual([{ type: 'notification', body: message }])
			expect(error).toHaveBeenCalledTimes(1)
		} finally {
			wsm.close(failingSocket, 1000, 'done')
			error.mockRestore()
		}
	})
})
