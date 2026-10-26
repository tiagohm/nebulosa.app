import type { Client } from 'nebulosa/src/devices/indi/device'
import type { IndiDevice, IndiDriver, IndiProperty, IndiPropertyChange, IndiPropertyChangeKind, IndiPropertyListener } from 'nebulosa/src/devices/indi/properties'
import type { Message } from 'nebulosa/src/devices/indi/types'
import { type ClientResolver, notFound, unsupported } from './commands'
import type { DeviceRegistry } from './devices'
import type { EventSocket, ServerEvent, SocketListener } from './websocket'

// The raw INDI property vectors of the devices of the open INDI connections, for the INDI Properties view of
// Equipment Control. The vectors themselves are kept by the property registry of the devices, which the
// device managers share; this service only publishes them:
// - a directory of the physical devices of each INDI connection (GET /api/connections/:id/indi/devices and
//   the indi:device* events, broadcast to every tab), without any property value;
// - the property stream of one physical device, sent only to the sockets that subscribed to it over /api/ws
//   (indi:subscribe), never broadcast. A subscription first receives a full snapshot on its own socket, so
//   the snapshot and the later changes travel one ordered stream; it ends when the socket unsubscribes or
//   closes. While a device has no subscriber, its changes build no payload and start no timer.
// Definitions, removals, and changes of state, message, range, or timeout are sent at once; changes of
// values only are coalesced per vector and sent at most once per VALUE_INTERVAL with the latest values. Every
// stream event carries the epoch of its connection's client (a new one for every client the connection
// opens) and a revision that increases with every event of the service, and every vector its own revision
// from the registry, which a write names as its base. A socket whose queue grows beyond MAX_BUFFERED_AMOUNT
// skips the changes of its streams and gets a new snapshot of each once it drains. BLOB vectors carry the
// format and size of their latest delivery only, never their bytes.

// Interval at which the value-only changes of the vectors of a streamed device are sent, in milliseconds.
export const VALUE_INTERVAL = 250

// Bytes a socket may have queued before its streams skip changes and wait for it to drain.
export const MAX_BUFFERED_AMOUNT = 1024 * 1024

// Driver messages of a device kept for the snapshot of a new subscription, newest last.
export const MAX_MESSAGES = 20

// A physical device of an INDI connection, as the directory lists it.
export interface IndiDeviceSummary {
	// Id of the open connection that provides the device.
	readonly connectionId: string
	// Id of the physical device; the same hardware id the managed interfaces of the device report.
	readonly hardwareId: string
	// Driver-reported device name.
	readonly name: string
	// Driver identification, once the driver defined DRIVER_INFO.
	readonly driver?: IndiDriver
	// Whether the device reports being connected to its hardware, when it defines CONNECTION.
	readonly connected?: boolean
}

// A message the driver sent for a device.
export interface IndiMessage {
	// Unique id of the message.
	readonly id: string
	// Text of the message.
	readonly message: string
	// Timestamp the driver attached, as sent (ISO 8601 UTC without zone).
	readonly timestamp?: string
}

// Events of the directory, broadcast to every tab.
export type IndiDeviceEvent = { readonly type: 'indi:deviceAdded'; readonly device: IndiDeviceSummary } | { readonly type: 'indi:deviceUpdated'; readonly device: IndiDeviceSummary } | { readonly type: 'indi:deviceRemoved'; readonly connectionId: string; readonly hardwareId: string }

// Identity and order of an event of the property stream of one device.
export interface IndiStreamHeader {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
	// Id of the client of the connection the device came from; a reconnection gets a new one, so events of
	// another epoch never apply to a snapshot.
	readonly epoch: string
	// Order of the event among every event of the service: later events have greater revisions.
	readonly revision: number
}

// The current vectors of one device, the first event of a subscription and of every resynchronization.
export interface IndiSnapshotEvent extends IndiStreamHeader {
	readonly type: 'indi:snapshot'
	// The device.
	readonly device: IndiDeviceSummary
	// Every vector, in definition order; each carries its own revision.
	readonly vectors: readonly IndiProperty[]
	// The latest driver messages of the device, newest last.
	readonly messages: readonly IndiMessage[]
}

