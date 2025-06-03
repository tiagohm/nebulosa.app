import type { WebSocketMessageHandler } from './message'
import type { Notification } from './types'

const NOTIFICATION_TYPE = 'NOTIFICATION'

export class NotificationSender {
	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {}

	send(message: Omit<Notification, 'type'>) {
		this.webSocketMessageHandler.send<Notification>({ ...message, type: NOTIFICATION_TYPE })
	}
}
