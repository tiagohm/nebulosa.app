import type { Notification } from '../shared/types'
import type { WebSocketMessageHandler } from './message'

export class NotificationHandler {
	constructor(readonly wsm: WebSocketMessageHandler) {}

	send(message: Notification) {
		this.wsm.send('notification', message)
	}
}
