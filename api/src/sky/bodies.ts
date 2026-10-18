import type { SkySearchResult, SolarSystemBodyCode } from './types'

// Major solar-system bodies known to the sky API, by Horizons command, and their local search. Their
// positions come from ./ephemeris; this module only names them.

// Kind of a solar-system body, which selects its map symbol.
export type SolarSystemBodyKind = 'sun' | 'moon' | 'mercury' | 'venus' | 'mars' | 'jupiter' | 'saturn' | 'uranus' | 'neptune' | 'pluto'

// A major solar-system body.
export interface SolarSystemBody {
	// Horizons command.
	readonly code: SolarSystemBodyCode
	// Kind of the body.
	readonly kind: SolarSystemBodyKind
	// Display name.
	readonly name: string
	// Object type shown with the name.
	readonly typeName: string
}

// Every major body, in the order they are listed in search results.
export const SOLAR_SYSTEM_BODIES: readonly SolarSystemBody[] = [
	{ code: '10', kind: 'sun', name: 'Sun', typeName: 'Star' },
	{ code: '301', kind: 'moon', name: 'Moon', typeName: 'Natural Satellite' },
	{ code: '199', kind: 'mercury', name: 'Mercury', typeName: 'Planet' },
	{ code: '299', kind: 'venus', name: 'Venus', typeName: 'Planet' },
	{ code: '499', kind: 'mars', name: 'Mars', typeName: 'Planet' },
	{ code: '599', kind: 'jupiter', name: 'Jupiter', typeName: 'Planet' },
	{ code: '699', kind: 'saturn', name: 'Saturn', typeName: 'Planet' },
	{ code: '799', kind: 'uranus', name: 'Uranus', typeName: 'Planet' },
	{ code: '899', kind: 'neptune', name: 'Neptune', typeName: 'Planet' },
	{ code: '999', kind: 'pluto', name: 'Pluto', typeName: 'Dwarf Planet' },
]

// Returns the body of a Horizons command; undefined for an unknown code.
export function solarSystemBody(code: string): SolarSystemBody | undefined {
	return SOLAR_SYSTEM_BODIES.find((e) => e.code === code)
}

// Returns the bodies whose name contains the query, case-insensitively, names starting with it first.
export function searchSolarSystem(query: string): SkySearchResult[] {
	const text = query.trim().toLowerCase()
	if (!text) return []

	const matches = SOLAR_SYSTEM_BODIES.filter((e) => e.name.toLowerCase().includes(text))
	matches.sort((a, b) => +!a.name.toLowerCase().startsWith(text) - +!b.name.toLowerCase().startsWith(text))

	return matches.map((e) => ({ ref: { kind: 'body', code: e.code }, name: e.name, designations: [], category: 'solarSystem', typeName: e.typeName }))
}
