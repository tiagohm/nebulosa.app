import type { ClientMessage, ServerEvent } from 'api'
import { nanoid } from 'nanoid'

// Client side of the server event WebSocket: keeps one socket open for the tab and fans parsed events
// out to listeners, reconnecting when the server goes away (e.g. on a dev server restart). Open listeners
// run every time the socket opens, so state missed while it was closed can be fetched again, and close listeners every
// time an open socket closes, so the tab can tell it lost the server. The socket names the
// page with a client id, the same for every reopen while the page lives, so the server keeps what the page holds
// (such as the captured frames its Images tabs show) while its socket is closed, such as when a phone locks. A
// few views also send control messages over the socket, such as the subscription to the INDI properties of a
// device, which the server ties to the socket itself, so they send them again on every open.

// Id of this page for the server, generated on load: the documents of the page do not survive a reload, so
// neither does the id.
export const clientId = nanoid()

// Receiver of server events.
export type ServerEventListener = (event: ServerEvent) => void

// Delay before reopening a dropped socket, in milliseconds.
const RECONNECT_DELAY = 2000

// Receiver of socket opens.
export type OpenListener = () => void

// Receiver of the closes of an open socket.
export type CloseListener = () => void

// Listeners registered by this tab.
const listeners = new Set<ServerEventListener>()
// Listeners called on every socket open.
const openListeners = new Set<OpenListener>()
// Listeners called when an open socket closes; a socket that never opened closes silently.
const closeListeners = new Set<CloseListener>()
// Whether the socket was opened once; afterwards it reopens itself.
let started = false
// Socket of the tab while it is open.
let current: WebSocket | undefined

// Opens the socket and schedules a reopen when it closes.
function open() {
	const url = new URL('/api/ws', location.href)
	url.searchParams.set('client', clientId)
	url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'

	const socket = new WebSocket(url)

	socket.addEventListener('open', () => {
		current = socket
		for (const listener of openListeners) listener()
	})

	socket.addEventListener('message', (message: MessageEvent<string>) => {
		const event = JSON.parse(message.data) as ServerEvent
		for (const listener of listeners) listener(event)
	})

	socket.addEventListener('close', () => {
		if (current === socket) {
			current = undefined
			for (const listener of closeListeners) listener()
		}

		setTimeout(open, RECONNECT_DELAY)
	})
}

// Opens the socket once.
function start() {
	if (started) return
	started = true
	open()
}

// Registers a listener for server events, opening the socket on first use. Returns a function that
// removes the listener.
export function subscribe(listener: ServerEventListener): () => void {
	listeners.add(listener)
	start()
	return () => listeners.delete(listener)
}

// Registers a listener called whenever the socket opens or reopens, opening it on first use. Returns a
// function that removes the listener.
export function onOpen(listener: OpenListener): () => void {
	openListeners.add(listener)
	start()
	return () => openListeners.delete(listener)
}

// Sends a control message over the socket. Returns false when the socket is not open, so the message was not
// sent; its sender sends it again from an open listener.
export function send(message: ClientMessage): boolean {
	if (current?.readyState !== WebSocket.OPEN) return false
	current.send(JSON.stringify(message))
	return true
}

// Registers a listener called whenever an open socket closes, opening the socket on first use. A failed attempt to
// reopen it is not reported again. Returns a function that removes the listener.
export function onClose(listener: CloseListener): () => void {
	closeListeners.add(listener)
	start()
	return () => closeListeners.delete(listener)
}
