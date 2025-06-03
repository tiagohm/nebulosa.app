import Elysia from 'elysia'
import { IndiClient, type IndiClientHandler } from 'nebulosa/src/indi'
import type { Connect, ConnectionStatus } from './types'

export interface ConnectionProvider {
	readonly client: (id?: string) => IndiClient | undefined
	readonly connect: (req: Connect, indiClientHandler: IndiClientHandler) => Promise<ConnectionStatus | undefined>
	readonly disconnect: (id: string) => void
	readonly status: (key: string | IndiClient) => ConnectionStatus | undefined
	readonly list: () => ConnectionStatus[]
}

export class ConnectionEndpoint {
	private readonly clients = new Map<string, IndiClient>()

	client(id?: string): IndiClient | undefined {
		if (!id) return this.clients.values().next().value
		else return this.clients.get(id)
	}

	async connect(req: Connect, indiClientHandler: IndiClientHandler): Promise<ConnectionStatus | undefined> {
		for (const [, client] of this.clients) {
			if (client.localPort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) {
				return this.status(client)
			}
		}

		if (req.type === 'INDI') {
			const client = new IndiClient({ handler: indiClientHandler })

			if (await client.connect(req.host, req.port)) {
				const id = Bun.MD5.hash(`${client.remoteIp}:${client.remotePort}:INDI`, 'hex')
				this.clients.set(id, client)
				return this.status(client)
			}
		}

		return undefined
	}

	disconnect(id: string) {
		const client = this.clients.get(id)

		if (client) {
			client.close()
			this.clients.delete(id)
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
					return { type: 'INDI', id, ip: key.remoteIp, host: key.remoteHost!, port: key.remotePort! }
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

export function connection(connection: ConnectionProvider, indiClientHandler: IndiClientHandler) {
	const app = new Elysia({ prefix: '/connections' })

	app.get('/', () => {
		return connection.list()
	})

	app.post('/', async ({ body }) => {
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
