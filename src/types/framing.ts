import type { Hips2FitsOptions } from 'nebulosa/src/adapters/sky/hips2fits'
import type { Size } from 'recharts/types/util/types'

export interface Framing extends Size, Omit<Hips2FitsOptions, 'fov' | 'width' | 'height'> {
	id: string
	hipsSurvey: string
	fov?: number // deg
	focalLength: number // mm
	pixelSize: number // µm
	rotation: number // deg
	rightAscension: string
	declination: string
}

export const DEFAULT_FRAMING: Framing = {
	id: '0',
	hipsSurvey: 'CDS/P/DSS2/color',
	rightAscension: '00 00 00.00',
	declination: '+00 00 00.00',
	width: 800,
	height: 600,
	fov: 1,
	focalLength: 500,
	pixelSize: 3.5,
	rotation: 0,
}
