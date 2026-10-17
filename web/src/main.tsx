import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { connectionState, handleConnectionEvent } from './connection/connection'
import { subscribe } from './events'

subscribe((event) => handleConnectionEvent(connectionState, event))

createRoot(document.getElementById('root')!).render(
	<StrictMode>
		<App />
	</StrictMode>,
)
