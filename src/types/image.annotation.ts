import type { PlateSolution } from 'nebulosa/src/astrometry/solvers/platesolver'
import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'
import type { Point } from 'nebulosa/src/math/numerical/geometry'
import type { SkyObject } from '#/galaxy'

export type ImageAnnotation = readonly AnnotatedSkyObject[]

export interface AnnotateImage {
	readonly solution: PlateSolution
	readonly stars: boolean
	readonly dsos: boolean
	readonly useSimbad: boolean
	readonly minorPlanets: boolean
	readonly minorPlanetsMagnitudeLimit: number
	readonly includeMinorPlanetsWithoutMagnitude: boolean
}

export interface AnnotatedSkyObject extends Required<Omit<SkyObject, 'type' | 'spmType'>>, Readonly<Point> {
	readonly type: StellariumObjectType | 'asteroid'
}
