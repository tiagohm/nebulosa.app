import { normalizeIauMeteorShowerCatalog, parseIauMeteorShowerCatalog } from 'nebulosa/src/adapters/catalogs/iau.meteor.showers'
import type { MeteorShower, MeteorShowerActivity, MeteorShowerSolution, MeteorShowerStatus } from 'nebulosa/src/astronomy/meteors/types'
import { METEOR_VISUAL_ENTRIES, type MeteorVisualEntry } from './meteorshowers.visual'

// The IAU Meteor Data Center catalog of the Meteor Showers tool as an immutable index, built once per active document: the
// showers with every published solution in source order (never merged), a stable identity, the preferred solution and why,
// what that solution leaves unknown, the curated visual entry of the shower, and the normalized text the search reads.
// Parsing and normalization are the toolkit's (iau.meteor.showers.ts); this module adds the application's policies.

// How long a shower's id lasts: iau when it comes from its IAU number, snapshot when the record has no usable number
// and is named by its position in this document, which a later document may change.
export type MeteorShowerIdentity = 'iau' | 'snapshot'

// How the preferred solution was chosen: ranked among several eligible ones, the only eligible one, or none eligible.
export type MeteorSolutionSelection = 'ranked' | 'only' | 'none'

// What the preferred solution leaves unknown, which limits what can be computed for the shower.
export type MeteorShowerGap = 'radiant' | 'activityInterval' | 'drift' | 'referenceSolarLongitude' | 'usableSolution'

// One shower of the index.
export interface MeteorShowerRecord {
	// Id of the shower: iau:<number>, or mdc:<name> for a record without a usable IAU number.
	readonly id: string
	// How long the id lasts.
	readonly identity: MeteorShowerIdentity
	// IAU number; absent when the record has none.
	readonly number?: number
	// IAU three-letter code; absent when the record has none.
	readonly code?: string
	// Name shown: the curated visual name when there is one, else the IAU name.
	readonly name: string
	// Name as the IAU catalog writes it.
	readonly iauName: string
	// Provisional name of the record; absent when it has none.
	readonly provisionalName?: string
	// Status of the shower record.
	readonly status: MeteorShowerStatus
	// Status integer as published; absent when the record has none.
	readonly sourceStatus?: number
	// Every published solution, in source order.
	readonly solutions: readonly MeteorShowerSolution[]
	// Index of the preferred solution in solutions; absent when none is eligible.
	readonly selected?: number
	// How the preferred solution was chosen.
	readonly selectedBy: MeteorSolutionSelection
	// What the preferred solution leaves unknown.
	readonly gaps: readonly MeteorShowerGap[]
	// Curated visual entry; absent when the subset does not list the shower.
	readonly visual?: MeteorVisualEntry
	// Normalized names, code and number the search reads.
	readonly searchText: readonly string[]
}

// Counts of a document.
export interface MeteorCatalogCounts {
	// Shower records.
	readonly recordCount: number
	// Solutions of all records.
	readonly solutionCount: number
}

// A parsed and indexed IAU document.
export interface MeteorCatalogIndex extends MeteorCatalogCounts {
	// Source label the document names itself with.
	readonly source: string
	// Version the document names itself with.
	readonly version: string
	// Count the document publishes for itself; absent when it does not.
	readonly publishedCount?: number
	// Showers in source order.
	readonly showers: readonly MeteorShowerRecord[]
	// Showers by id.
	readonly byId: ReadonlyMap<string, MeteorShowerRecord>
}

// Thrown when a document cannot be read as the IAU stream catalog.
export class MeteorCatalogInvalidError extends Error {}

// Visual entries by IAU number.
const VISUAL_BY_NUMBER = new Map(METEOR_VISUAL_ENTRIES.map((entry) => [entry.number, entry]))

