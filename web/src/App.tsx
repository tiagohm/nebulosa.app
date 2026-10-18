import { useWatchActiveServer } from './equipment/useEquipment'
import { ApplicationShell } from './shell/ApplicationShell'
import { useWatchCameraSensors, useWatchMount } from './sky/useSkyDevices'

// Root component. Keeps the device runtime watching the active profile's connection, and the mount and
// camera sensor runtimes following its devices, for every workspace, and renders the application shell.
export function App() {
	useWatchActiveServer()
	useWatchMount()
	useWatchCameraSensors()

	return <ApplicationShell />
}
