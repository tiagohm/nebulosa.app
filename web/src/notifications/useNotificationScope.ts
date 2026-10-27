import { useSnapshot } from 'valtio'
import { type Connection, connectionState } from '../connection/connection'
import { activeProfile, profileState } from '../profile/profile'
import type { NotificationPreferences } from '../profile/schema'

// React binding of what decides which notifications the tab lists and counts: the saved connection of the active
// profile and the notifications that profile read or dismissed.

// Scope of the notification lists of the tab.
export interface NotificationScope {
	// Saved connection the active profile selected; absent when none is selected or it was removed.
	readonly connection?: Connection
	// Notifications the active profile read or dismissed; absent before it read any.
	readonly preferences?: Readonly<NotificationPreferences>
}

// Returns the scope of the notification lists of the tab.
export function useNotificationScope(): NotificationScope {
	const profiles = useSnapshot(profileState)
	const { connections } = useSnapshot(connectionState)
	const profile = profiles.profiles.length > 0 ? activeProfile(profiles) : undefined
	return { connection: connections.find((c) => c.id === profile?.connectionId), preferences: profile?.settings.notifications }
}
