import type { Connect, ConnectionStatus } from 'src/api/types'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}
