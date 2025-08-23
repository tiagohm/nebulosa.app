import type { Notification } from '../shared/types'
import type { WebSocketMessageManager } from './message'

export class NotificationService {
	constructor(readonly wsm: WebSocketMessageManager) {}

	send(message: Omit<Notification, 'type'>) {
		this.wsm.send<Notification>({ ...message, type: 'NOTIFICATION' })
	}
}
