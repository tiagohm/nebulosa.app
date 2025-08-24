import { addToast } from '@heroui/react'
import { molecule } from 'bunshi'
import type { Notification } from 'src/shared/types'

export const NotificationMolecule = molecule(() => {
	function send(notification: Omit<Notification, 'type'>) {
		addToast({ title: 'ERROR', description: notification.body, color: 'danger' })
	}

	return { send }
})
