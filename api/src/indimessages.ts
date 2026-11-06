import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import type { Client } from 'nebulosa/src/devices/indi/device'
import { type IndiPropertyListener, makeHardwareId } from 'nebulosa/src/devices/indi/properties'
import type { Message } from 'nebulosa/src/devices/indi/types'
import type { ClientResolver } from './commands'
import type { ConnectionRegistryEvent } from './connection'
import type { DeviceRegistry } from './devices'
import { MAX_BUFFERED_AMOUNT } from './indi'
import type { ClientMessage, EventSocket, ServerEvent, SocketListener } from './websocket'

// The INDI protocol <message> elements of every open INDI connection: the one place they are collected, apart
// from the message attribute of the vectors, which stays with the vector in the INDI Properties view. Only the
// device attribute routes a message, never its text:
// - a message without a device, or with an empty one, is a message of the INDI server itself: published through
//   the server events as indi:globalMessage, which the notification classifier turns into an info notification.
//   At most GLOBAL_MESSAGE_LIMIT of them per connection pass in each window of GLOBAL_MESSAGE_WINDOW, a fixed
//   window starting with the first message it admits; the first one over the limit publishes a single
//   indi:globalMessagesSuppressed instead, and the others of the window are dropped, so a noisy server never
//   crowds the shared notification history.
// - a message for a device is kept in the history of that physical device, by the hardware id the property
//   registry gives it (computed from the exact driver-reported name, so a device not defined yet is kept under
//   the id it gets once defined): the latest MAX_DEVICE_MESSAGES, for at most MAX_MESSAGE_DEVICES devices per
//   connection (the least recently active one is dropped first). They are collected whether or not a tab looks.
// Every history belongs to the open client of its connection: it starts empty with a new epoch and is dropped
// when the connection closes, so a reconnection never mixes with what the previous client said. Nothing is
// stored on disk and nothing holds a device.
//
// Text is driver input: control characters (but tabs and line breaks) and bidirectional overrides are removed,
// line breaks normalized, and the text trimmed; a message left blank is ignored. A device message keeps at most
// MAX_MESSAGE_TEXT characters, marked truncated when cut; a global message is published on one line, and the
// notification service cuts it further. The driver timestamp is kept as sent, never parsed; receivedAt is the
// instant of receipt.
//
// The history of one physical device reaches only the sockets that sent indi:messagesSubscribe for it, never a
// broadcast: an indi:messagesSnapshot first, on the same socket and in the same tick, then one
// indi:messageReceived per new message. Every stream event carries the epoch of the connection's client and a
// revision increasing across the service. A socket whose queue grows beyond MAX_BUFFERED_AMOUNT, or that queued
// or dropped a send, skips the new messages and gets a fresh snapshot once it drains. The subscription ends
// with indi:messagesUnsubscribe, the close of the socket, the removal of the device, or the close of the
// connection.

// Messages kept for each physical device of a connection, oldest dropped first.
export const MAX_DEVICE_MESSAGES = 100

// Physical devices of a connection with a kept history; the least recently active one is dropped first.
export const MAX_MESSAGE_DEVICES = 128

// Longest text kept for a device message, in characters (UTF-16 code units).
export const MAX_MESSAGE_TEXT = 2048

// Global messages of a connection published in each window.
export const GLOBAL_MESSAGE_LIMIT = 8

// Length of the fixed window of the global messages, in milliseconds.
export const GLOBAL_MESSAGE_WINDOW = 60_000

// A message the driver sent for a device.
export interface IndiDeviceMessage {
	// Id of this occurrence; two messages with the same text have different ids.
	readonly id: string
	// Order of the message in the history of its device, from 1; a first kept message above 1 means older ones
	// were dropped.
	readonly sequence: number
	// Instant the message was received, Unix milliseconds (UTC).
	readonly receivedAt: number
	// Timestamp the driver attached, as sent; it may be in any format, or none.
	readonly timestamp?: string
	// Text of the message, cleaned of control characters, at most MAX_MESSAGE_TEXT characters.
	readonly text: string
	// Whether the text was cut to MAX_MESSAGE_TEXT characters.
	readonly truncated?: boolean
}

// Identity and order of an event of the message stream of one device.
export interface IndiMessagesHeader {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
	// Id of the client of the connection; a reconnection gets a new one, so events of another epoch never apply to
	// a snapshot.
	readonly epoch: string
	// Order of the event among every stream event of the service: later events have greater revisions.
	readonly revision: number
}

