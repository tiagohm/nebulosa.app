import { AlpacaClient } from 'nebulosa/src/devices/alpaca/client'
import type { IndiClientHandler } from 'nebulosa/src/devices/indi/client'
import type { Device } from 'nebulosa/src/devices/indi/device'
import type { DeviceProvider } from 'nebulosa/src/devices/indi/manager/device'
import type { Connect } from '#/connection'
import type { ConnectionStart } from './connection.start'

// Prepares ALPACA discovery and polling; transport lifetime belongs to the connection handler.

// Creates a client for the request's HTTP(S) endpoint using handler for device events and device lookup.
// start discovers devices and enables polling; the owner must dispose the client even when start fails.
export function startAlpacaConnection(request: Readonly<Connect>, handler: IndiClientHandler & DeviceProvider<Device>): ConnectionStart {
	const client = new AlpacaClient(`http${request.secured ? 's' : ''}://${request.host}:${request.port}`, { handler }, handler)
	return { client, start: () => client.start() }
}
