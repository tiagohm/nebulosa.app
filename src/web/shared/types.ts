import { type Connect, type ConnectionStatus, DEFAULT_IMAGE_ADJUSTMENT, DEFAULT_IMAGE_SCNR, DEFAULT_IMAGE_STRETCH, type ImageTransformation } from 'src/api/types'

export interface Connection extends Connect {
	id: string
	name: string
	connectedAt?: number
	status?: ConnectionStatus
}

export interface Image {
	readonly key: string
	readonly index: number
	readonly path: string
	readonly transformation: ImageTransformation & {
		crosshair: boolean
		rotation: number
	}
}

export const DEFAULT_CONNECTION: Connection = {
	id: '0',
	name: 'Local',
	host: 'localhost',
	port: 7624,
	type: 'INDI',
}

export const DEFAULT_IMAGE_TRANSFORMATION: Image['transformation'] = {
	stretch: structuredClone(DEFAULT_IMAGE_STRETCH),
	debayer: true,
	horizontalMirror: false,
	verticalMirror: false,
	invert: false,
	scnr: structuredClone(DEFAULT_IMAGE_SCNR),
	useJPEG: true,
	adjustment: structuredClone(DEFAULT_IMAGE_ADJUSTMENT),
	crosshair: false,
	rotation: 0,
}
