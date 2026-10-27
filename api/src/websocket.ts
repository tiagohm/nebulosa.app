import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { AutoFocusEvent } from './autofocus'
import type { CaptureFrameEvent } from './captureframes'
import type { CaptureEvent } from './captures'
import type { ConnectionRegistryEvent } from './connection'
import type { DarvEvent } from './darv'
import type { DomeMotionEvent } from './domes'
import type { ExternalToolEvent } from './externaltools'
import type { FlatWizardEvent } from './flatwizard'
import type { FocuserBacklashEvent } from './focusers'
import type { GuidingServerEvent } from './guiding'
import type { IndiClientMessage, IndiServerEvent } from './indi'
import type { MountRemoteControlEvent } from './mountremotecontrol'
import type { MountNudgeEvent } from './mounts'
import type { OperationEvent } from './operations'
import type { PlateSolvingEvent } from './platesolving'
import type { StarDetectionEvent } from './stars'
import type { TppaEvent } from './tppa'

// WebSocket endpoint that pushes server events to every open browser tab. A tab names itself with the client id
// it opens the socket with (/api/ws?client=<id>), the same for every socket it reopens, so services can keep
// what the tab holds across reconnects. Events are broadcast to every socket, except the ones a service sends
// to the one socket that asked for them, such as the INDI property stream of a device. A tab sends a few
// control messages over the same socket (ClientMessage); the services that handle them identify the asker by
// the socket itself, never by its client id, so what a socket asked for ends with it.

// Any event pushed to the browser tabs: connection and device events of the connection registry, the operation events
// of the operation registry, the events of the capture, Auto Focus, TPPA, mount nudge, mount remote control, and dome manual rotation services,
// the captured frames of the frame registry, the guiding sessions, the changes of the external program settings and of the focuser backlash
// compensations, the star detection and plate solving jobs, and the INDI device directory and property streams.
export type ServerEvent =
	| ConnectionRegistryEvent
	| OperationEvent
	| CaptureEvent
	| CaptureFrameEvent
	| AutoFocusEvent
	| TppaEvent
	| DarvEvent
	| FlatWizardEvent
	| MountNudgeEvent
	| MountRemoteControlEvent
	| DomeMotionEvent
	| ExternalToolEvent
	| StarDetectionEvent
	| PlateSolvingEvent
	| FocuserBacklashEvent
	| GuidingServerEvent
	| IndiServerEvent

// Any control message a tab sends over its socket.
export type ClientMessage = IndiClientMessage

// What the upgrade attaches to a socket.
export interface WebSocketData {
	// Client id of the tab; absent when it gave none.
	readonly client?: string
}

// One open socket, as a service answering it sees it.
export interface EventSocket {
	// Sends text; returns the bytes sent, -1 when it was queued under backpressure, or 0 when it was dropped.
	readonly send: (data: string) => number
	// Bytes queued and not sent yet.
	readonly getBufferedAmount: () => number
}

// Receiver of the sockets of a client that open and close.
export interface ClientListener {
	// A socket of the client opened.
	readonly connected: (client: string) => void
	// A socket of the client closed.
	readonly disconnected: (client: string) => void
}

// Receiver of the control messages of every socket and of the end of its backpressure and of its life.
export interface SocketListener {
	// The socket sent a control message.
	readonly message?: (socket: EventSocket, message: ClientMessage) => void
	// The queue of the socket emptied after backpressure.
	readonly drained?: (socket: EventSocket) => void
	// The socket closed.
	readonly closed?: (socket: EventSocket) => void
}

// Sockets of the currently open tabs.
const sockets = new Set<ServerWebSocket<WebSocketData>>()

// Receivers of the sockets of named clients.
const clientListeners = new Set<ClientListener>()

// Receivers of the control messages and the lifetime of every socket.
const socketListeners = new Set<SocketListener>()

// Bun WebSocket handler tracking open sockets and dispatching the control messages of the tabs as JSON text.
export const websocket: WebSocketHandler<WebSocketData> = {
	open(ws) {
		sockets.add(ws)
		const { client } = ws.data
		if (client) for (const listener of clientListeners) listener.connected(client)
	},
	message(ws, data) {
		const message = JSON.parse(typeof data === 'string' ? data : data.toString()) as ClientMessage
		for (const listener of socketListeners) listener.message?.(ws, message)
	},
	drain(ws) {
		for (const listener of socketListeners) listener.drained?.(ws)
	},
	close(ws) {
		sockets.delete(ws)
		for (const listener of socketListeners) listener.closed?.(ws)
		const { client } = ws.data
		if (client) for (const listener of clientListeners) listener.disconnected(client)
	},
}

// Registers a receiver of the sockets of named clients. Returns a function that removes it.
export function listenClients(listener: ClientListener): () => void {
	clientListeners.add(listener)
	return () => clientListeners.delete(listener)
}

// Registers a receiver of the control messages and the lifetime of every socket. Returns a function that
// removes it.
export function listenSockets(listener: SocketListener): () => void {
	socketListeners.add(listener)
	return () => socketListeners.delete(listener)
}

// Sends an event as JSON to every open socket.
export function broadcast(event: ServerEvent) {
	const data = JSON.stringify(event)
	for (const ws of sockets) ws.send(data)
}
