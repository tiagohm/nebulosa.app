import { useEffect } from 'react'
import { useActiveServerId } from '../equipment/useEquipment'
import { controlRuntime, watchControl } from './control'

// React binding of the control runtime: keeps it mirroring the active profile's server connection, for the
// Equipment Control page and the status bar alike.

// Watches the active profile's server connection while mounted, switching whenever the profile, its
// selected connection, or the server state changes. Leaving a connection sends nothing to its devices.
export function useWatchControl() {
	const serverId = useActiveServerId()

	useEffect(() => {
		watchControl(controlRuntime, serverId)
	}, [serverId])
}
