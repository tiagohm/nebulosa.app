import { useEffect } from 'react'
import { onClose, onOpen, send, subscribe } from '../../events'
import { disconnectMessages, followMessages, handleMessagesEvent, indiMessagesView, pauseMessages, resubscribeMessages, unfollowMessages } from './messages'

// React binding of the Messages view: the subscription of the view to the device it shows, held only while the view
// is mounted, the device is in the directory, and the page is visible.

// Follows the messages of a device while mounted, the device is in the directory (present), and the page is visible:
// hiding the page pauses the subscription, showing it again subscribes for a fresh snapshot, a closed socket marks
// the view disconnected, and every socket open subscribes again. Unmounting, or a change of device, unsubscribes.
export function useIndiMessages(connectionId: string, hardwareId: string, present: boolean) {
	useEffect(() => {
		if (!present) return undefined

		const target = { connectionId, hardwareId }
		const visible = () => document.visibilityState === 'visible'
		const stopEvents = subscribe((event) => handleMessagesEvent(indiMessagesView, event))
		const stopClose = onClose(() => disconnectMessages(indiMessagesView))
		const stopOpen = onOpen(() => {
			if (visible()) resubscribeMessages(indiMessagesView, send)
		})

		function visibility() {
			if (visible()) followMessages(indiMessagesView, target, send)
			else pauseMessages(indiMessagesView, send)
		}

		document.addEventListener('visibilitychange', visibility)
		if (visible()) followMessages(indiMessagesView, target, send)

		return () => {
			document.removeEventListener('visibilitychange', visibility)
			stopOpen()
			stopClose()
			stopEvents()
			unfollowMessages(indiMessagesView, send)
		}
	}, [connectionId, hardwareId, present])
}
