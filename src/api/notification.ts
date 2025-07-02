import { molecule } from 'bunshi'
import { WebSocketMessageMolecule } from './message'
import type { Notification } from './types'

// Molecule for sending notifications via WebSocket
export const NotificationMolecule = molecule((m) => {
	const wsm = m(WebSocketMessageMolecule)

	// Sends a notification message to all connected WebSocket clients
	function send(message: Omit<Notification, 'type'>) {
		wsm.send<Notification>({ ...message, type: 'NOTIFICATION' })
	}

	return { send } as const
})
