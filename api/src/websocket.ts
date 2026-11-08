import type { ServerWebSocket, WebSocketHandler } from 'bun'
import type { AnnotationEvent } from './annotations'
import type { AutoFocusEvent } from './autofocus'
import type { CalibrationLibraryEvent } from './calibrationlibrary'
import type { CaptureFrameEvent } from './captureframes'
import type { CaptureEvent } from './captures'
import type { ConnectionRegistryEvent } from './connection'
import type { DarkLibraryWizardEvent } from './darklibrarywizard'
import type { DarvEvent } from './darv'
import type { DomeMotionEvent } from './domes'
import type { ExternalToolEvent } from './externaltools'
import type { FlatWizardEvent } from './flatwizard'
import type { FocuserBacklashEvent } from './focusers'
import type { GuidingServerEvent } from './guiding'
import type { ImageProcessingEvent } from './imageprocessing'
import type { ImageStackingEvent } from './imagestacking'
import type { IndiClientMessage, IndiServerEvent } from './indi'
import type { IndiMessagesClientMessage, IndiMessagesServerEvent } from './indimessages'
import type { IPolarEvent } from './ipolar'
import type { JupiterGrsEvent } from './jupiter.store'
import type { LiveStackingEvent } from './livestacking'
import type { MeridianFlipEvent } from './meridianflip'
import type { MeridianFlipExecutorEvent } from './meridianflipexecutor'
import type { PointingModelEvent } from './mountpointing'
import type { PointingActivationEvent } from './mountpointing.corrections'
import type { MountPointingEvent } from './mountpointing.sessions'
import type { MountRemoteControlEvent } from './mountremotecontrol'
import type { MountNudgeEvent } from './mounts'
import type { NotificationCreatedEvent } from './notifications'
import type { ObservatoryCameraEvent } from './observatorycameras'
import type { ObservingPlanEvent } from './observingplanner'
import type { OperationEvent } from './operations'
import type { PlateSolvingEvent } from './platesolving'
import type { SatellitesChangedEvent } from './satellites'
import type { SpiceKernelEvent } from './spicekernels'
import type { StarDetectionEvent } from './stars'
import type { StreakDetectionEvent } from './streaks'
import type { TargetCenteringEvent } from './targetcentering'
import type { TppaEvent } from './tppa'
import type { WorkspaceEvent } from './workspace'

// WebSocket endpoint that pushes server events to every open browser tab. A tab names itself with the client id
// it opens the socket with (/api/ws?client=<id>), the same for every socket it reopens, so services can keep
// what the tab holds across reconnects. Events are broadcast to every socket, except the ones a service sends
// to the one socket that asked for them, such as the INDI property and message streams of a device. A tab sends a
// few control messages over the same socket (ClientMessage); every socket listener receives each of them and
// handles only the types it owns. The services that handle them identify the asker by the socket itself, never by
// its client id, so what a socket asked for ends with it.

// Any event pushed to the browser tabs: connection and device events of the connection registry, the operation events
// of the operation registry, the events of the capture, Auto Focus, TPPA, iPolar, mount pointing, mount nudge, mount remote control, meridian flip monitor, and dome manual rotation services,
// the captured frames of the frame registry, the guiding sessions, the changes of the external program settings, of the observatory cameras, and of the focuser backlash
// compensations, the star detection, streak detection, plate solving, annotation, and image processing jobs, the created notifications, the changes and acquisition jobs of the SPICE Kernel Library, the saves of the Jupiter Great Red Spot model, the INDI device directory
// and property streams, and the INDI message streams and global messages.
export type ServerEvent =
	| ConnectionRegistryEvent
	| OperationEvent
	| CaptureEvent
	| CaptureFrameEvent
	| AutoFocusEvent
	| TppaEvent
	| IPolarEvent
	| PointingModelEvent
	| MountPointingEvent
	| PointingActivationEvent
	| TargetCenteringEvent
	| DarvEvent
	| FlatWizardEvent
	| DarkLibraryWizardEvent
	| CalibrationLibraryEvent
	| ImageStackingEvent
	| LiveStackingEvent
	| MountNudgeEvent
	| MountRemoteControlEvent
	| MeridianFlipEvent
	| MeridianFlipExecutorEvent
	| DomeMotionEvent
	| ExternalToolEvent
	| ObservatoryCameraEvent
	| WorkspaceEvent
	| StarDetectionEvent
	| StreakDetectionEvent
	| PlateSolvingEvent
	| AnnotationEvent
	| ImageProcessingEvent
	| FocuserBacklashEvent
	| GuidingServerEvent
	| NotificationCreatedEvent
	| SatellitesChangedEvent
	| SpiceKernelEvent
	| ObservingPlanEvent
	| JupiterGrsEvent
	| IndiServerEvent
	| IndiMessagesServerEvent

// Any control message a tab sends over its socket.
export type ClientMessage = IndiClientMessage | IndiMessagesClientMessage

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

// Presence of the named clients: counts the open sockets of each one and, once the last one closed, calls expired with the
// client after grace milliseconds, unless a socket of the client opened again meanwhile. What a client holds on the server
// (capture frame leases, image documents) survives a short absence, such as a phone whose screen locked, and is released
// once its page is gone for good. A ClientListener, registered with listenClients.
export class ClientPresence implements ClientListener, Disposable {
	// Open sockets of each client.
	readonly #sockets = new Map<string, number>()
	// Pending expiry of each client whose sockets all closed.
	readonly #graces = new Map<string, Timer>()

	// grace is how long a client survives its last socket, in milliseconds; expired receives the client then.
	constructor(
		readonly grace: number,
		private readonly expired: (client: string) => void,
	) {}

	// Counts a socket of a client that opened, cancelling its pending expiry.
	readonly connected = (client: string) => {
		this.#sockets.set(client, (this.#sockets.get(client) ?? 0) + 1)
		clearTimeout(this.#graces.get(client))
		this.#graces.delete(client)
	}

	// Counts a socket of a client that closed; once its last one closed, the client expires after the grace.
	readonly disconnected = (client: string) => {
		const sockets = (this.#sockets.get(client) ?? 1) - 1

		if (sockets > 0) {
			this.#sockets.set(client, sockets)
			return
		}

		this.#sockets.delete(client)
		const timer = setTimeout(() => {
			this.#graces.delete(client)
			this.expired(client)
		}, this.grace)
		timer.unref()
		this.#graces.set(client, timer)
	};

	// Cancels every pending expiry.
	[Symbol.dispose]() {
		for (const timer of this.#graces.values()) clearTimeout(timer)
		this.#graces.clear()
	}
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

// Code of the close of a socket that lost an event: 1013, Try Again Later.
const EVENT_DROPPED_CLOSE_CODE = 1013

// Sends an event as JSON to every open socket. A socket whose backlog went past the backpressure limit drops the event;
// it is closed then, so its tab reconnects and refreshes its snapshots instead of mirroring a state that lost an event.
export function broadcast(event: ServerEvent) {
	const data = JSON.stringify(event)

	for (const ws of sockets) {
		if (ws.send(data) === 0) ws.close(EVENT_DROPPED_CLOSE_CODE, 'An event was dropped under backpressure')
	}
}
