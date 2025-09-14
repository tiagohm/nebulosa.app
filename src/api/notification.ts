import type { Notification } from '../shared/types'
import type { WebSocketMessageManager } from './message'

export class NotificationManager {
	constructor(readonly wsm: WebSocketMessageManager) {}

	send(message: Notification) {
		this.wsm.send('notification', message)
	}
}
