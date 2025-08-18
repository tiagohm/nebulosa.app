import type { Notification } from '../shared/types'
import type { WebSocketMessageManager } from './message'

// Service for sending notifications via WebSocket
export class NotificationService {
	constructor(readonly wsm: WebSocketMessageManager) {}

	// Sends a notification message to all connected WebSocket clients
	send(message: Omit<Notification, 'type'>) {
		this.wsm.send<Notification>({ ...message, type: 'NOTIFICATION' })
	}
}
