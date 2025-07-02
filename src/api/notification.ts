import { molecule } from 'bunshi'
import type { Notification } from '../shared/types'
import { WebSocketMessageMolecule } from './message'

// Molecule for sending notifications via WebSocket
export const NotificationMolecule = molecule((m) => {
	const wsm = m(WebSocketMessageMolecule)

	// Sends a notification message to all connected WebSocket clients
	function send(message: Omit<Notification, 'type'>) {
		wsm.send<Notification>({ ...message, type: 'NOTIFICATION' })
	}

	return { send } as const
})
