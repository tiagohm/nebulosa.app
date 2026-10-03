import type { Client } from 'nebulosa/src/devices/indi/device'
import type { Connect, ConnectionType } from '#/connection'

// Runtime connection initialization contracts. The handler owns each prepared client, including failed attempts.

// A fresh client and its one-shot asynchronous initialization, before registration as an active connection.
export interface ConnectionStart {
	// Client owned by the handler as soon as the initializer returns; its id may become known during start.
	readonly client: Client
	// Starts transport or creates simulated devices; false means connection refusal. May throw on I/O failure.
	readonly start: () => Promise<boolean>
}

// Prepares a client for a trusted request without starting I/O or publishing device definitions.
export type ConnectionInitializer = (request: Readonly<Connect>) => ConnectionStart

// Initializers configured at startup. Absent protocols are reported as unsupported.
export type ConnectionInitializers = Readonly<Partial<Record<ConnectionType, ConnectionInitializer>>>
