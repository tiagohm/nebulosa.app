import { AlpacaClient } from 'nebulosa/src/alpaca.client'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi.client'
import type { Client } from 'nebulosa/src/indi.device'
import bus from '../shared/bus'
import type { Connect, ConnectionEvent, ConnectionStatus } from '../shared/types'
import { type Endpoints, response } from './http'
import type { WebSocketMessageHandler } from './message'
import type { NotificationHandler } from './notification'

export class ConnectionHandler {
	private readonly clients = new Map<string, Client>()

	constructor(
		readonly wsm: WebSocketMessageHandler,
		readonly notificationHandler: NotificationHandler,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove the client from the active connections
			this.disconnect(client)
		})
	}

	get(id?: string) {
		let client: Client | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)
		if (!client) this.notificationHandler.send({ title: 'CONNECTION', description: 'No active connection!', color: 'danger' })
		return client!
	}

	async connect(req: Connect & { id?: string }, indi: IndiClientHandler): Promise<ConnectionStatus | undefined> {
		for (const [, client] of this.clients) {
			if (client.id === req.id || (client instanceof IndiClient && client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) || (client instanceof AlpacaClient && client.remotePort === req.port && client.remoteHost === req.host)) {
				console.info('reusing existing connection:', client.id, client.description)
				const status = this.status(client)!
				this.wsm.send<ConnectionEvent>('connection:open', { status, reused: true })
				return status
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indi })

			try {
				if (await client.connect(req.host, req.port)) {
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					this.wsm.send<ConnectionEvent>('connection:open', { status, reused: false })
					return status
				}
			} catch (e) {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to INDI server', color: 'danger' })
			}
		} else if (req.type === 'ALPACA') {
			const client = new AlpacaClient(`http${req.secured ? 's' : ''}://${req.host}:${req.port}`, { handler: indi })

			try {
				if (await client.start()) {
					this.clients.set(client.id, client)

					console.info('new connection to:', client.id, client.description)

					const status = this.status(client)!
					this.wsm.send<ConnectionEvent>('connection:open', { status, reused: false })
					return status
				}
			} catch (e) {
				this.notificationHandler.send({ title: 'CONNECTION', description: 'Failed to connect to Alpaca server', color: 'danger' })
			}
		}

		return undefined
	}

	disconnect(id: string | Client) {
		if (typeof id === 'string') {
			const client = this.clients.get(id)

			if (client) {
				const status = this.status(client)!

				this.clients.delete(id)
				console.info('disconnected from:', client.id, client.description)

				if (client instanceof IndiClient) client.close()

				this.wsm.send<ConnectionEvent>('connection:close', { status })
			}
		} else {
			for (const [key, client] of this.clients) {
				if (client === id) {
					const status = this.status(client)!

					this.clients.delete(key)
					console.info('disconnected from:', client.id, client.description)

					if (client instanceof IndiClient) client.close()

					this.wsm.send<ConnectionEvent>('connection:close', { status })

					break
				}
			}
		}
	}

	status(key: string | Client): ConnectionStatus | undefined {
		if (typeof key === 'string') {
			const client = this.clients.get(key)
			return client && { type: client.type, id: key }
		} else {
			for (const [id, client] of this.clients) {
				if (client === key) {
					return client && { type: client.type, id }
				}
			}
		}

		return undefined
	}

	list() {
		return Array.from(this.clients.values())
			.map((e) => this.status(e))
			.filter((e) => !!e)
	}
}

export function connection(connectionHandler: ConnectionHandler, indi: IndiClientHandler): Endpoints {
	return {
		'/connections': { GET: () => response(connectionHandler.list()), POST: async (req) => response(await connectionHandler.connect(await req.json(), indi)) },
		'/connections/:id': { GET: (req) => response(connectionHandler.status(req.params.id)), DELETE: (req) => response(connectionHandler.disconnect(req.params.id)) },
	}
}
