import type { Notification } from '#/notification'
import type { WebSocketMessageHandler } from './message'

export class NotificationHandler {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	send(message: Notification) {
		this.wsm.send('notification', message)
	}
}
