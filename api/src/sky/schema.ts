import type { Database } from 'bun:sqlite'

// Schema of the sky catalog database (`api/data/sky.catalog.db`), shared by the generator in `bin` and
// the API that reads it. Objects are stars and deep-sky objects at J2000; names are their designations
// in every catalog they belong to, keyed by the catalog codes of ./designations.

// Version of the schema written by createSkyCatalogSchema; the API refuses a database of another one.
// Increment it whenever a table, column, or unit changes.
export const SKY_CATALOG_SCHEMA_VERSION = 2

// Keys of the meta table.
export type SkyCatalogMetaKey = 'schemaVersion' | 'generatedAt' | 'sources'

// One row of the objects table. Angles are radians, J2000.
export interface SkyCatalogObjectRow {
	// Object id: the HYG id for stars (below 1 000 000), 1 000 000 + the Stellarium id for deep-sky
	// objects, and 100 000 000 + the SIMBAD oid for star clusters only found in SIMBAD.
	readonly id: number
	// Stellarium object type (StellariumObjectType); STAR for HYG stars.
	readonly type: number
	// Right ascension at J2000 in radians, [0, 2π).
	readonly rightAscension: number
	// Declination at J2000 in radians, [-π/2, π/2].
	readonly declination: number
	// Visual magnitude; null when unknown, and for dark nebulae, whose catalog value is an opacity.
	readonly magnitude: number | null
	// B-V color index in magnitudes; null when unknown (always for deep-sky objects).
	readonly bv: number | null
	// Proper motion in right ascension, dα/dt, in radians per Julian year.
	readonly pmRA: number
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC: number
	// Distance in AU; null when unknown.
	readonly distance: number | null
	// Radial velocity in AU per day, positive receding.
	readonly rv: number
	// Index into CONSTELLATION_LIST of the constellation the object lies in.
	readonly constellation: number
	// Spectral type of stars or morphological type of deep-sky objects; null when unknown.
	readonly classification: string | null
	// Apparent major axis in radians; null when unknown.
	readonly majorAxis: number | null
	// Apparent minor axis in radians; null when unknown.
	readonly minorAxis: number | null
	// Position angle of the major axis in radians, from north through east; null when unknown.
	readonly orientation: number | null
}

// One row of the names table.
export interface SkyCatalogNameRow {
	// Id of the named object.
	readonly objectId: number
	// Catalog code of the designation (CATALOG in ./designations).
	readonly type: number
	// Designation inside the catalog without its prefix, such as "31" for M 31 or "Alp" for α CMa;
	// compared case-insensitively.
	readonly name: string
	// Order of the designation among the object's designations of the same catalog in the source, 0 for
	// the primary one; proper names are listed by popularity in Stellarium, so rank 0 is the common name.
	readonly rank: number
}

// SQL statements that create the tables and indexes. names_type_name serves exact designation lookups
// and name prefix searches (LIKE on a NOCASE column); objects_type_magnitude serves the render queries.
const SCHEMA = [
	'CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID',
	'CREATE TABLE objects (id INTEGER PRIMARY KEY, type INTEGER NOT NULL, rightAscension REAL NOT NULL, declination REAL NOT NULL, magnitude REAL, bv REAL, pmRA REAL NOT NULL DEFAULT 0, pmDEC REAL NOT NULL DEFAULT 0, distance REAL, rv REAL NOT NULL DEFAULT 0, constellation INTEGER NOT NULL, classification TEXT, majorAxis REAL, minorAxis REAL, orientation REAL)',
	'CREATE TABLE names (objectId INTEGER NOT NULL REFERENCES objects(id), type INTEGER NOT NULL, name TEXT NOT NULL COLLATE NOCASE, rank INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (objectId, type, name)) WITHOUT ROWID',
	'CREATE INDEX names_type_name ON names(type, name)',
	'CREATE INDEX objects_type_magnitude ON objects(type, magnitude)',
] as const

// Creates the tables and indexes in an empty database and records the schema version.
export function createSkyCatalogSchema(db: Database) {
	for (const statement of SCHEMA) db.run(statement)
	writeSkyCatalogMeta(db, 'schemaVersion', SKY_CATALOG_SCHEMA_VERSION.toFixed(0))
}

// Writes one meta entry, replacing the previous value.
export function writeSkyCatalogMeta(db: Database, key: SkyCatalogMetaKey, value: string) {
	db.run('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value])
}

// Reads one meta entry; undefined when absent.
export function readSkyCatalogMeta(db: Database, key: SkyCatalogMetaKey): string | undefined {
	return db.query<{ value: string }, [string]>('SELECT value FROM meta WHERE key = ?').get(key)?.value
}

// Throws when the database was not written with the current schema version, which means it must be
// regenerated with `bun make:catalog --force`.
export function assertSkyCatalogSchema(db: Database) {
	let version: string | undefined

	try {
		version = readSkyCatalogMeta(db, 'schemaVersion')
	} catch {
		version = undefined
	}

	if (version !== SKY_CATALOG_SCHEMA_VERSION.toFixed(0)) {
		throw new Error(`The sky catalog has schema version ${version ?? 'unknown'}, expected ${SKY_CATALOG_SCHEMA_VERSION}. Run "bun make:catalog --force".`)
	}
}
