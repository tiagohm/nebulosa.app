import type { SatelliteObjectType, SatelliteSearchPage, SkyObjectRef, SkySearchResult } from 'api'
import { type ApiFetch, browserFetch, fetchJson } from '../http'
import { addSkyFavorite, type ProfileState, removeSkyFavorite, satelliteFavorites, setSatelliteFavorite, skyFavorites } from '../profile/profile'
import type { ProfileSettings, SkyFavorite } from '../profile/schema'
import { refKey, type SkySelectionRef } from './objects'
import type { SkySelection } from './sky'

// Favorites of the Sky: whether an object is one, marking and unmarking it, the entry the Object Inspector marks for its
// selection, and the listing the search filters. Artificial satellites are favorites by their NORAD id, the same list
// as the Artificial Satellites tool (ProfileSettings.satelliteFavorites), whose names are asked from the satellite
// catalog; every other object is kept as it was listed when marked (ProfileSettings.skyFavorites), so it is listed and
// filtered without asking the server. The mount marker is never a favorite.

// Most favorite satellites asked for in one listing, the satellite catalog's page limit (SATELLITE_SEARCH_LIMIT).
export const FAVORITE_SATELLITES_LIMIT = 100

// Object type of a satellite as the Sky search names it (satelliteSkyAdapter of api/src/satellites.ts).
const SATELLITE_TYPE_NAMES: Readonly<Record<SatelliteObjectType, string>> = { payload: 'Payload', rocketBody: 'Rocket body', debris: 'Debris', unknown: 'Artificial satellite' }

// Browser services the favorites use, replaced in tests.
export interface SkyFavoritesIo {
	// Performs HTTP requests to the API.
	readonly fetch: ApiFetch
}

// Browser implementation of SkyFavoritesIo.
const browserIo: SkyFavoritesIo = { fetch: browserFetch }

// Returns the object type of a major solar-system body by its Horizons code: the Sun, the Moon, Pluto, or a planet.
export function bodyTypeName(code: string) {
	return code === '10' ? 'Star' : code === '301' ? 'Natural Satellite' : code === '999' ? 'Dwarf Planet' : 'Planet'
}

// Whether an object is a favorite of the profile: a satellite by its NORAD id, any other object by its reference; never
// the mount.
export function isSkyFavorite(settings: Pick<ProfileSettings, 'satelliteFavorites' | 'skyFavorites'>, ref: SkySelectionRef) {
	if (ref.kind === 'mount') return false
	if (ref.kind === 'satellite') return satelliteFavorites(settings).includes(ref.noradId)
	const key = refKey(ref)
	return skyFavorites(settings).some((favorite) => refKey(favorite.ref) === key)
}

// Returns the favorite kept for a listed object other than a satellite: the result without the magnitude of a moving
// object, which changes.
export function favoriteOf(result: SkySearchResult & { readonly ref: SkyFavorite['ref'] }): SkyFavorite {
	const fixed = result.category === 'star' || result.category === 'deepSky'
	const favorite: SkyFavorite = { ref: result.ref, name: result.name, designations: result.designations, category: result.category, typeName: result.typeName }
	return { ...favorite, ...(fixed && result.magnitude !== undefined && { magnitude: result.magnitude }), ...(result.constellation && { constellation: result.constellation }) }
}

// Marks a listed object as a favorite of the active profile: a satellite in the satellite favorites, any other object
// in the Sky favorites.
export function addSkyObjectFavorite(state: ProfileState, result: SkySearchResult) {
	const { ref } = result
	if (ref.kind === 'satellite') setSatelliteFavorite(state, ref.noradId, true)
	else addSkyFavorite(state, favoriteOf({ ...result, ref }))
}

// Unmarks an object as a favorite of the active profile by its reference, whether it was listed or not.
export function removeSkyObjectFavorite(state: ProfileState, ref: SkyObjectRef) {
	if (ref.kind === 'satellite') setSatelliteFavorite(state, ref.noradId, false)
	else removeSkyFavorite(state, ref)
}

