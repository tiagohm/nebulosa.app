import { AlpacaClient } from 'nebulosa/src/devices/alpaca/client'
import { IndiClient, type IndiClientHandler, IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Client } from 'nebulosa/src/devices/indi/device'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { CoverSimulator } from 'nebulosa/src/devices/indi/simulator/cover'
import { DomeSimulator } from 'nebulosa/src/devices/indi/simulator/dome'
import { FlatPanelSimulator } from 'nebulosa/src/devices/indi/simulator/flatpanel'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import { MountSimulator } from 'nebulosa/src/devices/indi/simulator/mount'
import { RotatorSimulator } from 'nebulosa/src/devices/indi/simulator/rotator'
import { WheelSimulator } from 'nebulosa/src/devices/indi/simulator/wheel'
import { type DeviceEvent, DeviceRegistry } from './devices'
import { errorResponse } from './http'
import { skyStarSource } from './sky'

// Application-wide registry of open device connections (INDI, Alpaca, and the in-process simulator).
// Each endpoint is opened at most once, concurrent requests for it share the same attempt, and every
// open/close, along with the device events of every open connection, is published to the registered
// listeners.

// Backend of a connection.
export type ConnectionType = 'INDI' | 'ALPACA' | 'SIMULATOR'

// Request to open a connection to a remote INDI server or Alpaca device server.
export interface RemoteConnectRequest {
	// Backend reached over the network.
	readonly type: Exclude<ConnectionType, 'SIMULATOR'>
	// Hostname or IP address of the server, trimmed and non-empty.
	readonly host: string
	// TCP port of the server, an integer in [1, 65535].
	readonly port: number
}

// Request to open the in-process device simulator, which has no network endpoint.
export interface SimulatorConnectRequest {
	// Backend served by the application itself.
	readonly type: 'SIMULATOR'
}

// Validated request to open a connection.
export type ConnectRequest = RemoteConnectRequest | SimulatorConnectRequest

// Open connection as reported to clients.
export type ConnectionStatus = ConnectRequest & {
	// Stable identifier of the endpoint (MD5 hex of its key); the same endpoint always yields the same id.
	readonly id: string
}

// Notification published when a connection opens or closes, whoever caused it.
export type ConnectionEvent = { readonly type: 'connection:open'; readonly connection: ConnectionStatus } | { readonly type: 'connection:close'; readonly id: string }

// Event the connection registry publishes: a connection opening or closing, or an event of the devices it provides.
export type ConnectionRegistryEvent = ConnectionEvent | DeviceEvent

// Receiver of connection and device events.
export type ConnectionListener = (event: ConnectionRegistryEvent) => void

// Open connection with the client that owns its resources.
interface OpenConnection {
	// Status reported to clients.
	readonly status: ConnectionStatus
	// Client released when the connection closes.
	readonly client: Client
}

// Returns the stable id of the endpoint a request addresses. Hostnames compare case-insensitively.
export function connectionId(request: ConnectRequest): string {
	const key = request.type === 'SIMULATOR' ? request.type : `${request.type}:${request.host.toLowerCase()}:${request.port}`
	return Bun.MD5.hash(key, 'hex')
}

// Opens the client for a request, attaching it to the device registry before it delivers any property.
// Throws an Error when the endpoint cannot be reached; the handler's close callback reports later closes
// initiated by the server.
async function openClient(id: string, request: ConnectRequest, handler: IndiClientHandler, devices: DeviceRegistry): Promise<Client> {
	switch (request.type) {
		case 'INDI': {
			const client = new IndiClient({ handler })
			devices.attach(client, id)

			try {
				await client.connect(request.host, request.port)
			} catch (error) {
				client.close()
				throw new Error(`Unable to connect to INDI server at ${request.host}:${request.port}`, { cause: error })
			}

			if (!client.connected) throw new Error(`INDI server at ${request.host}:${request.port} closed the connection`)

			return client
		}
		case 'ALPACA': {
			const client = new AlpacaClient(`http://${request.host}:${request.port}`, { handler }, devices)
			devices.attach(client, id)
			let started = false

			try {
				started = await client.start()
			} catch (error) {
				client.stop()
				throw new Error(`Unable to connect to Alpaca server at ${request.host}:${request.port}`, { cause: error })
			}

			if (!started) {
				client.stop()
				throw new Error(`Alpaca server at ${request.host}:${request.port} is unreachable or has no configured devices`)
			}

			return client
		}
		case 'SIMULATOR': {
			const client = new ClientSimulator(id, handler)
			devices.attach(client, id)
			// Each simulator registers itself with the client, which disposes them all when it is disposed.
			void [
				new MountSimulator('Mount Simulator', client),
				// The camera reads the mount, focuser, filter wheel and rotator a capture snoops, and renders the stars of
				// the sky catalog around the mount, so its frames can be plate solved. The catalog goes down to
				// magnitude 8, about one star per square degree, so the optics are a 50 mm f/2 lens whose 7.6° × 6.1°
				// field holds dozens of them.
				new CameraSimulator('Camera Simulator', client, {
					mountManager: devices.mounts,
					focuserManager: devices.focusers,
					wheelManager: devices.wheels,
					rotatorManager: devices.rotators,
					guideOutputManager: devices.guideOutputs,
					catalogSources: { SKY: skyStarSource },
					catalogSource: 'SKY',
					focalLength: 50,
					aperture: 25,
				}),
				new FocuserSimulator('Focuser Simulator', client),
				new WheelSimulator('Filter Wheel Simulator', client),
				new RotatorSimulator('Rotator Simulator', client),
				new FlatPanelSimulator('Flat Panel Simulator', client),
				new CoverSimulator('Dust Cap Simulator', client),
				// The dome follows the simulated mount through the shared mount manager when slaving is on.
				new DomeSimulator('Dome Simulator', client, { mountManager: devices.mounts }),
			]
			return client
		}
	}
}

