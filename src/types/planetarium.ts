import type { StellariumObjectType } from 'nebulosa/src/devices/protocols/stellarium'

export interface PlanetariumSearch {
	readonly types: readonly StellariumObjectType[]
	readonly magnitudeLimit: number
}
