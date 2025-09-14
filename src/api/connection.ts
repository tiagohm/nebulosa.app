import Elysia from 'elysia'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi'
import bus from '../shared/bus'
import type { Connect, ConnectionEvent, ConnectionStatus } from '../shared/types'
import type { WebSocketMessageManager } from './message'
import type { NotificationManager } from './notification'

export class ConnectionManager {
	private readonly clients = new Map<string, IndiClient>()

	constructor(
		readonly wsm: WebSocketMessageManager,
		readonly notification: NotificationManager,
	) {
		bus.subscribe('indi:close', (client: IndiClient) => {
			// Remove the client from the active connections
			this.disconnect(client)
		})
	}

	get(id?: string) {
		let client: IndiClient | undefined
		if (!id) client = this.clients.values().next().value
		else client = this.clients.get(id)
		if (!client) this.notification.send({ body: 'No active connection!', severity: 'error' })
		return client!
	}

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

					const status = this.status(client)!
					this.wsm.send<ConnectionEvent>('connection:open', { status })
					return status
				}
			} catch (e) {
				this.notification.send({ body: 'Failed to connect to INDI server', severity: 'error' })
			}
		}

		return undefined
	}

	disconnect(id: string | IndiClient) {
		if (typeof id === 'string') {
			const client = this.clients.get(id)

			if (client) {
				const status = this.status(client)!

				client.close()
				this.clients.delete(id)

				this.wsm.send<ConnectionEvent>('connection:close', { status })

				console.info('disconnected from INDI server', client.remoteIp, client.remotePort)
			}
		} else {
			for (const [key, client] of this.clients) {
				if (client === id) {
					const status = this.status(client)!

					client.close()
					this.clients.delete(key)

					this.wsm.send<ConnectionEvent>('connection:close', { status })

					console.info('disconnected from INDI server', client.remoteIp, client.remotePort)

					break
				}
			}
		}
	}

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

	list() {
		return Array.from(this.clients.values()).map((e) => this.status(e)!)
	}
}

export function connection(connection: ConnectionManager, indi: IndiClientHandler) {
	const app = new Elysia({ prefix: '/connections' })
		// Endpoints!
		.get('', () => connection.list())
		.post('', async ({ body }) => await connection.connect(body as never, indi))
		.get('/:id', ({ params }) => connection.status(params.id))
		.delete('/:id', ({ params }) => connection.disconnect(params.id))

	return app
}
