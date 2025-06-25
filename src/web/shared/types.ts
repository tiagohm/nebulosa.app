import type { Connect, ConnectionStatus } from 'src/api/types'

export type FilePickerMode = 'file' | 'directory'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
}

export interface Image {
	readonly key: string
	readonly position: number
	path: string
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}