// Parses, normalizes, checks, and indexes an IAU document's text. Throws MeteorCatalogInvalidError when it is not the
// versioned stream catalog or its published count disagrees with its records.
export function indexMeteorCatalog(text: string): MeteorCatalogIndex {
	let showers: readonly MeteorShower[]
	let source: string
	let version: string
	let publishedCount: number | undefined

	try {
		const catalog = parseIauMeteorShowerCatalog(text)
		const normalized = normalizeIauMeteorShowerCatalog(catalog)
		showers = normalized.showers
		source = normalized.metadata.source
		version = normalized.metadata.version ?? ''
		publishedCount = normalized.metadata.count
	} catch (error) {
		throw new MeteorCatalogInvalidError(error instanceof Error ? error.message : String(error), { cause: error })
	}

	if (publishedCount !== undefined && publishedCount !== showers.length) throw new MeteorCatalogInvalidError(`the catalog publishes ${publishedCount} records but holds ${showers.length}`)

	const used = new Set<string>()
	const records = showers.map((shower) => indexShower(shower, used))
	let solutionCount = 0
	for (const record of records) solutionCount += record.solutions.length
	return { source, version, publishedCount, recordCount: records.length, solutionCount, showers: records, byId: new Map(records.map((record) => [record.id, record])) }
}

// Indexes one shower, giving it an id no earlier record of the document took.
function indexShower(shower: MeteorShower, used: Set<string>): MeteorShowerRecord {
	const number = shower.number !== undefined && Number.isInteger(shower.number) && shower.number > 0 ? shower.number : undefined
	const base = number !== undefined ? `iau:${number}` : `mdc:${shower.provisionalName ?? shower.name}`
	let id = base
	for (let k = 2; used.has(id); k++) id = `${base}~${k}`
	used.add(id)

	const visual = number === undefined ? undefined : VISUAL_BY_NUMBER.get(number)
	const { selected, selectedBy } = selectSolution(shower.solutions)
	const solution = selected === undefined ? undefined : shower.solutions[selected]
	const name = visual?.name ?? shower.name
	const searchText = [name, shower.name, shower.provisionalName, shower.code, number === undefined ? undefined : String(number)].filter((text) => text !== undefined).map(normalizeSearchText)

	return {
		id,
		identity: id === `iau:${number}` ? 'iau' : 'snapshot',
		number,
		code: shower.code,
		name,
		iauName: shower.name,
		provisionalName: shower.provisionalName,
		status: shower.status,
		sourceStatus: shower.sourceStatus,
		solutions: shower.solutions,
		selected,
		selectedBy,
		gaps: gapsOf(solution),
		visual,
		searchText,
	}
}

// Chooses the preferred solution among those eligible (not removed, with a radiant), never combining fields of two:
// first an annual one, then one with an activity interval, then one with a radiant drift, then the largest sample, then
// the lowest solution id, then source order. A year-limited solution, which says when its data was observed, ranks after
// an annual one because it says nothing of the shower in other years.
export function selectSolution(solutions: readonly MeteorShowerSolution[]): { readonly selected?: number; readonly selectedBy: MeteorSolutionSelection } {
	const eligible: number[] = []
	for (let i = 0; i < solutions.length; i++) {
		const solution = solutions[i]
		if (solution.status !== 'removed' && solution.rightAscension !== undefined && solution.declination !== undefined) eligible.push(i)
	}

	if (eligible.length === 0) return { selectedBy: 'none' }
	if (eligible.length === 1) return { selected: eligible[0], selectedBy: 'only' }

	const rank = (solution: MeteorShowerSolution) => [solution.activity.kind === 'annual' ? 1 : 0, solution.activityInterval === undefined ? 0 : 1, solution.radiantDrift === undefined ? 0 : 1, solution.memberCount ?? -1] as const
	let best = eligible[0]
	for (const candidate of eligible) if (compareSolutions(solutions[candidate], solutions[best], rank) < 0) best = candidate
	return { selected: best, selectedBy: 'ranked' }
}

// Orders two solutions by rank, descending, then by solution id; 0 keeps the first in source order.
function compareSolutions(a: MeteorShowerSolution, b: MeteorShowerSolution, rank: (solution: MeteorShowerSolution) => readonly number[]): number {
	const ra = rank(a)
	const rb = rank(b)
	for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]
	if (a.solutionId !== undefined && b.solutionId !== undefined && a.solutionId !== b.solutionId) return a.solutionId < b.solutionId ? -1 : 1
	return 0
}

