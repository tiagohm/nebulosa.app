import { useSnapshot } from 'valtio'
import { type Connection, connectionState } from '../connection/connection'
import { activeProfile, profileState } from '../profile/profile'

// React binding of what decides which notifications the tab lists and counts: the saved connection of the active
// profile.

// Scope of the notification lists of the tab.
export interface NotificationScope {
	// Saved connection the active profile selected; absent when none is selected or it was removed.
	readonly connection?: Connection
}

// Returns the scope of the notification lists of the tab.
export function useNotificationScope(): NotificationScope {
	const profiles = useSnapshot(profileState)
	const { connections } = useSnapshot(connectionState)
	const profile = profiles.profiles.length > 0 ? activeProfile(profiles) : undefined
	return { connection: connections.find((c) => c.id === profile?.connectionId) }
}
