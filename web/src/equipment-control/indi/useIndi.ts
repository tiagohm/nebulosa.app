import type { IndiDeviceSummary } from 'api'
import { useEffect } from 'react'
import { useSnapshot } from 'valtio'
import { useActiveServerId } from '../../equipment/useEquipment'
import { onOpen, send, subscribe } from '../../events'
import { indiDirectory } from './directory'
import { followIndi, handleIndiEvent, indiView, pauseIndi, resubscribeIndi, unfollowIndi } from './indi'

// React bindings of the INDI Properties view: the INDI directory of the active profile's connection, and the
// subscription of the view to the device it shows, held only while the view is mounted and the page visible.

// Directory with no devices, for the render between a connection switch and the watch effect.
const NO_DEVICES: readonly IndiDeviceSummary[] = []

// Returns the INDI devices of the active profile's connection; none while the directory still follows another
// connection, so a device of a previous connection is never shown as the new one's.
export function useWatchedIndiDevices(): readonly IndiDeviceSummary[] {
	const serverId = useActiveServerId()
	const directory = useSnapshot(indiDirectory)
	return directory.watched === serverId ? directory.devices : NO_DEVICES
}

// Follows the INDI properties of a device while mounted, the device is in the directory (present), and the page
// is visible: hiding the page pauses the subscription, showing it again subscribes for a fresh snapshot, and every
// socket open subscribes again. Unmounting, or a change of device, unsubscribes; nothing else is affected.
export function useIndiSubscription(connectionId: string, hardwareId: string, present: boolean) {
	useEffect(() => {
		if (!present) return undefined

		const target = { connectionId, hardwareId }
		const visible = () => document.visibilityState === 'visible'
		const stopEvents = subscribe((event) => handleIndiEvent(indiView, event))
		const stopOpen = onOpen(() => {
			if (visible()) resubscribeIndi(indiView, send)
		})

		function visibility() {
			if (visible()) followIndi(indiView, target, send)
			else pauseIndi(indiView, send)
		}

		document.addEventListener('visibilitychange', visibility)
		if (visible()) followIndi(indiView, target, send)

		return () => {
			document.removeEventListener('visibilitychange', visibility)
			stopOpen()
			stopEvents()
			unfollowIndi(indiView, send)
		}
	}, [connectionId, hardwareId, present])
}
