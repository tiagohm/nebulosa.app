// Contracts of the sky API shared with the web client: object identity, search results, catalog details,
// and the columnar data the star map renders. Angles are radians, times Unix milliseconds (UTC), and
// distances AU unless a name says otherwise.

// Horizons command of each major solar-system body the API knows: the Sun (10), the Moon (301), the
// planets (199 to 899), and Pluto (999).
export type SolarSystemBodyCode = '10' | '301' | '199' | '299' | '499' | '599' | '699' | '799' | '899' | '999'

// Stable identity of an object, independent of where it was found and of its time-dependent position.
export type SkyObjectRef =
	// Star or deep-sky object of the sky catalog, by its catalog id.
	| { readonly kind: 'catalog'; readonly id: number }
	// Sun, Moon, planet, or Pluto.
	| { readonly kind: 'body'; readonly code: SolarSystemBodyCode }
	// Asteroid or comet of the JPL Small-Body Database, by its SPK-ID, with the designation shown for it.
	| { readonly kind: 'minorBody'; readonly spkId: string; readonly designation: string }

// Group an object belongs to in search results and in the inspector.
export type SkyObjectCategory = 'star' | 'deepSky' | 'solarSystem' | 'minorBody'

// Object matched by a search.
export interface SkySearchResult {
	// Identity of the object.
	readonly ref: SkyObjectRef
	// Display name: the proper name or the preferred designation.
	readonly name: string
	// Other designations, most relevant first.
	readonly designations: readonly string[]
	// Group of the object.
	readonly category: SkyObjectCategory
	// Object type, such as "Galaxy" or "Planet".
	readonly typeName: string
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// IAU abbreviation of the constellation the catalog position lies in; absent for moving objects.
	readonly constellation?: string
}

// Catalog data of a star or deep-sky object. Coordinates are J2000 catalog values, never positions of date.
export interface SkyCatalogObject {
	// Catalog id.
	readonly id: number
	// Group of the object.
	readonly category: 'star' | 'deepSky'
	// Stellarium object type (StellariumObjectType).
	readonly type: number
	// Object type, such as "Open Star Cluster".
	readonly typeName: string
	// Display name.
	readonly name: string
	// Every other designation, most relevant first.
	readonly designations: readonly string[]
	// Right ascension at J2000 in radians.
	readonly rightAscension: number
	// Declination at J2000 in radians.
	readonly declination: number
	// Visual magnitude; absent when unknown.
	readonly magnitude?: number
	// B-V color index in magnitudes; absent when unknown.
	readonly bv?: number
	// Proper motion dα/dt in radians per Julian year.
	readonly pmRA: number
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC: number
	// Distance in AU; absent when unknown.
	readonly distance?: number
	// Radial velocity in AU per day, positive receding.
	readonly rv: number
	// IAU abbreviation of the constellation, such as "CMa".
	readonly constellation: string
	// Full constellation name, such as "Canis Major".
	readonly constellationName: string
	// Spectral type of stars or morphological type of deep-sky objects; absent when unknown.
	readonly classification?: string
	// Apparent major axis in radians; absent when unknown.
	readonly majorAxis?: number
	// Apparent minor axis in radians; absent when unknown.
	readonly minorAxis?: number
	// Position angle of the major axis in radians, from north through east; absent when unknown.
	readonly orientation?: number
}

// Stars to render, as parallel arrays. Positions are referred to the true equator and equinox of `time`
// (precession, nutation, and proper motion applied), the frame the star map projects.
export interface SkyStarData {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Catalog id of each star.
	readonly ids: readonly number[]
	// Proper name of each star; empty when it has none.
	readonly names: readonly string[]
	// Right ascension of each star in radians.
	readonly ra: readonly number[]
	// Declination of each star in radians.
	readonly dec: readonly number[]
	// Visual magnitude of each star.
	readonly mag: readonly number[]
	// B-V color index of each star in magnitudes; 0.65 when unknown.
	readonly bv: readonly number[]
}

// Deep-sky objects to render, as parallel arrays, in the same frame as SkyStarData.
export interface SkyDeepSkyData {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Catalog id of each object.
	readonly ids: readonly number[]
	// Display name of each object.
	readonly names: readonly string[]
	// Stellarium object type of each object.
	readonly types: readonly number[]
	// Right ascension of each object in radians.
	readonly ra: readonly number[]
	// Declination of each object in radians.
	readonly dec: readonly number[]
	// Visual magnitude of each object; null when unknown.
	readonly mag: readonly (number | null)[]
	// Apparent major axis of each object in arcminutes; 0 when unknown.
	readonly size: readonly number[]
	// Name of each Stellarium object type, indexed by type.
	readonly typeNames: readonly string[]
}

// Constellation figures, boundaries, and labels. Vertices are [right ascension, declination] in
// radians, in the same frame as SkyStarData.
export interface SkyConstellations {
	// Instant the positions were computed for, Unix milliseconds (UTC).
	readonly time: number
	// Stick-figure polylines.
	readonly lines: readonly (readonly (readonly [number, number])[])[]
	// Boundary polylines.
	readonly boundaries: readonly (readonly (readonly [number, number])[])[]
	// Labels at the constellation centers.
	readonly labels: readonly { readonly name: string; readonly rightAscension: number; readonly declination: number }[]
}
