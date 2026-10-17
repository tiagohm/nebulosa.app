import { useWatchActiveServer } from './equipment/useEquipment'
import { ApplicationShell } from './shell/ApplicationShell'

// Root component. Keeps the device runtime watching the active profile's connection for every workspace
// and renders the application shell.
export function App() {
	useWatchActiveServer()

	return <ApplicationShell />
}
