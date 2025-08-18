import Elysia from 'elysia'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { Connect, ConnectionStatus } from '../shared/types'
import { badRequest, internalServerError, noActiveConnection } from './exceptions'

// Manager that handles connections to INDI servers
export class ConnectionManager {
	private readonly clients = new Map<string, IndiClient>()

	constructor() {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove the client from the active connections
			this.disconnect(client)
		})
	}

	// Returns the first client if no id is provided, or the client with the specified id
	get(id?: string) {
		let client: IndiClient | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)

		if (!client) throw noActiveConnection()
		else return client
	}

	// Connects to an INDI server based on the provided request
	// If a client with the same port and host/IP already exists, returns its status
	async connect(req: Connect, indi: IndiClientHandler): Promise<ConnectionStatus | undefined> {
		for (const [, client] of this.clients) {
			if (client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) {
				console.info('reusing existing connection to INDI server', client.remoteIp, client.remotePort)
				return this.status(client)
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indi })

			try {
				if (await client.connect(req.host, req.port)) {
					const id = Bun.MD5.hash(`${client.remoteIp}:${client.remotePort}:INDI`, 'hex')
					this.clients.set(id, client)
					console.info('new connection to INDI server', client.remoteIp, client.remotePort)
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
				console.info('disconnected from INDI server', client.remoteIp, client.remotePort)
			}
		} else {
			for (const [key, client] of this.clients) {
				if (client === id) {
					client.close()
					this.clients.delete(key)
					console.info('disconnected from INDI server', client.remoteIp, client.remotePort)
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
					return { type: 'INDI', id, ip: client.remoteIp, host: client.remoteHost!, port: client.remotePort! }
				}
			}
		}

		return undefined
	}

	// Lists all active connections
	list() {
		return Array.from(this.clients.values()).map((e) => this.status(e)!)
	}
}

// Endpoints for managing connections
export function connection(connection: ConnectionManager, indi: IndiClientHandler) {
	const app = new Elysia({ prefix: '/connections' })
		// Endpoints!
		.get('', () => connection.list())
		.post('', async ({ body }) => await connection.connect(body as never, indi))
		.get('/:id', ({ params }) => connection.status(params.id))
		.delete('/:id', ({ params }) => connection.disconnect(params.id))

	return app
}
