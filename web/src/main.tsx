import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import { captureRuntime, handleCaptureEvent, refreshCameraCapabilities, refreshCaptures } from './capture/capture'
import { handleNudgeEvent, nudgeRuntime, refreshNudgeMount, refreshNudges } from './capture/nudge'
import { connectionState, handleConnectionEvent, loadConnections, persistConnections, refreshServers } from './connection/connection'
import { controlRuntime, handleControlEvent, refreshStates } from './equipment-control/control'
import { deviceState, handleDeviceEvent, refreshDevices } from './equipment/equipment'
import { onOpen, subscribe } from './events'
import { handleOperationEvent, operationsState, refreshOperations } from './operations'
import { loadProfiles, persistProfiles, profileState } from './profile/profile'
import { routeState, watchHistory } from './shell/route'
import { handleMountEvent, mountRuntime, refreshMount } from './sky/mount'
import { handleSensorEvent, refreshSensors, sensorRuntime } from './sky/sensors'
import { browserStores } from './storage'

// Entry point of the browser bundle: restores the persisted stores and the URL route before the first
// render, starts persisting them, and keeps the server state current through the event socket. Under HMR the module
// re-runs on every update: the React root is reused and the previous run's subscriptions are released.

const stores = browserStores()

loadConnections(connectionState, stores.local)
loadProfiles(profileState, stores)
// Functions that stop this run's persistence and event subscriptions.
const stops = [
	persistConnections(connectionState, stores.local),
	persistProfiles(profileState, stores),
	watchHistory(routeState),
	subscribe((event) => {
		handleConnectionEvent(connectionState, event)
		handleDeviceEvent(deviceState, event)
		handleControlEvent(controlRuntime, event)
		handleMountEvent(mountRuntime, event)
		handleOperationEvent(operationsState, event)
		handleSensorEvent(sensorRuntime, event)
		handleCaptureEvent(captureRuntime, event)
		handleNudgeEvent(nudgeRuntime, event)
	}),
	// Every (re)open resynchronizes the open connections, the watched devices and their control states, the followed mount, the
	// running operations, the camera sensors, the captures and camera capabilities, and the nudged mount
	// and its nudge sessions, which may have changed while the socket was closed.
	onOpen(() => {
		void refreshServers(connectionState)
		void refreshDevices(deviceState)
		void refreshStates(controlRuntime)
		void refreshMount(mountRuntime)
		void refreshOperations(operationsState)
		refreshSensors(sensorRuntime)
		void refreshCaptures(captureRuntime)
		refreshCameraCapabilities(captureRuntime)
		void refreshNudgeMount(nudgeRuntime)
		void refreshNudges(nudgeRuntime)
	}),
]

import.meta.hot.accept()
import.meta.hot.dispose(() => {
	for (const stop of stops) stop()
})

// Renders the app into the page's root element, reusing the root created by a previous HMR run.
function start() {
	const root: Root = (import.meta.hot.data.root ??= createRoot(document.getElementById('root')!))

	root.render(
		<StrictMode>
			<App />
		</StrictMode>,
	)
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', start)
} else {
	start()
}
