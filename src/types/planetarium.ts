import type { StellariumObjectType } from 'nebulosa/src/catalogs/stars/stellarium'

export interface PlanetariumSearch {
	readonly types: readonly StellariumObjectType[]
	readonly magnitudeLimit: number
}