// Marks (true) or unmarks (false) a listed object as a favorite of the active profile.
export function setSkyObjectFavorite(state: ProfileState, result: SkySearchResult, marked: boolean) {
	if (marked) addSkyObjectFavorite(state, result)
	else removeSkyObjectFavorite(state, result.ref)
}

// Returns the entry the Object Inspector marks for a selection, as the search would list it; undefined for the mount,
// and for a catalog object until its catalog data arrives, as its type is not known before.
export function selectionResult(selection: Pick<SkySelection, 'ref' | 'name' | 'catalog' | 'minorBody' | 'constellation'>): SkySearchResult | undefined {
	const { ref, name } = selection

	switch (ref.kind) {
		case 'mount':
			return undefined
		case 'catalog': {
			const { catalog } = selection
			return catalog && { ref, name: catalog.name || name, designations: catalog.designations, category: catalog.category, typeName: catalog.typeName, magnitude: catalog.magnitude, constellation: catalog.constellation }
		}
		case 'body':
			return { ref, name, designations: [], category: 'solarSystem', typeName: bodyTypeName(ref.code) }
		case 'minorBody': {
			const { minorBody } = selection
			return { ref, name: minorBody?.name ?? name, designations: [], category: 'minorBody', typeName: minorBody ? (minorBody.kind === 'comet' ? 'Comet' : 'Asteroid') : 'Minor Body' }
		}
		case 'constellation': {
			const { constellation } = selection
			return { ref, name: constellation?.name ?? name, designations: constellation ? [constellation.abbreviation, constellation.genitive] : [], category: 'constellation', typeName: 'Constellation' }
		}
		case 'satellite':
			return { ref, name, designations: [`NORAD ${ref.noradId}`], category: 'satellite', typeName: SATELLITE_TYPE_NAMES.unknown }
		case 'meteorShower':
			return { ref, name, designations: [], category: 'meteorShower', typeName: 'Meteor shower radiant' }
	}
}

// Returns text in the form favorites are matched in: decomposed, without combining marks or spaces, in lower case, so
// "m42" matches "M 42" and "Proxima" matches "Próxima".
function matchText(text: string) {
	return text
		.normalize('NFD')
		.replaceAll(/[\p{M}\s]/gu, '')
		.toLowerCase()
}

// Returns the favorites whose name, designations, or type contain the text; every one for an empty text. The order is
// kept.
export function filterFavorites<T extends Pick<SkySearchResult, 'name' | 'designations' | 'typeName'>>(favorites: readonly T[], text: string): T[] {
	const query = matchText(text)
	if (!query) return [...favorites]
	return favorites.filter((favorite) => [favorite.name, favorite.typeName, ...favorite.designations].some((value) => matchText(value).includes(query)))
}

// Lists the favorite satellites by their NORAD ids whose name or designation matches the text (every one for an empty
// text), at most FAVORITE_SATELLITES_LIMIT, as the Sky search lists satellites, with how many match in all. Asks nothing
// without ids.
export async function searchFavoriteSatellites(ids: readonly string[], text: string, signal: AbortSignal, io: SkyFavoritesIo = browserIo): Promise<{ readonly results: SkySearchResult[]; readonly total: number }> {
	if (ids.length === 0) return { results: [], total: 0 }

	const params = new URLSearchParams({ ids: ids.join(','), limit: `${FAVORITE_SATELLITES_LIMIT}` })
	if (text.trim()) params.set('q', text.trim())
	const page = await fetchJson<SatelliteSearchPage>(io, `/api/satellites?${params}`, { signal })

	const results = page.items.map((item): SkySearchResult => ({
		ref: { kind: 'satellite', noradId: item.noradId } satisfies SkyObjectRef,
		name: item.name,
		designations: item.cosparId ? [`NORAD ${item.noradId}`, item.cosparId] : [`NORAD ${item.noradId}`],
		category: 'satellite',
		typeName: SATELLITE_TYPE_NAMES[item.objectType ?? 'unknown'],
	}))

	return { results, total: page.total }
}
