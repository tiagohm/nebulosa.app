import { type Constellation, CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import type { ConstellationSource } from './catalog'
import type { SkyConstellation, SkySearchResult } from './types'

// Constellations as sky objects: the IAU constellation of each label of the constellation data, the
// details of a constellation, and their local search. A constellation is located by its label, a fixed
// J2000 point near its center, without proper motion, distance, or radial velocity.

// Label names of the constellation data that differ from the IAU names, by lowercase label name.
const LABEL_ALIASES: Readonly<Record<string, Constellation>> = {
	'corona austrina': 'CRA',
	'serpens caput': 'SER',
	'serpens cauda': 'SER',
}

// Constellation by lowercase IAU name.
const CONSTELLATIONS_BY_NAME = new Map<string, Constellation>(CONSTELLATION_LIST.map((c) => [CONSTELLATIONS[c].name.toLowerCase(), c]))

// Returns the constellation of a label name, such as "Canis Major" → "CMA"; undefined when unknown.
export function constellationOfLabel(name: string): Constellation | undefined {
	const key = name.toLowerCase()
	return LABEL_ALIASES[key] ?? CONSTELLATIONS_BY_NAME.get(key)
}

// Returns whether a code is an IAU constellation code, upper case.
function isConstellation(code: string): code is Constellation {
	return code in CONSTELLATIONS
}

// Returns a constellation with the J2000 position of its first label; undefined for an unknown code or a
// constellation without a label.
export function constellationDetails(source: ConstellationSource, code: string): SkyConstellation | undefined {
	if (!isConstellation(code)) return undefined

	const label = source.labels.find((e) => constellationOfLabel(e.name) === code)
	if (!label) return undefined

	const { name, iau, genitive } = CONSTELLATIONS[code]
	return { code, abbreviation: iau, name, genitive, rightAscension: label.rightAscension, declination: label.declination }
}

// Searches constellations by name, IAU abbreviation, or genitive, case-insensitively: exact abbreviations
// first, then names or genitives starting with the query, then names containing it (genitives share
// endings such as "-oris", so they only match by prefix).
export function searchConstellations(query: string): SkySearchResult[] {
	const text = query.trim().toLowerCase()
	if (text.length < 3) return []

	const rank = (c: Constellation) => {
		const { name, iau, genitive } = CONSTELLATIONS[c]
		if (iau.toLowerCase() === text) return 0
		if (name.toLowerCase().startsWith(text) || genitive.toLowerCase().startsWith(text)) return 1
		if (name.toLowerCase().includes(text)) return 2
		return -1
	}

	return CONSTELLATION_LIST.map((c) => [c, rank(c)] as const)
		.filter(([, r]) => r >= 0)
		.sort((a, b) => a[1] - b[1])
		.map(([c]) => ({ ref: { kind: 'constellation', code: c }, name: CONSTELLATIONS[c].name, designations: [CONSTELLATIONS[c].iau, CONSTELLATIONS[c].genitive], category: 'constellation', typeName: 'Constellation' }))
}
