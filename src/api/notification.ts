import type { WebSocketMessageHandler } from './message'
import type { Notification } from './types'

const NOTIFICATION_TYPE = 'notification'

// Manager for sending notifications via WebSocket
export class NotificationManager {
	constructor(private readonly webSocketMessageHandler: WebSocketMessageHandler) {}

	// Sends a notification message to all connected WebSocket clients
	send(message: Omit<Notification, 'type'>) {
		this.webSocketMessageHandler.send<Notification>({ ...message, type: NOTIFICATION_TYPE })
	}
}
