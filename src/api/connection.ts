import { getDefaultInjector, molecule } from 'bunshi'
import Elysia from 'elysia'
import { IndiClient } from 'nebulosa/src/indi'
import { BusMolecule } from './bus'
import { badRequest, internalServerError, noActiveConnection } from './exceptions'
import { IndiMolecule } from './indi'
import type { Connect, ConnectionStatus } from './types'

const injector = getDefaultInjector()

// Molecule that handles connections to INDI servers
export const ConnectionMolecule = molecule((m) => {
	const bus = m(BusMolecule)

	const clients = new Map<string, IndiClient>()

	bus.subscribe('indi:close', (client: IndiClient) => {
		// Remove the client from the active connections
		disconnect(client)
	})

	// Returns the first client if no id is provided, or the client with the specified id
	function get(id?: string) {
		let client: IndiClient | undefined
		if (!id) client = clients.values().next().value
		else client = clients.get(id)

		if (!client) throw noActiveConnection()
		else return client
	}

	// Connects to an INDI server based on the provided request
	// If a client with the same port and host/IP already exists, returns its status
	async function connect(req: Connect): Promise<ConnectionStatus | undefined> {
		for (const [, client] of clients) {
			if (client.remotePort === req.port && (client.remoteHost === req.host || client.remoteIp === req.host)) {
				return status(client)
			}
		}

		if (req.type === 'INDI') {
			const indi = injector.get(IndiMolecule)
			const client = new IndiClient({ handler: indi })

			try {
				if (await client.connect(req.host, req.port)) {
					const id = Bun.MD5.hash(`${client.remoteIp}:${client.remotePort}:INDI`, 'hex')
					clients.set(id, client)
					return status(client)
				}
			} catch (e) {
				throw internalServerError('Failed to connect to INDI server')
			}
		}

		throw badRequest('Invalid connection request')
	}

	// Disconnects the client with the specified id or the client instance
	function disconnect(id: string | IndiClient) {
		if (typeof id === 'string') {
			const client = clients.get(id)

			if (client) {
				client.close()
				clients.delete(id)
			}
		} else {
			for (const [key, client] of clients) {
				if (client === id) {
					client.close()
					clients.delete(key)
					break
				}
			}
		}
	}

	// Returns the status of a client based on its id or the client instance
	function status(key: string | IndiClient): ConnectionStatus | undefined {
		if (typeof key === 'string') {
			const client = clients.get(key)

			if (client) {
				return { type: 'INDI', id: key, ip: client.remoteIp, host: client.remoteHost!, port: client.remotePort! }
			}
		} else {
			for (const [id, client] of clients) {
				if (client === key) {
					return { type: 'INDI', id, ip: client.remoteIp, host: client.remoteHost!, port: client.remotePort! }
				}
			}
		}

		return undefined
	}

	// Lists all active connections
	function list() {
		return Array.from(clients.values()).map((e) => status(e)!)
	}

	// The endpoints for managing connections
	const app = new Elysia({ prefix: '/connections' })

	app.get('', () => {
		return list()
	})

	app.post('', async ({ body }) => {
		return await connect(body as never)
	})

	app.get('/:id', ({ params }) => {
		return status(params.id)
	})

	app.delete('/:id', ({ params }) => {
		disconnect(params.id)
	})

	return { get, connect, disconnect, status, list, app } as const
})
