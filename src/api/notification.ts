import type { Notification } from '../shared/types'
import type { WebSocketMessageManager } from './message'

export class NotificationManager {
	constructor(readonly wsm: WebSocketMessageManager) {}

	send(message: Omit<Notification, 'type'>) {
		;(message as Record<string, unknown>).type = 'notification'
		this.wsm.send<Notification>(message as never)
	}
}
