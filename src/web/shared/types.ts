import { type Connect, type ConnectionStatus, DEFAULT_IMAGE_ADJUSTMENT, DEFAULT_IMAGE_SCNR, DEFAULT_IMAGE_STRETCH, type ImageTransformation } from 'src/api/types'

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
