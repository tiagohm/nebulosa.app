import type { SmallBodySearchListItem, SmallBodySearchObject } from 'nebulosa/src/adapters/orbits/sbd'
import type { Angle } from 'nebulosa/src/math/units/angle'
import type { Distance } from 'nebulosa/src/math/units/distance'

// Osculating elements for a minor body or comet, in the same units as Horizons
// ObserverWithOsculatingElements: angles radians, distances AU, epoch JD TDB.
export interface OsculatingElementsInput {
	// Osculation epoch, Julian Date TDB.
	readonly epoch: number
	// Reference ecliptic/equinox of the elements. Default J2000; B1950 is Horizons-only.
	readonly referenceEclipticFrame?: 'J2000' | 'B1950'
	// Eccentricity, dimensionless.
	readonly ec: number
	// Anomaly/size: perihelion + time, mean anomaly + semi-major axis, or mean anomaly + mean motion.
	readonly tpqr: { readonly qr: Distance; readonly tp: number } | { readonly ma: Angle; readonly a: Distance } | { readonly ma: Angle; readonly n: Angle }
	// Longitude of the ascending node, radians.
	readonly om: Angle
	// Argument of perihelion, radians.
	readonly w: Angle
	// Inclination, radians.
	readonly i: Angle
	// Asteroid absolute magnitude H.
	readonly h?: number
	// Asteroid slope parameter G.
	readonly g?: number
	// Comet total-magnitude parameter m1.
	readonly m1?: number
	// Comet nuclear-magnitude parameter m2.
	readonly m2?: number
	// Comet activity coefficient k1.
	readonly k1?: number
	// Comet nuclear activity coefficient k2.
	readonly k2?: number
	// Phase coefficient; Horizons-only.
	readonly phcof?: number
	// Non-gravitational radial acceleration, AU/d²; Horizons-only.
	readonly a1?: number
	// Non-gravitational transverse acceleration, AU/d²; Horizons-only.
	readonly a2?: number
	// Non-gravitational normal acceleration, AU/d²; Horizons-only.
	readonly a3?: number
	// Non-gravitational normalizing distance; Horizons-only.
	readonly r0?: number
	// Non-gravitational aln; Horizons-only.
	readonly aln?: number
	// Non-gravitational nm; Horizons-only.
	readonly nm?: number
	// Non-gravitational nn; Horizons-only.
	readonly nn?: number
	// Non-gravitational nk; Horizons-only.
	readonly nk?: number
	// Non-gravitational dt; Horizons-only.
	readonly dt?: number
	// Area-to-mass ratio; Horizons-only.
	readonly amrat?: number
}

export interface SearchMinorPlanet {
	readonly text: string
}

export interface MinorPlanetParameter {
	readonly name: string
	readonly description: string
	readonly value: string
}

export interface FindCloseApproaches {
	readonly days: number
	readonly distance: number // LD
}

export interface CloseApproach {
	readonly name: string
	readonly distance: number // LD
	readonly date: number // ms
}

export interface MinorPlanet {
	readonly name: string
	readonly id: string
	readonly kind?: SmallBodySearchObject['kind']
	readonly pha: boolean
	readonly neo: boolean
	readonly orbitType: string
	readonly parameters?: MinorPlanetParameter[]
	readonly list?: SmallBodySearchListItem[]
	// Numeric osculating elements parsed from SBDB, when a single body was matched.
	readonly elements?: OsculatingElementsInput
}

export const DEFAULT_MINOR_PLANET: MinorPlanet = {
	name: '',
	id: '',
	pha: false,
	neo: false,
	orbitType: '',
}
