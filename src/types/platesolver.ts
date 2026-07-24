import type { PlateSolveOptions } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { Angle } from 'nebulosa/src/math/units/angle'

export type PlateSolverType = 'astap' | 'astrometryNet' | 'novaAstrometryNet'

export interface PlateSolveStart extends Omit<PlateSolveOptions, 'rightAscension' | 'declination' | 'radius'> {
	id: string
	type: PlateSolverType
	executable: string
	path: string
	focalLength: number
	pixelSize: number
	fov: number
	apiUrl?: string
	apiKey?: string
	slot?: number
	blind: boolean
	rightAscension: string | Angle
	declination: string | Angle
	radius: number // deg
}

export const DEFAULT_PLATE_SOLVE_START: PlateSolveStart = {
	id: '',
	type: 'astap',
	executable: '',
	path: '',
	focalLength: 0,
	pixelSize: 0,
	fov: 0,
	blind: true,
	rightAscension: '00 00 00',
	declination: '+00 00 00',
	radius: 4,
	downsample: 0,
	timeout: 300000, // 5 minutes
	apiUrl: '',
	apiKey: '',
}
