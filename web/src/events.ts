import type { ConnectionEvent } from 'api'

// Client side of the server event WebSocket: keeps one socket open for the tab and fans parsed events
// out to listeners, reconnecting when the server goes away (e.g. on a dev server restart).

// Receiver of server events.
export type ServerEventListener = (event: ConnectionEvent) => void

// Delay before reopening a dropped socket, in milliseconds.
const RECONNECT_DELAY = 2000

// Listeners registered by this tab.
const listeners = new Set<ServerEventListener>()
// Whether the socket was opened once; afterwards it reopens itself.
let started = false

// Opens the socket and schedules a reopen when it closes.
function open() {
	const url = new URL('/api/ws', location.href)
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

	const socket = new WebSocket(url)

	socket.addEventListener('message', (message: MessageEvent<string>) => {
		const event = JSON.parse(message.data) as ConnectionEvent
		for (const listener of listeners) listener(event)
	})

	socket.addEventListener('close', () => {
		setTimeout(open, RECONNECT_DELAY)
	})
}

// Registers a listener for server events, opening the socket on first use. Returns a function that
// removes the listener.
export function subscribe(listener: ServerEventListener): () => void {
	listeners.add(listener)

	if (!started) {
		started = true
		open()
	}

	return () => listeners.delete(listener)
}
