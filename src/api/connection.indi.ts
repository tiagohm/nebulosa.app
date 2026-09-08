import { IndiClient } from 'nebulosa/src/devices/indi/client'
import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import type { Connect } from '#/connection'
import type { ConnectionStart } from './connection.start'

// Prepares INDI TCP connections; the connection handler owns transport disposal on failure and disconnect.

// Creates a client forwarding events to handler; start connects to request.host and request.port (TCP port).
export function startIndiConnection(request: Readonly<Connect>, handler: IndiClientHandler): ConnectionStart {
	const client = new IndiClient({ handler })
	return { client, start: () => client.connect(request.host, request.port) }
}