// A vector was defined or redefined; it replaces any vector of the same name.
export interface IndiPropertyDefinedEvent extends IndiStreamHeader {
	readonly type: 'indi:propertyDefined'
	// The whole vector.
	readonly vector: IndiProperty
}

// The changing part of a vector after one or more changes.
export interface IndiPropertyUpdate {
	// Vector name.
	readonly name: string
	// Revision of the vector after the changes.
	readonly revision: number
	// Current state.
	readonly state: IndiProperty['state']
	// Current message.
	readonly message?: string
	// Current timestamp.
	readonly timestamp?: string
	// Current timeout, in seconds, for the vectors that have one.
	readonly timeout?: number
	// The current elements among those that changed, by name.
	readonly elements: Readonly<Record<string, IndiProperty['elements'][string]>>
}

// A vector changed.
export interface IndiPropertyUpdatedEvent extends IndiStreamHeader {
	readonly type: 'indi:propertyUpdated'
	// Most significant kind of the changes; coalesced value changes are values.
	readonly kind: IndiPropertyChangeKind
	// The vector after the changes.
	readonly vector: IndiPropertyUpdate
}

// A vector was deleted.
export interface IndiPropertyRemovedEvent extends IndiStreamHeader {
	readonly type: 'indi:propertyRemoved'
	// Name of the deleted vector.
	readonly name: string
}

// The driver sent a message for the device.
export interface IndiMessageEvent extends IndiStreamHeader {
	readonly type: 'indi:message'
	// The message.
	readonly message: IndiMessage
}

// Events of the property stream of one device, sent only to the sockets that subscribed to it.
export type IndiStreamEvent = IndiSnapshotEvent | IndiPropertyDefinedEvent | IndiPropertyUpdatedEvent | IndiPropertyRemovedEvent | IndiMessageEvent

// Stable code of a refused subscription:
// - notFound: the connection is not open or has no such INDI device;
// - unsupported: the connection is not an INDI connection.
export type IndiSubscriptionErrorCode = 'notFound' | 'unsupported'

// A subscription was refused; sent only to the socket that asked.
export interface IndiSubscriptionErrorEvent {
	readonly type: 'indi:subscriptionError'
	// Connection id the subscription named.
	readonly connectionId: string
	// Hardware id the subscription named.
	readonly hardwareId: string
	// Message meant for people.
	readonly error: string
	// Stable code a client branches on.
	readonly code: IndiSubscriptionErrorCode
}

// Every event of the service.
export type IndiServerEvent = IndiDeviceEvent | IndiStreamEvent | IndiSubscriptionErrorEvent

// Control messages a tab sends over its socket to start or end the property stream of one device.
// Subscribing again resends the snapshot; unsubscribing what is not subscribed does nothing.
export interface IndiClientMessage {
	readonly type: 'indi:subscribe' | 'indi:unsubscribe'
	// Id of the open connection of the device.
	readonly connectionId: string
	// Id of the physical device.
	readonly hardwareId: string
}

// Options of the service, for tests.
export interface IndiPropertyServiceOptions {
	// Interval of the value-only changes, in milliseconds (VALUE_INTERVAL by default).
	readonly valueInterval?: number
	// Bytes a socket may have queued before its streams skip changes (MAX_BUFFERED_AMOUNT by default).
	readonly maxBufferedAmount?: number
}

// Property stream of one physical device while it has subscribers.
interface Stream {
	// Id of the open connection of the device.
	readonly connectionId: string
	// Client of the connection.
	readonly client: Client
	// The device, as the registry keeps it.
	readonly device: IndiDevice
	// Key of the stream, connection id and hardware id.
	readonly key: string
	// Sockets subscribed to the device.
	readonly sockets: Set<EventSocket>
	// Elements whose value-only changes wait for the next delivery, by vector name.
	readonly pending: Map<string, Set<string>>
	// Timer of the next delivery of the pending changes.
	timer?: Timer
}

