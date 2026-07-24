export type StarDetectionType = 'astap' | 'nebulosa'

export interface StarDetection {
	type: StarDetectionType
	executable?: string
	path: string
	timeout: number
	minSNR: number
	maxStars: number
	slot: number
}

export const DEFAULT_STAR_DETECTION: StarDetection = {
	type: 'astap',
	path: '',
	timeout: 30000,
	minSNR: 0,
	maxStars: 0,
	slot: 0,
}