// The kept messages of one device, the first event of a subscription and of every resynchronization.
export interface IndiMessagesSnapshotEvent extends IndiMessagesHeader {
	readonly type: 'indi:messagesSnapshot'
	// The kept messages, oldest first.
	readonly messages: readonly IndiDeviceMessage[]
}

// The driver sent a message for the device.
export interface IndiMessageReceivedEvent extends IndiMessagesHeader {
	readonly type: 'indi:messageReceived'
	// The message.
	readonly message: IndiDeviceMessage
}

// Stable code of a refused subscription: notFound, the connection is not open or has no such device;
// unsupported, the connection is not an INDI server.
export type IndiMessagesSubscriptionErrorCode = 'notFound' | 'unsupported'

// A subscription was refused; sent only to the socket that asked.
export interface IndiMessagesSubscriptionErrorEvent {
	readonly type: 'indi:messagesSubscriptionError'
	// Connection id the subscription named.
	readonly connectionId: string
	// Hardware id the subscription named.
	readonly hardwareId: string
	// Message meant for people.
	readonly error: string
	// Stable code a client branches on.
	readonly code: IndiMessagesSubscriptionErrorCode
}

// The INDI server sent a message addressed to no device, admitted by the window of its connection.
export interface IndiGlobalMessageEvent {
	readonly type: 'indi:globalMessage'
	// Id of the open connection.
	readonly connectionId: string
	// Id of the client of the connection.
	readonly epoch: string
	// Id of this occurrence.
	readonly id: string
	// Instant the message was received, Unix milliseconds (UTC).
	readonly receivedAt: number
	// Text of the message on one line, cleaned of control characters.
	readonly text: string
}

// The INDI server sent more global messages in a window than are published; the rest of the window is dropped.
export interface IndiGlobalMessagesSuppressedEvent {
	readonly type: 'indi:globalMessagesSuppressed'
	// Id of the open connection.
	readonly connectionId: string
	// Id of the client of the connection.
	readonly epoch: string
	// Instant the window started, Unix milliseconds (UTC); names the window.
	readonly windowStart: number
	// Global messages published in a window.
	readonly limit: number
	// Length of the window, in milliseconds.
	readonly window: number
}

// Events of the message stream of one device, sent only to the sockets that subscribed to it.
export type IndiMessagesStreamEvent = IndiMessagesSnapshotEvent | IndiMessageReceivedEvent

// Every event of the service.
export type IndiMessagesServerEvent = IndiMessagesStreamEvent | IndiMessagesSubscriptionErrorEvent | IndiGlobalMessageEvent | IndiGlobalMessagesSuppressedEvent

// Control messages a tab sends over its socket to start or end the message stream of one device. Subscribing
// again resends the snapshot; unsubscribing what is not subscribed does nothing.
export interface IndiMessagesClientMessage {
	readonly type: 'indi:messagesSubscribe' | 'indi:messagesUnsubscribe'
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
}

// Options of the service, for tests.
export interface IndiMessageServiceOptions {
	// Current instant, Unix milliseconds (UTC); Date.now by default.
	readonly now?: () => number
	// Messages kept per device (MAX_DEVICE_MESSAGES by default).
	readonly maxMessages?: number
	// Devices with a history per connection (MAX_MESSAGE_DEVICES by default).
	readonly maxDevices?: number
	// Longest text of a device message, in characters (MAX_MESSAGE_TEXT by default).
	readonly maxTextLength?: number
	// Global messages published per window (GLOBAL_MESSAGE_LIMIT by default).
	readonly globalLimit?: number
	// Length of the window of the global messages, in milliseconds (GLOBAL_MESSAGE_WINDOW by default).
	readonly globalWindow?: number
	// Bytes a socket may have queued before it skips messages (MAX_BUFFERED_AMOUNT by default).
	readonly maxBufferedAmount?: number
}

// History of one physical device.
interface DeviceHistory {
	// Sequence of the latest message.
	sequence: number
	// Kept messages, oldest first.
	readonly messages: IndiDeviceMessage[]
}

// Window of the global messages of a connection.
interface GlobalWindow {
	// Instant the window started, Unix milliseconds (UTC).
	start: number
	// Messages published in the window.
	count: number
	// Whether the window already published its suppression.
	suppressed: boolean
}

// What the service keeps for the open client of a connection.
interface Session {
	// Client the session belongs to.
	readonly client: Client
	// Id of the session, new for every client.
	readonly epoch: string
	// Histories by hardware id, least recently active first.
	readonly histories: Map<string, DeviceHistory>
	// Window of the global messages.
	readonly window: GlobalWindow
}

