import { type AlpacaDeviceServer, AlpacaDiscoveryClient } from 'nebulosa/src/devices/alpaca/discovery'
import type { AlpacaDeviceType } from 'nebulosa/src/devices/alpaca/types'
import { errorResponse } from './http'

// Discovery of the Alpaca servers on the network of the Nebulosa server: one IPv4 broadcast probe per request, the
// servers that answered within a short listen window, and their identity and devices read from their management API.
// Nothing is kept between requests; the operator saves a server found here as a connection.

// Listen window of one discovery, in milliseconds: servers of a local network answer within a fraction of a second, and
// the operator waits on it.
const DISCOVERY_WINDOW = 3000

// Device configured on a discovered Alpaca server.
export interface DiscoveredAlpacaDevice {
	// Name the server gives the device.
	readonly name: string
	// Alpaca device type, lowercase.
	readonly type: AlpacaDeviceType
}

// Alpaca server that answered a discovery probe.
export interface DiscoveredAlpacaServer {
	// IPv4 address the server answered from, as the Nebulosa server reaches it.
	readonly host: string
	// TCP port of its Alpaca API, in [1, 65535].
	readonly port: number
	// Name the server declares; undefined when it did not answer its description.
	readonly name?: string
	// Manufacturer the server declares; undefined when it did not answer its description.
	readonly manufacturer?: string
	// Configured devices; empty when the server did not list them.
	readonly devices: readonly DiscoveredAlpacaDevice[]
}

// Options of a discovery.
export interface AlpacaDiscoveryRequestOptions {
	// Ends the discovery early, answering with the servers found so far.
	readonly signal?: AbortSignal
	// Listen window, in milliseconds.
	readonly timeout?: number
	// UDP port the probe is sent to; the standard Alpaca discovery port when absent.
	readonly port?: number
}

// Whether an IPv4 address is a loopback address, which only the Nebulosa server's own machine can use.
function isLoopback(host: string) {
	return host.startsWith('127.')
}

// Returns the key that identifies a server across the answers of several interfaces: its port and the unique ids of its
// devices, or its address and port when it listed none.
function serverKey({ address, port, devices }: AlpacaDeviceServer) {
	if (devices.length === 0) return `${address}:${port}`
	return `${port}:${devices
		.map((d) => d.UniqueID)
		.sort()
		.join(',')}`
}

// Broadcasts an Alpaca discovery probe from the Nebulosa server and returns the servers that answered within the window,
// one per server even when it answered on several interfaces (under its non-loopback address when it has one), the named
// ones first by name, then by address. Resolves with what was found when the signal aborts.
export async function discoverAlpacaServers({ signal, timeout = DISCOVERY_WINDOW, port }: AlpacaDiscoveryRequestOptions = {}): Promise<DiscoveredAlpacaServer[]> {
	const found = new Map<string, DiscoveredAlpacaServer>()

	// Records an answer, replacing one of the same server only when that one came from a loopback address.
	function add(server: AlpacaDeviceServer) {
		const key = serverKey(server)
		const known = found.get(key)
		if (known && !isLoopback(known.host)) return

		const devices = server.devices.map((d) => ({ name: d.DeviceName, type: d.DeviceType }))
		found.set(key, { host: server.address, port: server.port, name: server.description?.ServerName || undefined, manufacturer: server.description?.Manufacturer || undefined, devices })
	}

	using client = new AlpacaDiscoveryClient()
	// Closes the listen window early.
	const abort = () => client.close()
	signal?.addEventListener('abort', abort, { once: true })

	try {
		if (!signal?.aborted) await client.discovery(add, { family: 'IPv4', port, timeout, wait: true, fetch: true })
	} finally {
		signal?.removeEventListener('abort', abort)
	}

	return Array.from(found.values()).sort((a, b) => Number(a.name === undefined) - Number(b.name === undefined) || (a.name ?? '').localeCompare(b.name ?? '') || a.host.localeCompare(b.host, undefined, { numeric: true }) || a.port - b.port)
}

// Route of the discovery of Alpaca servers.
export function createAlpacaDiscoveryRoutes() {
	return {
		'/api/connections/alpaca/discover': {
			// Probes the network of the Nebulosa server and answers the servers found (DiscoveredAlpacaServer[]) once the
			// listen window closes; 500 (discoveryFailed) when the probe cannot be sent.
			GET: async (req) => {
				try {
					return Response.json(await discoverAlpacaServers({ signal: req.signal }))
				} catch (error) {
					return errorResponse(Error.isError(error) ? error.message : 'Unable to search the network', 500, 'discoveryFailed')
				}
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