// Publishes the directory and the property streams of the devices of the open INDI connections.
export class IndiPropertyService implements SocketListener, Disposable {
	// Streams with subscribers, by key.
	readonly #streams = new Map<string, Stream>()
	// Streams with subscribers, by device, for the registry callbacks.
	readonly #devices = new Map<IndiDevice, Stream>()
	// Streams each socket subscribed to.
	readonly #subscriptions = new Map<EventSocket, Set<Stream>>()
	// Streams whose changes a socket skips until it drains.
	readonly #stale = new Map<EventSocket, Set<Stream>>()
	// Latest driver messages of each device of an INDI connection.
	readonly #messages = new WeakMap<IndiDevice, IndiMessage[]>()
	// Epoch of each client.
	readonly #epochs = new WeakMap<Client, string>()
	// Interval of the value-only changes, in milliseconds.
	readonly #valueInterval: number
	// Bytes a socket may have queued before its streams skip changes.
	readonly #maxBufferedAmount: number
	// Revision of the last stream event.
	#revision = 0
	// Stops listening to the registry.
	readonly #unlisten: VoidFunction

	// Creates the service over the devices of every connection; client resolves an open connection id to its
	// client and broadcast publishes the directory events to every tab.
	constructor(
		readonly devices: DeviceRegistry,
		readonly client: ClientResolver,
		readonly broadcast: (event: ServerEvent) => void,
		options?: IndiPropertyServiceOptions,
	) {
		this.#valueInterval = options?.valueInterval ?? VALUE_INTERVAL
		this.#maxBufferedAmount = options?.maxBufferedAmount ?? MAX_BUFFERED_AMOUNT
		this.#unlisten = devices.properties.addListener(this.#listener)
	}

	// Responds with the physical devices of an INDI connection; 404 when it is not open, 422 when it is not
	// an INDI connection.
	list(connectionId: string): Response {
		const client = this.client(connectionId)
		if (!client) return notFound('Connection')
		if (client.type !== 'INDI') return unsupported('Only INDI connections list their INDI devices')
		return Response.json(this.devices.properties.devices(client).map((device) => summary(connectionId, device)))
	}

	// Handles the control messages of a socket.
	message(socket: EventSocket, message: IndiClientMessage) {
		if (message.type === 'indi:subscribe') this.subscribe(socket, message)
		else this.unsubscribe(socket, message)
	}

	// Subscribes a socket to the property stream of a device and sends it a snapshot, or the error refusing it.
	subscribe(socket: EventSocket, { connectionId, hardwareId }: IndiClientMessage) {
		const client = this.client(connectionId)
		const device = client?.type === 'INDI' ? this.devices.properties.device(client, hardwareId) : undefined

		if (!client || !device) {
			const code = client && client.type !== 'INDI' ? 'unsupported' : 'notFound'
			const error = code === 'unsupported' ? 'Only INDI connections publish their properties' : client ? 'The connection has no such INDI device' : 'Connection not found'
			socket.send(JSON.stringify({ type: 'indi:subscriptionError', connectionId, hardwareId, error, code } satisfies IndiSubscriptionErrorEvent))
			return
		}

		const key = `${connectionId}:${device.hardwareId}`
		let stream = this.#streams.get(key)

		if (stream === undefined) {
			stream = { connectionId, client, device, key, sockets: new Set(), pending: new Map() }
			this.#streams.set(key, stream)
			this.#devices.set(device, stream)
		}

		stream.sockets.add(socket)

		let subscriptions = this.#subscriptions.get(socket)

		if (subscriptions === undefined) {
			subscriptions = new Set()
			this.#subscriptions.set(socket, subscriptions)
		}

		subscriptions.add(stream)
		this.#sendSnapshot(socket, stream)
	}

	// Ends the subscription of a socket to the property stream of a device.
	unsubscribe(socket: EventSocket, { connectionId, hardwareId }: IndiClientMessage) {
		const stream = this.#streams.get(`${connectionId}:${hardwareId}`)
		if (stream !== undefined) this.#leave(socket, stream)
	}

	// Sends a fresh snapshot of each stream a socket skipped while it was congested.
	drained(socket: EventSocket) {
		const stale = this.#stale.get(socket)
		if (stale === undefined) return
		this.#stale.delete(socket)
		for (const stream of stale) if (stream.sockets.has(socket)) this.#sendSnapshot(socket, stream)
	}