// Sockets following the history of one physical device.
interface Subscription {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
	// Key of the subscription, connection id and hardware id.
	readonly key: string
	// Sockets subscribed to the device.
	readonly sockets: Set<EventSocket>
}

// Control characters removed from driver text: C0 but tab and line feed, DEL, C1 (the Unicode category Cc), and
// the bidirectional marks, embeddings, overrides, and isolates (Bidi_Control), which could reorder what is shown.
const CONTROL_CHARACTERS = /(?![\t\n])\p{Cc}|\p{Bidi_Control}/gu

// Returns the text of a message cleaned for display: line breaks normalized to \n, control characters removed,
// and the ends trimmed. Empty when nothing visible is left.
export function messageText(text: string) {
	return text.replaceAll(/\r\n?/g, '\n').replaceAll(CONTROL_CHARACTERS, '').trim()
}

// Collects the INDI messages of every open connection and streams the history of a device to the sockets that
// subscribed to it.
export class IndiMessageService implements SocketListener, Disposable {
	// Sessions of the open connections, by connection id.
	readonly #sessions = new Map<string, Session>()
	// Subscriptions with sockets, by key.
	readonly #subscriptions = new Map<string, Subscription>()
	// Subscriptions of each socket.
	readonly #sockets = new Map<EventSocket, Set<Subscription>>()
	// Subscriptions whose messages a socket skips until it drains.
	readonly #stale = new Map<EventSocket, Set<Subscription>>()
	// Current instant, Unix milliseconds (UTC).
	readonly #now: () => number
	// Messages kept per device.
	readonly #maxMessages: number
	// Devices with a history per connection.
	readonly #maxDevices: number
	// Longest text of a device message, in characters.
	readonly #maxTextLength: number
	// Global messages published per window.
	readonly #globalLimit: number
	// Length of the window of the global messages, in milliseconds.
	readonly #globalWindow: number
	// Bytes a socket may have queued before it skips messages.
	readonly #maxBufferedAmount: number
	// Revision of the last stream event.
	#revision = 0
	// Stops listening to the registry.
	readonly #unlisten: VoidFunction
	// Handler of the clients receiving every <message> element; the one collection point of the messages.
	readonly #handler: IndiClientHandler = {
		message: (client, message) => {
			try {
				this.#received(client, message)
			} catch (error) {
				console.warn('indi messages: a message cannot be kept', error)
			}
		},
	}
	// Receives the removal of devices, which ends their subscriptions.
	readonly #listener: IndiPropertyListener = {
		deviceRemoved: (client, device) => {
			const connectionId = this.devices.connection(client)
			const subscription = connectionId && this.#subscriptions.get(`${connectionId}:${device.hardwareId}`)
			if (subscription) this.#close(subscription)
		},
	}

	// Creates the service over the devices of every connection; client resolves an open connection id to its
	// client, and publish hands the global message events to the server events.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly publish: (event: ServerEvent) => void,
		options?: IndiMessageServiceOptions,
	) {
		this.#now = options?.now ?? Date.now
		this.#maxMessages = options?.maxMessages ?? MAX_DEVICE_MESSAGES
		this.#maxDevices = options?.maxDevices ?? MAX_MESSAGE_DEVICES
		this.#maxTextLength = options?.maxTextLength ?? MAX_MESSAGE_TEXT
		this.#globalLimit = options?.globalLimit ?? GLOBAL_MESSAGE_LIMIT
		this.#globalWindow = options?.globalWindow ?? GLOBAL_MESSAGE_WINDOW
		this.#maxBufferedAmount = options?.maxBufferedAmount ?? MAX_BUFFERED_AMOUNT
		this.#unlisten = devices.properties.addListener(this.#listener)
		devices.handler.add(this.#handler)
	}

	// Drops the session of a connection that closed, with its histories, and ends its subscriptions.
	connectionChanged(event: ConnectionRegistryEvent) {
		if (event.type !== 'connection:close') return
		this.#sessions.delete(event.id)
		for (const subscription of Array.from(this.#subscriptions.values())) if (subscription.connectionId === event.id) this.#close(subscription)
	}

	// Handles the message stream control messages of a socket; every other control message is ignored.
	message(socket: EventSocket, message: ClientMessage) {
		switch (message.type) {
			case 'indi:messagesSubscribe':
				this.subscribe(socket, message)
				return
			case 'indi:messagesUnsubscribe':
				this.unsubscribe(socket, message)
		}
	}

	// Subscribes a socket to the history of a device of an INDI connection and sends it a snapshot, or the error
	// refusing it.
	subscribe(socket: EventSocket, { connectionId, hardwareId }: IndiMessagesClientMessage) {
		const client = this.client(connectionId)

		if (!client) {
			this.#refuse(socket, connectionId, hardwareId, 'Connection not found', 'notFound')
			return
		}

		if (client.type !== 'INDI') {
			this.#refuse(socket, connectionId, hardwareId, 'The connection is not an INDI server', 'unsupported')
			return
		}

		const device = this.devices.properties.device(client, hardwareId)

		if (!device || device.hardwareId !== hardwareId) {
			this.#refuse(socket, connectionId, hardwareId, 'The connection has no such device', 'notFound')
			return
		}

		const key = `${connectionId}:${hardwareId}`
		let subscription = this.#subscriptions.get(key)

		if (subscription === undefined) {
			subscription = { connectionId, hardwareId, key, sockets: new Set() }
			this.#subscriptions.set(key, subscription)
		}

		subscription.sockets.add(socket)

		let subscriptions = this.#sockets.get(socket)

		if (subscriptions === undefined) {
			subscriptions = new Set()
			this.#sockets.set(socket, subscriptions)
		}

		subscriptions.add(subscription)
		this.#sendSnapshot(socket, subscription, this.#session(connectionId, client))
	}

	// Ends the subscription of a socket to the history of a device.
	unsubscribe(socket: EventSocket, { connectionId, hardwareId }: IndiMessagesClientMessage) {
		const subscription = this.#subscriptions.get(`${connectionId}:${hardwareId}`)
		if (subscription !== undefined) this.#leave(socket, subscription)
	}

	// Sends a fresh snapshot of each history a socket skipped while it was congested.
	drained(socket: EventSocket) {
		const stale = this.#stale.get(socket)
		if (stale === undefined) return
		this.#stale.delete(socket)

		for (const subscription of stale) {
			const session = this.#sessions.get(subscription.connectionId)
			if (session !== undefined && subscription.sockets.has(socket)) this.#sendSnapshot(socket, subscription, session)
		}
	}

	// Ends every subscription of a closed socket.
	closed(socket: EventSocket) {
		const subscriptions = this.#sockets.get(socket)
		if (subscriptions !== undefined) for (const subscription of Array.from(subscriptions)) this.#leave(socket, subscription)
		this.#stale.delete(socket)
	}

	// Number of sockets subscribed to a device, for tests and diagnostics.
	subscribers(connectionId: string, hardwareId: string) {
		return this.#subscriptions.get(`${connectionId}:${hardwareId}`)?.sockets.size ?? 0
	}

	// Kept messages of a device of a connection, oldest first, for tests and diagnostics.
	history(connectionId: string, hardwareId: string): readonly IndiDeviceMessage[] {
		return this.#sessions.get(connectionId)?.histories.get(hardwareId)?.messages ?? []
	}

	// Routes a <message> of the open client of an INDI connection by its device attribute; a message of any other
	// client, or left blank once cleaned, is ignored.
	#received(client: Client, { id, device, timestamp, message }: Message) {
		if (client.type !== 'INDI') return

		const connectionId = this.devices.connection(client)
		if (!connectionId || this.client(connectionId) !== client) return

		const text = messageText(message)
		if (!text) return

		const session = this.#session(connectionId, client)
		const receivedAt = this.#now()

		if (device) this.#keep(connectionId, session, makeHardwareId(client, device), { id, receivedAt, timestamp, text })
		else this.#global(connectionId, session, id, receivedAt, text)
	}

	// Publishes a global message when the window of its connection admits it, the suppression for the first one
	// over the limit, and nothing for the rest of the window.
	#global(connectionId: string, { epoch, window }: Session, id: string, receivedAt: number, text: string) {
		if (window.count === 0 || receivedAt - window.start >= this.#globalWindow) {
			window.start = receivedAt
			window.count = 0
			window.suppressed = false
		}

		if (window.count < this.#globalLimit) {
			window.count++
			this.publish({ type: 'indi:globalMessage', connectionId, epoch, id, receivedAt, text: text.replaceAll(/\s+/g, ' ') })
		} else if (!window.suppressed) {
			window.suppressed = true
			this.publish({ type: 'indi:globalMessagesSuppressed', connectionId, epoch, windowStart: window.start, limit: this.#globalLimit, window: this.#globalWindow })
		}
	}

	// Appends a message to the history of a device, dropping the oldest message and the least recently active
	// device beyond the limits, and sends it to the sockets subscribed to the device.
	#keep(connectionId: string, session: Session, hardwareId: string, { id, receivedAt, timestamp, text }: Omit<IndiDeviceMessage, 'sequence'>) {
		const { histories } = session
		const history = histories.get(hardwareId) ?? { sequence: 0, messages: [] }

		// Reinserted, so the map stays ordered by the latest activity.
		histories.delete(hardwareId)
		histories.set(hardwareId, history)

		if (histories.size > this.#maxDevices) histories.delete(histories.keys().next().value!)

		const truncated = text.length > this.#maxTextLength
		const kept: IndiDeviceMessage = { id, sequence: ++history.sequence, receivedAt, ...(timestamp !== undefined && { timestamp }), text: truncated ? text.slice(0, this.#maxTextLength) : text, ...(truncated && { truncated }) }

		history.messages.push(kept)
		if (history.messages.length > this.#maxMessages) history.messages.splice(0, history.messages.length - this.#maxMessages)

		const subscription = this.#subscriptions.get(`${connectionId}:${hardwareId}`)
		if (subscription === undefined) return

		const data = JSON.stringify({ ...this.#header(subscription, session), type: 'indi:messageReceived', message: kept } satisfies IndiMessageReceivedEvent)
		for (const socket of subscription.sockets) this.#write(socket, subscription, data)
	}

	// Returns the session of the open client of a connection, starting a new one for a new client.
	#session(connectionId: string, client: Client): Session {
		const session = this.#sessions.get(connectionId)
		if (session?.client === client) return session

		const created: Session = { client, epoch: Bun.randomUUIDv7(), histories: new Map(), window: { start: 0, count: 0, suppressed: false } }
		this.#sessions.set(connectionId, created)
		return created
	}

	// Sends the kept messages of a device to one socket, ending any resynchronization it was waiting for.
	#sendSnapshot(socket: EventSocket, subscription: Subscription, session: Session) {
		this.#stale.get(socket)?.delete(subscription)
		const messages = session.histories.get(subscription.hardwareId)?.messages ?? []
		this.#write(socket, subscription, JSON.stringify({ ...this.#header(subscription, session), type: 'indi:messagesSnapshot', messages } satisfies IndiMessagesSnapshotEvent))
	}

	// Sends the refusal of a subscription to the socket that asked.
	#refuse(socket: EventSocket, connectionId: string, hardwareId: string, error: string, code: IndiMessagesSubscriptionErrorCode) {
		socket.send(JSON.stringify({ type: 'indi:messagesSubscriptionError', connectionId, hardwareId, error, code } satisfies IndiMessagesSubscriptionErrorEvent))
	}

	// Writes to a socket unless it skips the subscription; a congested socket, or one that dropped or queued the
	// data, skips it until it drains and resynchronizes.
	#write(socket: EventSocket, subscription: Subscription, data: string) {
		if (this.#stale.get(socket)?.has(subscription)) return
		if (socket.getBufferedAmount() <= this.#maxBufferedAmount && socket.send(data) > 0) return

		let stale = this.#stale.get(socket)

		if (stale === undefined) {
			stale = new Set()
			this.#stale.set(socket, stale)
		}

		stale.add(subscription)
	}

	// Builds the header of the next event of a subscription.
	#header({ connectionId, hardwareId }: Subscription, { epoch }: Session): IndiMessagesHeader {
		return { connectionId, hardwareId, epoch, revision: ++this.#revision }
	}

	// Removes a socket from a subscription, dropping the subscription with its last socket.
	#leave(socket: EventSocket, subscription: Subscription) {
		subscription.sockets.delete(socket)
		this.#stale.get(socket)?.delete(subscription)

		const subscriptions = this.#sockets.get(socket)
		subscriptions?.delete(subscription)
		if (subscriptions?.size === 0) this.#sockets.delete(socket)

		if (subscription.sockets.size === 0) this.#subscriptions.delete(subscription.key)
	}

	// Drops a subscription, ending it for every socket.
	#close(subscription: Subscription) {
		for (const socket of Array.from(subscription.sockets)) this.#leave(socket, subscription)
		this.#subscriptions.delete(subscription.key)
	}

	// Stops listening to the registry and the clients, dropping every session and subscription.
	[Symbol.dispose]() {
		this.#unlisten()
		this.devices.handler.delete(this.#handler)
		for (const subscription of Array.from(this.#subscriptions.values())) this.#close(subscription)
		this.#sessions.clear()
		this.#stale.clear()
	}
}
