import { AlpacaClient } from 'nebulosa/src/devices/alpaca/client'
import { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { Client } from 'nebulosa/src/devices/indi/device'
import { EventBus } from 'src/shared/bus'
import type { ConnectionEvent, Connect, ConnectionStatus } from '#/connection'
import type { ConnectionInitializers, ConnectionStart } from './connection.start'
import { response } from './http'
import type { Endpoints } from './http'
import { indiBus } from './indi'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'
import type { OperationCoordinator } from './operation'
import { settlesWithin } from './util'

// Owns pending and active connections, publishes their status and coordinates cleanup before disposal.

// Public connection lifecycle notifications forwarded to browser clients.
export interface ConnectionBusEvents {
	// Fully initialized new or reused connection.
	readonly open: ConnectionEvent
	// Final status of a removed connection.
	readonly close: ConnectionEvent
}

// Shared connection event channel.
export const connectionBus = new EventBus<ConnectionBusEvents>()

// Maximum milliseconds an expected client disconnect waits for operational cleanup.
const DEFAULT_DISCONNECT_CLEANUP_TIMEOUT = 5000

// One initialization shared by concurrent requests; cancellation prevents late publication.
interface PendingConnection {
	// Exact client whose partial resources are owned by this attempt.
	readonly client: Client
	// Completion including cleanup; resolves undefined on failure or cancellation.
	readonly result: Promise<ConnectionStatus | undefined>
	// Set by disconnect or an unexpected transport close while initialization is pending.
	cancelled: boolean
}

// Groups equivalent connection requests before a transport identity is available. ALPACA includes TLS.
function connectionKey(request: Readonly<Connect>) {
	return request.type === 'SIMULATOR' ? request.type : JSON.stringify([request.type, request.host, request.port, request.type === 'ALPACA' && request.secured])
}

// Owns client transports and coordinates their operational cleanup before disposal.
export class ConnectionHandler {
	private readonly clients = new Map<string, Client>()
	private readonly pending = new Map<string, PendingConnection>()

	// Subscribes to unexpected transport closes and retains the coordinator used during disconnect.
	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
		readonly operationCoordinator: OperationCoordinator,
		readonly initializers: ConnectionInitializers,
		readonly disconnectCleanupTimeout = DEFAULT_DISCONNECT_CLEANUP_TIMEOUT,
	) {
		indiBus.subscribe('close', (client) => {
			this.#unexpectedClose(client)
		})

		connectionBus.subscribe('open', (event) => wsm.send('connection:open', event))
		connectionBus.subscribe('close', (event) => wsm.send('connection:close', event))
	}

	// Returns the client with id, or the first active client; notifies when there is no active connection.
	get(id?: string) {
		let client: Client | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)
		if (!client) this.notificationHandler.send({ title: 'CONNECTION', description: 'No active connection!', color: 'danger' })
		return client!
	}

	// Starts or reuses a trusted connection request. Equivalent pending requests share one completion;
	// only fully initialized clients enter the active map. Failures notify and return undefined.
	async connect(req: Connect & { id?: string }): Promise<ConnectionStatus | undefined> {
		for (const client of this.clients.values()) {
			if (client.type !== req.type) continue
			if (
				client.type === 'SIMULATOR' ||
				client.id === req.id ||
				(client instanceof IndiClient && client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) ||
				(client instanceof AlpacaClient && client.remotePort === req.port && client.remoteHost === req.host && client.url.startsWith(req.secured ? 'https:' : 'http:'))
			) {
				return this.#opened(client, true)
			}
		}

		const key = connectionKey(req)
		const existing = this.pending.get(key)
		if (existing) return await existing.result

		const initializer = this.initializers[req.type]
		if (initializer === undefined) {
			this.notificationHandler.send({ title: 'CONNECTION', description: 'Unsupported connection type: ' + req.type, color: 'danger' })
			return undefined
		}

		let prepared: ConnectionStart

		try {
			prepared = initializer({ ...req })
		} catch (error) {
			this.#failed(req.type, error)
			return undefined
		}

		// INDI learns its id when TCP connects; other clients are blocked before they publish devices.
		if (prepared.client.id) this.operationCoordinator.arbiter.markClientUnavailable(prepared.client.id)

		const pending: PendingConnection = {
			client: prepared.client,
			cancelled: false,
			result: Promise.resolve().then(() => this.#start(key, req.type, prepared, pending)),
		}

		this.pending.set(key, pending)
		return await pending.result
	}

	// Completes one prepared attempt. Failure or cancellation disposes partial resources before retry is allowed.
	async #start(key: string, type: Connect['type'], prepared: ConnectionStart, pending: PendingConnection): Promise<ConnectionStatus | undefined> {
		const client = prepared.client
		let accepted = false

		try {
			if (pending.cancelled) return undefined

			const started = await prepared.start()
			if (pending.cancelled) return undefined

			if (!started) {
				this.#failed(type)
				return undefined
			}

			// Different INDI host aliases can resolve to the same transport identity.
			const existing = this.clients.get(client.id)
			if (existing) return this.#opened(existing, true)

			this.clients.set(client.id, client)
			accepted = true
			return this.#opened(client, false)
		} catch (error) {
			if (!pending.cancelled) this.#failed(type, error)
			return undefined
		} finally {
			try {
				if (!accepted) {
					if (client.id && !this.clients.has(client.id)) this.operationCoordinator.arbiter.markClientUnavailable(client.id)
					client[Symbol.dispose]()
				}
			} finally {
				this.pending.delete(key)
			}
		}
	}

	// Publishes a fully initialized client and enables its resources; reused identifies an existing connection.
	#opened(client: Client, reused: boolean): ConnectionStatus {
		this.operationCoordinator.arbiter.markClientAvailable(client.id)
		console.info(reused ? 'reusing existing connection:' : 'new connection to:', client.id, client.description)
		const status = this.status(client)!
		connectionBus.emit('open', { status, reused })
		return status
	}

	// Reports a protocol startup failure; unexpected causes are logged without exposing transport details to the UI.
	#failed(type: Connect['type'], error?: unknown) {
		if (error !== undefined) console.error('failed to start connection:', type, error)
		this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to start ' + type + ' connection', color: 'danger' })
	}

	// Blocks a client, waits bounded operational cleanup, then disposes its live transport.
	async disconnect(id: string | Client) {
		for (const pending of this.pending.values()) {
			if (typeof id === 'string' ? pending.client.id === id : pending.client === id) {
				pending.cancelled = true
				if (pending.client.id) this.operationCoordinator.arbiter.markClientUnavailable(pending.client.id)
				await pending.result
				return
			}
		}

		const entry = this.#entry(id)

		if (entry === undefined) return

		const [key, client] = entry
		this.operationCoordinator.arbiter.markClientUnavailable(client.id)

		const cleaned = await settlesWithin(this.operationCoordinator.cancelByClient(client.id, 'disconnected'), this.disconnectCleanupTimeout)

		if (!cleaned) console.warn('timed out while cleaning operations for:', client.id, client.description)
		if (this.clients.get(key) === client) this.#remove(key, client, true)
	}

	// Blocks and cancels operations after an unexpected close without waiting on an unavailable transport.
	#unexpectedClose(client: Client) {
		for (const pending of this.pending.values()) {
			if (pending.client === client) {
				pending.cancelled = true
				return
			}
		}

		const entry = this.#entry(client)
		if (entry === undefined) return

		const [key] = entry
		this.operationCoordinator.arbiter.markClientUnavailable(client.id)
		void this.operationCoordinator.cancelByClient(client.id, 'disconnected').catch((error) => console.error(error))
		this.#remove(key, client, false)
	}

	// Locates the canonical map entry for either a client id or exact client instance.
	#entry(id: string | Client): readonly [string, Client] | undefined {
		if (typeof id === 'string') {
			const client = this.clients.get(id)
			return client && [id, client]
		}

		for (const entry of this.clients) {
			if (entry[1] === id) return entry
		}
	}

	// Removes one exact client, optionally disposes it, and emits its final connection status once.
	#remove(key: string, client: Client, dispose: boolean) {
		if (this.clients.get(key) !== client) return

		const status = this.status(client)!
		this.clients.delete(key)
		console.info('disconnected from:', client.id, client.description)
		if (dispose) client[Symbol.dispose]()
		connectionBus.emit('close', { status })
	}

	// Returns transport metadata for a client or active id, or undefined when the id is not registered.
	status(client?: string | Client): ConnectionStatus | undefined {
		if (client === undefined) return undefined

		if (typeof client === 'string') {
			client = this.clients.get(client)
			return client && this.status(client)
		} else {
			if (client instanceof IndiClient || client instanceof AlpacaClient) {
				return { id: client.id, host: client.remoteHost ?? '', ip: 'remoteIp' in client ? (client.remoteIp ?? '') : '', port: client.remotePort ?? -1, type: client.type }
			} else {
				return { id: client.id, host: '', ip: '', type: 'SIMULATOR', port: -1 }
			}
		}
	}

	// Allocates the statuses of active connections, excluding pending attempts.
	list() {
		return Array.from(this.clients.values())
			.map((e) => this.status(e))
			.filter((e) => !!e)
	}
}

// Creates HTTP routes over the configured connection owner; runtime dependencies are injected at startup.
export function connection(connectionHandler: ConnectionHandler) {
	return {
		'/connections': { GET: () => response(connectionHandler.list()), POST: async (req) => response(await connectionHandler.connect(await req.json())) },
		'/connections/:id': { GET: (req) => response(connectionHandler.status(req.params.id)), DELETE: async (req) => response(await connectionHandler.disconnect(req.params.id)) },
	} as const satisfies Endpoints
}