	// Ends every subscription of a closed socket.
	closed(socket: EventSocket) {
		const subscriptions = this.#subscriptions.get(socket)
		if (subscriptions !== undefined) for (const stream of Array.from(subscriptions)) this.#leave(socket, stream)
		this.#stale.delete(socket)
	}

	// Number of sockets subscribed to a device, for tests and diagnostics.
	subscribers(connectionId: string, hardwareId: string) {
		return this.#streams.get(`${connectionId}:${hardwareId}`)?.sockets.size ?? 0
	}

	// Receives the changes of the registry; returns before building anything for a device without subscribers.
	readonly #listener: IndiPropertyListener = {
		deviceAdded: (client, device) => this.#publishDevice(client, device, 'indi:deviceAdded'),
		deviceUpdated: (client, device) => this.#publishDevice(client, device, 'indi:deviceUpdated'),
		deviceRemoved: (client, device) => {
			const stream = this.#devices.get(device)
			if (stream !== undefined) this.#close(stream)
			const connectionId = client.type === 'INDI' ? this.devices.connection(client) : undefined
			if (connectionId) this.broadcast({ type: 'indi:deviceRemoved', connectionId, hardwareId: device.hardwareId })
		},
		propertyDefined: (_, device, property) => {
			const stream = this.#devices.get(device)
			if (stream === undefined) return
			stream.pending.delete(property.name)
			this.#send(stream, { ...this.#header(stream), type: 'indi:propertyDefined', vector: property })
		},
		propertyUpdated: (_, device, property, change) => {
			const stream = this.#devices.get(device)
			if (stream !== undefined) this.#updated(stream, property, change)
		},
		propertyRemoved: (_, device, property) => {
			const stream = this.#devices.get(device)
			if (stream === undefined) return
			stream.pending.delete(property.name)
			this.#send(stream, { ...this.#header(stream), type: 'indi:propertyRemoved', name: property.name })
		},
		message: (client, device, message) => {
			if (client.type !== 'INDI') return
			const received = this.#keep(device, message)
			const stream = this.#devices.get(device)
			if (stream !== undefined) this.#send(stream, { ...this.#header(stream), type: 'indi:message', message: received })
		},
	}

	// Broadcasts a device of an INDI connection to the directory.
	#publishDevice(client: Client, device: IndiDevice, type: 'indi:deviceAdded' | 'indi:deviceUpdated') {
		const connectionId = client.type === 'INDI' ? this.devices.connection(client) : undefined
		if (connectionId) this.broadcast({ type, device: summary(connectionId, device) })
	}

	// Sends a change of a vector: value-only changes wait for the next delivery, any other change is sent at
	// once with the values still pending for the vector.
	#updated(stream: Stream, property: IndiProperty, change: IndiPropertyChange) {
		let pending = stream.pending.get(property.name)

		if (change.kind === 'values') {
			if (pending === undefined) {
				pending = new Set()
				stream.pending.set(property.name, pending)
			}

			for (const name of change.elements) pending.add(name)
			stream.timer ??= setTimeout(() => this.#flush(stream), this.#valueInterval)
			return
		}

		stream.pending.delete(property.name)
		const elements = pending === undefined ? change.elements : new Set([...pending, ...change.elements])
		this.#send(stream, { ...this.#header(stream), type: 'indi:propertyUpdated', kind: change.kind, vector: update(property, elements) })
	}

	// Sends the pending value-only changes of a stream, with the current values.
	#flush(stream: Stream) {
		stream.timer = undefined

		for (const [name, elements] of stream.pending) {
			const property = stream.device.properties[name]
			if (property !== undefined) this.#send(stream, { ...this.#header(stream), type: 'indi:propertyUpdated', kind: 'values', vector: update(property, elements) })
		}

		stream.pending.clear()
	}

	// Sends a snapshot of a stream to one socket, ending any resynchronization it was waiting for.
	#sendSnapshot(socket: EventSocket, stream: Stream) {
		this.#stale.get(socket)?.delete(stream)
		const { connectionId, device } = stream
		const event: IndiSnapshotEvent = { ...this.#header(stream), type: 'indi:snapshot', device: summary(connectionId, device), vectors: Object.values(device.properties), messages: this.#messages.get(device) ?? [] }
		this.#write(socket, stream, JSON.stringify(event))
	}

	// Sends a stream event to every socket of the stream, serialized once.
	#send(stream: Stream, event: IndiStreamEvent) {
		const data = JSON.stringify(event)
		for (const socket of stream.sockets) this.#write(socket, stream, data)
	}

	// Writes to a socket unless it skips the stream; a congested socket, or one that dropped or queued the
	// data, skips the stream until it drains and resynchronizes.
	#write(socket: EventSocket, stream: Stream, data: string) {
		if (this.#stale.get(socket)?.has(stream)) return
		if (socket.getBufferedAmount() <= this.#maxBufferedAmount && socket.send(data) > 0) return

		let stale = this.#stale.get(socket)

		if (stale === undefined) {
			stale = new Set()
			this.#stale.set(socket, stale)
		}

		stale.add(stream)
	}

	// Builds the header of the next event of a stream.
	#header({ connectionId, client, device }: Stream): IndiStreamHeader {
		let epoch = this.#epochs.get(client)

		if (epoch === undefined) {
			epoch = Bun.randomUUIDv7()
			this.#epochs.set(client, epoch)
		}

		return { connectionId, hardwareId: device.hardwareId, epoch, revision: ++this.#revision }
	}

	// Keeps a driver message of a device among its latest ones and returns it as the stream sends it.
	#keep(device: IndiDevice, { id, message, timestamp }: Message): IndiMessage {
		const received: IndiMessage = timestamp === undefined ? { id, message } : { id, message, timestamp }
		let messages = this.#messages.get(device)

		if (messages === undefined) {
			messages = []
			this.#messages.set(device, messages)
		}

		messages.push(received)
		if (messages.length > MAX_MESSAGES) messages.shift()
		return received
	}

	// Removes a socket from a stream, closing the stream with its last subscriber.
	#leave(socket: EventSocket, stream: Stream) {
		stream.sockets.delete(socket)
		this.#stale.get(socket)?.delete(stream)

		const subscriptions = this.#subscriptions.get(socket)
		subscriptions?.delete(stream)
		if (subscriptions?.size === 0) this.#subscriptions.delete(socket)

		if (stream.sockets.size === 0) this.#close(stream)
	}

	// Drops a stream with its pending changes, ending the subscriptions of its sockets.
	#close(stream: Stream) {
		clearTimeout(stream.timer)
		stream.timer = undefined
		stream.pending.clear()
		this.#streams.delete(stream.key)
		this.#devices.delete(stream.device)

		for (const socket of stream.sockets) {
			const subscriptions = this.#subscriptions.get(socket)
			subscriptions?.delete(stream)
			if (subscriptions?.size === 0) this.#subscriptions.delete(socket)
			this.#stale.get(socket)?.delete(stream)
		}

		stream.sockets.clear()
	}

	// Stops listening to the registry and drops every stream.
	[Symbol.dispose]() {
		this.#unlisten()
		for (const stream of Array.from(this.#streams.values())) this.#close(stream)
	}
}

// Summarizes a device of a connection for the directory.
function summary(connectionId: string, { hardwareId, name, driver, connected }: IndiDevice): IndiDeviceSummary {
	return { connectionId, hardwareId, name, driver, connected }
}

// Builds the changing part of a vector with the current values of the named elements.
function update(property: IndiProperty, names: Iterable<string>): IndiPropertyUpdate {
	const elements: Record<string, IndiProperty['elements'][string]> = {}

	for (const name of names) {
		const element = property.elements[name]
		if (element !== undefined) elements[name] = element
	}

	const { name, revision, state, message, timestamp } = property
	return { name, revision, state, message, timestamp, timeout: property.type === 'LIGHT' ? undefined : property.timeout, elements }
}

// Routes of the INDI device directory; the property streams travel over /api/ws.
export function createIndiRoutes(indi: IndiPropertyService) {
	return {
		'/api/connections/:id/indi/devices': {
			// The physical devices of an INDI connection, managed or not, without their properties.
			GET: (req) => indi.list(req.params.id),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
