import type { Server } from 'bun'
import { connections } from './connection'
import { broadcast, websocket } from './websocket'

// HTTP routes and the WebSocket handler of the backend, mounted by the app server.

export type { ConnectionEvent, ConnectionStatus, ConnectionType, ConnectRequest, RemoteConnectRequest, ServerEvent } from './connection'
export type { DeviceEvent, DeviceSummary, ManagedDeviceType } from './devices'
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

// Sends the CONNECTION switch to a device of an open connection. Responds 202 once sent (the new state
// arrives as a device:updated event) and 404 when the connection is not open or has no such device.
function switchDevice(id: string, deviceId: string, connect: boolean): Response {
	const client = connections.client(id)
	if (!client || !connections.devices.switch(client, deviceId, connect)) return Response.json({ error: 'Device not found' }, { status: 404 })
	return new Response(null, { status: 202 })
}

// Bun.serve routes under /api/.
export const routes = {
	'/api/health': {
		GET: () => Response.json({ status: 'ok' }),
	},
	'/api/connections': {
		// The open connections, shared by every tab.
		GET: () => Response.json(connections.list()),
		POST: connect,
	},
	'/api/connections/:id': {
		// Closes the connection for every tab; 404 when it is not open.
		DELETE: (req) => new Response(null, { status: connections.disconnect(req.params.id) ? 204 : 404 }),
	},
	'/api/connections/:id/devices': {
		// The managed devices of an open connection; 404 when it is not open.
		GET: (req) => {
			const client = connections.client(req.params.id)
			return client ? Response.json(connections.devices.list(client)) : Response.json({ error: 'Connection not found' }, { status: 404 })
		},
	},
	'/api/connections/:id/devices/:deviceId/connect': {
		POST: (req) => switchDevice(req.params.id, req.params.deviceId, true),
	},
	'/api/connections/:id/devices/:deviceId/disconnect': {
		POST: (req) => switchDevice(req.params.id, req.params.deviceId, false),
	},
	'/api/ws': {
		// Upgrades to the event WebSocket; Bun sends the handshake response itself.
		GET: (req: Request, server: Server<undefined>) => (server.upgrade(req) ? undefined : new Response('WebSocket upgrade failed', { status: 400 })),
	},
} as const as Readonly<Bun.Serve.Routes<undefined, string>>
