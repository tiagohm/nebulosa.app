import type { SmallBodySearchListItem, SmallBodySearchObject } from 'nebulosa/src/adapters/orbits/sbd'

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
}

export const DEFAULT_MINOR_PLANET: MinorPlanet = {
	name: '',
	id: '',
	pha: false,
	neo: false,
	orbitType: '',
}