// Registry of open connections keyed by endpoint id.
export class ConnectionManager implements Disposable {
	// Open connections keyed by endpoint id.
	readonly #open = new Map<string, OpenConnection>()
	// In-flight open attempts, shared by concurrent requests for the same endpoint.
	readonly #pending = new Map<string, Promise<ConnectionStatus>>()
	// Receivers of every connection:open and connection:close event.
	readonly #listeners = new Set<ConnectionListener>()
	// Devices of every open connection, publishing their events to the same listeners.
	readonly devices = new DeviceRegistry((event) => this.#emit(event))

	// Opens the endpoint addressed by request, or returns the existing connection when it is already open
	// or opening. Publishes connection:open once per actual open. Rejects with an Error when unreachable.
	connect(request: ConnectRequest): Promise<ConnectionStatus> {
		const id = connectionId(request)
		const open = this.#open.get(id)
		if (open) return Promise.resolve(open.status)

		let pending = this.#pending.get(id)

		if (!pending) {
			pending = this.#connect(id, request).finally(() => this.#pending.delete(id))
			this.#pending.set(id, pending)
		}

		return pending
	}

	// Opens the client for request under the endpoint id, registers it as open, and publishes
	// connection:open. Rejects with the Error thrown by openClient, leaving the registry unchanged.
	async #connect(id: string, request: ConnectRequest): Promise<ConnectionStatus> {
		const handler = new IndiClientHandlerSet([this.devices.handler, { close: (client: Client) => this.#closed(id, client) }])
		const client = await openClient(id, request, handler, this.devices)
		const status: ConnectionStatus = { ...request, id }
		this.#open.set(id, { status, client })
		this.#emit({ type: 'connection:open', connection: status })
		return status
	}

	// Closes the connection with the given id for every tab. Returns false when it is not open.
	// Publishes connection:close.
	disconnect(id: string): boolean {
		const open = this.#open.get(id)
		if (!open) return false

		// Removed before disposal so the client's own close callback does not publish a second event.
		this.#open.delete(id)
		open.client[Symbol.dispose]()
		this.devices.close(open.client)
		this.#emit({ type: 'connection:close', id })

		return true
	}

	// Returns the open connections, in opening order.
	list(): ConnectionStatus[] {
		return Array.from(this.#open.values(), (open) => open.status)
	}

	// Returns the client of the open connection with the given id.
	client(id: string): Client | undefined {
		return this.#open.get(id)?.client
	}

	// Registers a listener for connection and device events. Returns a function that removes it.
	listen(listener: ConnectionListener): () => void {
		this.#listeners.add(listener)
		return () => this.#listeners.delete(listener)
	}

	// Handles a close reported by the client itself (e.g. the server dropped the socket). Ignored when the
	// connection was already removed or replaced, so each close is published once.
	#closed(id: string, client: Client) {
		if (this.#open.get(id)?.client !== client) return
		this.#open.delete(id)
		this.devices.close(client)
		this.#emit({ type: 'connection:close', id })
	}

	// Delivers event synchronously to every registered listener, in registration order.
	#emit(event: ConnectionRegistryEvent) {
		for (const listener of this.#listeners) listener(event)
	}

	// Closes every open connection.
	[Symbol.dispose]() {
		for (const id of Array.from(this.#open.keys())) this.disconnect(id)
	}
}

// Connection registry shared by the whole application.
export const connections = new ConnectionManager()

// Routes of the connections and of the devices they provide.
export function createConnectionRoutes(connections: ConnectionManager) {
	// Sends the CONNECTION switch to a device of an open connection. Responds 202 once sent (the new state arrives as a
	// device:updated event) and 404 when the connection is not open or has no such device.
	function switchDevice(id: string, deviceId: string, connect: boolean): Response {
		const client = connections.client(id)
		if (!client || !connections.devices.switch(client, deviceId, connect)) return errorResponse('Device not found', 404, 'notFound')
		return new Response(null, { status: 202 })
	}

	return {
		'/api/connections': {
			// The open connections, shared by every tab.
			GET: () => Response.json(connections.list()),
			// Opens a connection, or returns the existing one for the same endpoint. Responds 502 (unreachable) when the
			// endpoint cannot be reached.
			POST: async (req) => {
				try {
					return Response.json(await connections.connect((await req.json()) as ConnectRequest))
				} catch (error) {
					return errorResponse(Error.isError(error) ? error.message : 'Unable to connect', 502, 'unreachable')
				}
			},
		},
		'/api/connections/:id': {
			// Closes the connection for every tab; 404 when it is not open.
			DELETE: (req) => new Response(null, { status: connections.disconnect(req.params.id) ? 204 : 404 }),
		},
		'/api/connections/:id/devices': {
			// The managed devices of an open connection; 404 when it is not open.
			GET: (req) => {
				const client = connections.client(req.params.id)
				return client ? Response.json(connections.devices.list(client)) : errorResponse('Connection not found', 404, 'notFound')
			},
		},
		'/api/connections/:id/states': {
			// The control state of every managed device of an open connection, by type; 404 when it is not open.
			GET: (req) => {
				const client = connections.client(req.params.id)
				return client ? Response.json(connections.devices.states(client)) : errorResponse('Connection not found', 404, 'notFound')
			},
		},
		'/api/connections/:id/devices/:deviceId/connect': {
			POST: (req) => switchDevice(req.params.id, req.params.deviceId, true),
		},
		'/api/connections/:id/devices/:deviceId/disconnect': {
			POST: (req) => switchDevice(req.params.id, req.params.deviceId, false),
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
