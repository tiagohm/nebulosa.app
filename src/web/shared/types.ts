import type { Camera, Connect, ConnectionStatus } from 'src/shared/types'

export type FilePickerMode = 'file' | 'directory' | 'save'

export type ImageSource = 'file' | 'framing' | 'camera'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
}

export interface Image {
	readonly key: string
	readonly position: number
	readonly path: string
	readonly source: ImageSource
	readonly camera?: Camera
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}
