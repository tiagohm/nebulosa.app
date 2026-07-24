import type { ClientInfo, ClientType } from 'nebulosa/src/devices/indi/device'

export type ConnectionType = ClientType

export interface HostAndPort {
	host: string
	port: number
}

export interface ConnectionStatus extends ClientInfo, HostAndPort {
	readonly ip: string
}

export interface Connect extends HostAndPort {
	type: ConnectionType
	secured: boolean
}

export interface ConnectionEvent {
	readonly status: ConnectionStatus
	readonly reused?: boolean
}

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
	secured: false,
}

export const DEFAULT_CONNECTION_PORTS = {
	INDI: 7624,
	ALPACA: 32323,
	SIMULATOR: 0,
	FIRMATA: 27016,
} as const satisfies Record<ConnectionType, number>

export function isNetworkConnection(type: ConnectionType) {
	return type !== 'SIMULATOR'
}

export function canConnect({ type, port, host }: Omit<Connect, 'secured'>) {
	if (!isNetworkConnection(type)) return true
	if (!Number.isInteger(port) || port < 1 || port > 65535) return false
	return host.trim().length > 0
}

export function connectionComparator(a: Connection, b: Connection) {
	return (b.connectedAt ?? 0) - (a.connectedAt ?? 0)
}
