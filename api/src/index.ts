import type { Server } from 'bun'
import { connections } from './connection'
import { broadcast, websocket } from './websocket'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

export type { ConnectionEvent, ConnectionStatus, ConnectionType, ConnectRequest } from './connection'
export { websocket }

connections.listen(broadcast)

// Opens a connection, or returns the existing one for the same endpoint. Responds 400 for an invalid
// body and 502 when the endpoint cannot be reached.
async function connect(req: Request): Promise<Response> {
	try {
		return Response.json(await connections.connect(await req.json()))
	} catch (error) {
		return Response.json({ error: Error.isError(error) ? error.message : 'Unable to connect' }, { status: 502 })
	}
}

// Bun.serve routes under /api/.
export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
	'/api/connections': {
		POST: connect,
	},
	'/api/connections/:id': {
		// Closes the connection for every tab; 404 when it is not open.
		DELETE: (req: Bun.BunRequest<'/api/connections/:id'>) => new Response(null, { status: connections.disconnect(req.params.id) ? 204 : 404 }),
	},
	'/api/ws': {
		// Upgrades to the event WebSocket; Bun sends the handshake response itself.
		GET: (req: Request, server: Server<undefined>) => (server.upgrade(req) ? undefined : new Response('WebSocket upgrade failed', { status: 400 })),
	},
}
