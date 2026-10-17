import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectionState, handleConnectionEvent, loadConnections, persistConnections, refreshServers } from './connection/connection'
import { onOpen, subscribe } from './events'
import { loadProfiles, persistProfiles, profileState } from './profile/profile'
import { browserStores } from './storage'

// Entry point of the browser bundle: restores the persisted stores before the first render, starts
// persisting them, and keeps the server state current through the event socket.

const stores = browserStores()

loadConnections(connectionState, stores.local)
loadProfiles(profileState, stores)
persistConnections(connectionState, stores.local)
persistProfiles(profileState, stores)

subscribe((event) => handleConnectionEvent(connectionState, event))
// Every (re)open resynchronizes the open connections, which may have changed while the socket was closed.
onOpen(() => void refreshServers(connectionState))

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
