import { StrictMode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'
import { connectionState, handleConnectionEvent, loadConnections, persistConnections, refreshServers } from './connection/connection'
import { deviceState, handleDeviceEvent, refreshDevices } from './equipment/equipment'
import { onOpen, subscribe } from './events'
import { loadProfiles, persistProfiles, profileState } from './profile/profile'
import { routeState, watchHistory } from './shell/route'
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
	}),
	// Every (re)open resynchronizes the open connections and the watched devices, which may have changed
	// while the socket was closed.
	onOpen(() => {
		void refreshServers(connectionState)
		void refreshDevices(deviceState)
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
