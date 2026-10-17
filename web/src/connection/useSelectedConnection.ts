import { useSnapshot } from 'valtio'
import { activeProfile, profileState } from '../profile/profile'
import { type Connection, connectionState, serverOf } from './connection'

// React binding of the connection selected by the tab's active profile and the real state of its server,
// shared by the top bar indicator and the status bar.

// State of the selected connection's server: held open, being opened by this tab, or closed (also when
// no connection is selected).
export type SelectedConnectionStatus = 'connected' | 'connecting' | 'disconnected'

// Connection selected by the active profile and the state of its server.
export interface SelectedConnection {
	// Saved connection the profile selected; absent when none is selected or it was removed.
	readonly connection?: Connection
	// State of its server.
	readonly status: SelectedConnectionStatus
}

// Returns the active profile's selected connection and the state of its server.
export function useSelectedConnection(): SelectedConnection {
	const { connections, servers, loading } = useSnapshot(connectionState)
	const profiles = useSnapshot(profileState)
	const connectionId = profiles.profiles.length > 0 ? activeProfile(profiles).connectionId : undefined
	const connection = connections.find((c) => c.id === connectionId)
	const status: SelectedConnectionStatus = serverOf(servers, connection) ? 'connected' : connection && loading?.kind === 'connect' && loading.connectionId === connection.id ? 'connecting' : 'disconnected'
	return { connection, status }
}