// What a preferred solution leaves unknown.
function gapsOf(solution: MeteorShowerSolution | undefined): readonly MeteorShowerGap[] {
	if (solution === undefined) return ['usableSolution']
	const gaps: MeteorShowerGap[] = []
	if (solution.rightAscension === undefined || solution.declination === undefined) gaps.push('radiant')
	if (solution.activityInterval === undefined) gaps.push('activityInterval')
	if (solution.radiantDrift === undefined) gaps.push('drift')
	if (solution.referenceSolarLongitude === undefined) gaps.push('referenceSolarLongitude')
	return gaps
}

// Lowercase text without diacritics or separators, so "η-Aquariids", "eta Aquariids", and "etaAquariids" compare alike.
export function normalizeSearchText(text: string): string {
	return text
		.normalize('NFD')
		.replaceAll(/\p{Mn}/gu, '')
		.toLowerCase()
		.replaceAll(/[^\p{L}\p{N}]+/gu, '')
}

// The preferred solution of a shower; absent when none is eligible.
export function preferredSolution(record: MeteorShowerRecord): MeteorShowerSolution | undefined {
	return record.selected === undefined ? undefined : record.solutions[record.selected]
}

// Kind of activity of a shower: the activity of its preferred solution, unknown without one.
export function activityKindOf(record: MeteorShowerRecord): MeteorShowerActivity['kind'] {
	return preferredSolution(record)?.activity.kind ?? 'unknown'
}

// Filter of a listing; every field narrows it and an absent one does not.
export interface MeteorShowerFilter {
	// Text matched against the names, the code, and the IAU number: an IAU number matches exactly, anything else as part of a name.
	readonly query?: string
	// Statuses kept.
	readonly status?: readonly MeteorShowerStatus[]
	// Kinds of activity of the preferred solution kept.
	readonly activity?: readonly MeteorShowerActivity['kind'][]
	// Whether to keep only the showers with curated visual data (true) or only those without (false).
	readonly visual?: boolean
	// Whether to keep only the showers whose preferred solution leaves something unknown (true) or only complete ones (false).
	readonly missing?: boolean
	// Geodetic latitude in degrees: keeps the showers whose radiant reaches minimumAltitude there.
	readonly latitude?: number
	// Geometric altitude the radiant must reach at its culmination, degrees; 0 by default.
	readonly minimumAltitude?: number
}

// Showers of the index the filter keeps, in source order. The latitude test uses the preferred radiant without drift, so
// a radiant that drifts across the threshold over its activity is judged by its catalog position.
export function filterMeteorShowers(index: MeteorCatalogIndex, filter: MeteorShowerFilter): readonly MeteorShowerRecord[] {
	const query = filter.query?.trim()
	const number = query !== undefined && /^\d+$/.test(query) ? Number(query) : undefined
	const text = query === undefined || number !== undefined ? undefined : normalizeSearchText(query)
	const status = filter.status === undefined ? undefined : new Set(filter.status)
	const activity = filter.activity === undefined ? undefined : new Set(filter.activity)
	const minimumAltitude = filter.minimumAltitude ?? 0

	return index.showers.filter((record) => {
		if (number !== undefined && record.number !== number) return false
		if (text !== undefined && text !== '' && !record.searchText.some((candidate) => candidate.includes(text))) return false
		if (status !== undefined && !status.has(record.status)) return false
		if (activity !== undefined && !activity.has(activityKindOf(record))) return false
		if (filter.visual !== undefined && (record.visual !== undefined) !== filter.visual) return false
		if (filter.missing !== undefined && record.gaps.length > 0 !== filter.missing) return false
		if (filter.latitude !== undefined) {
			const solution = preferredSolution(record)
			if (solution?.declination === undefined) return false
			const culmination = 90 - Math.abs(filter.latitude - (solution.declination * 180) / Math.PI)
			if (culmination < minimumAltitude) return false
		}
		return true
	})
}
