import { useWatchControl } from './equipment-control/useControl'
import { useWatchActiveServer } from './equipment/useEquipment'
import { ApplicationShell } from './shell/ApplicationShell'
import { useWatchCameraSensors, useWatchMount } from './sky/useSkyDevices'

// Root component. Keeps the device and control runtimes watching the active profile's connection, and the
// mount and camera sensor runtimes following its devices, for every workspace, and renders the shell.
export function App() {
	useWatchActiveServer()
	useWatchControl()
	useWatchMount()
	useWatchCameraSensors()

	return <ApplicationShell />
}
