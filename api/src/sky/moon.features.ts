// Contract of the lunar surface feature catalog of the Moon Inspector's Lunar Surface Explorer: the
// officially named features of the Moon as the USGS Gazetteer of Planetary Nomenclature (with the IAU)
// publishes them, normalized by bin/src/moon.assets.ts into web/assets/moon/moon.features.json. Positions
// are the Gazetteer's center points, planetocentric on the IAU Moon sphere (radius 1737.4 km), latitude
// north positive and longitude east positive in [-180, 180) degrees; they are markers, never outlines.
// The generator and the web client share these types; the web imports them as types only, so everything
// the browser needs per feature (its category and flags) is written into the catalog itself.

// Version of the catalog layout; the generator writes it and a reader of another version rejects the file.
export const MOON_FEATURE_CATALOG_SCHEMA = 1

// Category of a feature in the explorer's filters: craters (with satellite craters), maria and other
// plains (mare, oceanus, lacus, sinus, palus, planitia), mountains and capes, rilles and valleys, and
// everything else (ridges, scarps, crater chains, landing-site names, stations, albedo features).
export type LunarFeatureCategory = 'crater' | 'mare' | 'mons' | 'rima' | 'other'

// Category of each official Gazetteer descriptor of the Moon; a descriptor missing here fails the
// generator, so a new one is classified on purpose.
export const LUNAR_FEATURE_DESCRIPTOR_CATEGORIES: Readonly<Record<string, LunarFeatureCategory>> = {
	'Crater, craters': 'crater',
	'Satellite Feature': 'crater',
	'Mare, maria': 'mare',
	'Oceanus, oceani': 'mare',
	'Lacus, lacūs': 'mare',
	'Sinus, sinūs': 'mare',
	'Palus, paludes': 'mare',
	'Planitia, planitiae': 'mare',
	'Mons, montes': 'mons',
	'Promontorium, promontoria': 'mons',
	'Rima, rimae': 'rima',
	'Vallis, valles': 'rima',
	'Dorsum, dorsa': 'other',
	'Rupes, rupēs': 'other',
	'Catena, catenae': 'other',
	'Astronaut-named features': 'other',
	Statio: 'other',
	'Albedo Feature': 'other',
}

// Descriptor of a satellite crater, named after a nearby main feature with a capital letter ("Copernicus A").
export const LUNAR_SATELLITE_DESCRIPTOR = 'Satellite Feature'

// Descriptors whose Gazetteer dimension is the longest extent of an elongated or irregular feature, not a
// crater-like diameter.
export const LUNAR_ELONGATED_DESCRIPTORS: ReadonlySet<string> = new Set(['Mare, maria', 'Oceanus, oceani', 'Lacus, lacūs', 'Sinus, sinūs', 'Palus, paludes', 'Planitia, planitiae', 'Mons, montes', 'Rima, rimae', 'Vallis, valles', 'Dorsum, dorsa', 'Rupes, rupēs', 'Catena, catenae'])

// Flag of a satellite crater in LunarFeatureRow.
export const LUNAR_FEATURE_SATELLITE = 1

// Flag of a feature whose dimension is its longest extent in LunarFeatureRow.
export const LUNAR_FEATURE_ELONGATED = 2

// One feature, as a compact row: Gazetteer feature id (its page is
// https://planetarynames.wr.usgs.gov/Feature/<id>), official name with its diacritics, official descriptor,
// category, flags (LUNAR_FEATURE_SATELLITE | LUNAR_FEATURE_ELONGATED), latitude and east longitude in
// degrees, approximate diameter or longest extent in km (null when unknown), year of IAU approval (null
// when unknown), and the origin of the name (null when none is given). Nulls keep the JSON rows positional.
export type LunarFeatureRow = readonly [id: number, name: string, descriptor: string, category: LunarFeatureCategory, flags: number, latitude: number, longitude: number, dimension: number | null, approvalYear: number | null, origin: string | null]

// Where the catalog comes from.
export interface MoonFeatureCatalogSource {
	// Dataset name, as the Gazetteer publishes it.
	readonly name: string
	// URL the archive was downloaded from.
	readonly url: string
	// SHA-256 of the downloaded archive, hexadecimal.
	readonly sha256: string
	// When the archive was downloaded, ISO 8601.
	readonly acquiredAt: string
	// Credit the explorer shows.
	readonly credit: string
}

// Lunar surface feature catalog file.
export interface MoonFeatureCatalog {
	// Layout version, MOON_FEATURE_CATALOG_SCHEMA.
	readonly schema: number
	// When the file was generated, ISO 8601.
	readonly generatedAt: string
	// Source of the features; absent for the empty catalog of `bun make:moon --empty`.
	readonly source?: MoonFeatureCatalogSource
	// Every IAU-adopted feature, sorted by id.
	readonly features: readonly LunarFeatureRow[]
}
