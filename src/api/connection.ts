import Elysia from 'elysia'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi'
import { badRequest, internalServerError, noActiveConnection } from './exceptions'
import type { Connect, ConnectionStatus } from './types'

// Provider interface for managing connections to INDI servers
export interface ConnectionProvider {
	readonly client: (id?: string) => IndiClient
	readonly connect: (req: Connect, indiClientHandler: IndiClientHandler) => Promise<ConnectionStatus | undefined>
	readonly disconnect: (id: string | IndiClient) => void
	readonly status: (key: string | IndiClient) => ConnectionStatus | undefined
	readonly list: () => ConnectionStatus[]
}

// Manager that handles connections to INDI servers
export class ConnectionManager implements ConnectionProvider {
	private readonly clients = new Map<string, IndiClient>()

	// Returns the first client if no id is provided, or the client with the specified id
	client(id?: string) {
		let client: IndiClient | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)

		if (!client) throw noActiveConnection()
		else return client
	}

	// Connects to an INDI server based on the provided request
	// If a client with the same port and host/IP already exists, returns its status
	async connect(req: Connect, indiClientHandler: IndiClientHandler): Promise<ConnectionStatus | undefined> {
		for (const [, client] of this.clients) {
			if (client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) {
				return this.status(client)
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indiClientHandler })

			try {
				if (await client.connect(req.host, req.port)) {
					const id = Bun.MD5.hash(`${client.remoteIp}:${client.remotePort}:INDI`, 'hex')
					this.clients.set(id, client)
					return this.status(client)
				}
			} catch (e) {
				throw internalServerError('Failed to connect to INDI server')
			}
		}

		throw badRequest('Invalid connection request')
	}

	// Disconnects the client with the specified id or the client instance
	disconnect(id: string | IndiClient) {
		if (typeof id === 'string') {
			const client = this.clients.get(id)

			if (client) {
				client.close()
				this.clients.delete(id)
			}
		} else {
			for (const [key, client] of this.clients) {
				if (client === id) {
					client.close()
					this.clients.delete(key)
					break
				}
			}
		}
	}

	// Returns the status of a client based on its id or the client instance
	status(key: string | IndiClient): ConnectionStatus | undefined {
		if (typeof key === 'string') {
			const client = this.clients.get(key)

			if (client) {
				return { type: 'INDI', id: key, ip: client.remoteIp, host: client.remoteHost!, port: client.remotePort! }
			}
		} else {
			for (const [id, client] of this.clients) {
				if (client === key) {
					return { type: 'INDI', id, ip: key.remoteIp, host: key.remoteHost!, port: key.remotePort! }
				}
			}
		}

		return undefined
	}

	// Lists all active connections
	list() {
		return Array.from(this.clients.values())
			.map((e) => this.status(e))
			.filter((e) => !!e)
	}
}

// Creates an instance of Elysia with connection endpoints
export function connection(connection: ConnectionProvider, indiClientHandler: IndiClientHandler) {
	const app = new Elysia({ prefix: '/connections' })

	app.get('', () => {
		return connection.list()
	})

	app.post('', async ({ body }) => {
		return await connection.connect(body as never, indiClientHandler)
	})

	app.get('/:id', ({ params }) => {
		return connection.status(params.id)
	})

	app.delete('/:id', ({ params }) => {
		connection.disconnect(params.id)
	})

	return app
}
