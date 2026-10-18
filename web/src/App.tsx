import { useWatchActiveServer } from './equipment/useEquipment'
import { ApplicationShell } from './shell/ApplicationShell'
import { useWatchMount } from './sky/useMount'

// Root component. Keeps the device runtime watching the active profile's connection, and the mount
// runtime following its mount, for every workspace, and renders the application shell.
export function App() {
	useWatchActiveServer()
	useWatchMount()

	return <ApplicationShell />
}
