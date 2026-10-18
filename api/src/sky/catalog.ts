import type { Database } from 'bun:sqlite'
import { CONSTELLATION_LIST, CONSTELLATIONS } from 'nebulosa/src/astronomy/coordinates/constellation'
import { eraC2s, eraS2c } from 'nebulosa/src/astronomy/coordinates/erfa/erfa'
import { precessionNutationMatrix, type Time, timeUnix } from 'nebulosa/src/astronomy/time/time'
import { StellariumObjectType } from 'nebulosa/src/catalogs/stars/stellarium/nebulae'
import { J2000 } from 'nebulosa/src/core/constants'
import { type Mat3, matMulVec } from 'nebulosa/src/math/linear-algebra/mat3'
import type { MutVec3 } from 'nebulosa/src/math/linear-algebra/vec3'
import { normalizeAngle, toArcmin } from 'nebulosa/src/math/units/angle'
import { CATALOG, constellationAbbreviation, displayPriority, formatDesignation, parseDesignationQuery } from './designations'
import type { SkyCatalogNameRow, SkyCatalogObjectRow } from './schema'
import type { SkyCatalogObject, SkyConstellations, SkyDeepSkyData, SkySearchResult, SkyStarData } from './types'

// Queries of the sky catalog database: local search by designation and name, the catalog data of one
// object, and the columnar star and deep-sky data the star map renders, with positions referred to the
// true equator and equinox of the requested instant. Every function takes the database, so tests can pass
// an in-memory one built with createSkyCatalogSchema.

// Most results a search returns.
export const MAX_SEARCH_LIMIT = 50

// Number of other designations listed with a search result.
const SEARCH_DESIGNATIONS = 3

// Faintest deep-sky magnitude rendered by default; objects without a magnitude are rendered only when
// they belong to one of RENDERED_UNKNOWN_MAGNITUDE_CATALOGS.
export const DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT = 14

// Catalogs whose objects are rendered even without a magnitude: the classic visual catalogs of bright,
// extended objects (nebulae, dark clouds, and clusters), unlike PGC galaxies.
const RENDERED_UNKNOWN_MAGNITUDE_CATALOGS = [CATALOG.NAME, CATALOG.NGC, CATALOG.IC, CATALOG.M, CATALOG.C, CATALOG.B, CATALOG.SH2, CATALOG.LBN, CATALOG.LDN, CATALOG.MEL, CATALOG.CR, CATALOG.TR, CATALOG.CED, CATALOG.RCW, CATALOG.VDB, CATALOG.GUM] as const

// B-V color index in magnitudes given to stars without one (a solar-type white).
const DEFAULT_BV = 0.65

// Object ids bound per names query; well under SQLite's default limit of bound parameters.
const NAME_BATCH_SIZE = 500

// Days per Julian year, for proper motion.
const DAYS_PER_JULIAN_YEAR = 365.25

// Name of each Stellarium object type, indexed by StellariumObjectType.
const OBJECT_TYPE_NAMES = [
	'Unknown',
	'Galaxy',
	'Active Galaxy',
	'Radio Galaxy',
	'Interacting Galaxy',
	'Quasar',
	'Star Cluster',
	'Open Star Cluster',
	'Globular Star Cluster',
	'Stellar Association',
	'Star Cloud',
	'Nebula',
	'Planetary Nebula',
	'Dark Nebula',
	'Reflection Nebula',
	'Bipolar Nebula',
	'Emission Nebula',
	'Cluster Associated With Nebulosity',
	'HII Region',
	'Supernova Remnant',
	'Interstellar Matter',
	'Emission Object',
	'BL Lacertae Object',
	'Blazar',
	'Molecular Cloud',
	'Young Stellar Object',
	'Possible Quasar',
	'Possible Planetary Nebula',
	'Protoplanetary Nebula',
	'Star',
	'Symbiotic Star',
	'Emission-Line Star',
	'Supernova Candidate',
	'Supernova Remnant Candidate',
	'Cluster of Galaxies',
	'Part of Galaxy',
	'Region of the Sky',
] as const

// Returns the name of a Stellarium object type.
export function objectTypeName(type: number): string {
	return OBJECT_TYPE_NAMES[type] ?? 'Unknown'
}

// Returns whether a Stellarium object type is a star.
function isStar(type: number) {
	return type === StellariumObjectType.STAR
}

// Escapes the LIKE wildcards of user text; the queries declare `\` as the escape character.
function escapeLike(text: string) {
	return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`)
}

// Builds `?, ?, ?` for an IN clause of `count` values.
function placeholders(count: number) {
	return new Array<string>(count).fill('?').join(', ')
}

// Display name and other designations of an object, from its names.
interface ObjectNames {
	// Preferred designation.
	readonly name: string
	// Every other designation, preferred first.
	readonly designations: string[]
	// Preferred catalog designation (not a proper name) when the display name is a proper name, such as
	// "M 31" for the Andromeda Galaxy.
	readonly catalogDesignation?: string
}

// Orders the names of an object by display priority, then source rank, and formats them.
function objectNames(names: readonly SkyCatalogNameRow[], constellation: number): ObjectNames {
	const sorted = names.toSorted((a, b) => displayPriority(a.type) - displayPriority(b.type) || a.rank - b.rank || a.name.localeCompare(b.name, undefined, { numeric: true }))
	const formatted = sorted.map((e) => formatDesignation(e.type, e.name, constellation))
	const catalogIndex = sorted[0]?.type === CATALOG.NAME ? sorted.findIndex((e) => e.type !== CATALOG.NAME) : -1
	return { name: formatted[0] ?? '', designations: formatted.slice(1), catalogDesignation: catalogIndex > 0 ? formatted[catalogIndex] : undefined }
}

// Reads the names of several objects, grouped by object id. Ids are queried in batches of NAME_BATCH_SIZE
// to stay under SQLite's limit of bound parameters.
function namesOf(db: Database, ids: readonly number[]) {
	const grouped = new Map<number, SkyCatalogNameRow[]>()

	for (let start = 0; start < ids.length; start += NAME_BATCH_SIZE) {
		const batch = ids.slice(start, start + NAME_BATCH_SIZE)

		for (const row of db.query<SkyCatalogNameRow, number[]>(`SELECT objectId, type, name, rank FROM names WHERE objectId IN (${placeholders(batch.length)})`).all(...batch)) {
			const list = grouped.get(row.objectId)
			if (list) list.push(row)
			else grouped.set(row.objectId, [row])
		}
	}

	return grouped
}

// Ids of objects whose designation matches one parsed from the query.
function designationMatches(db: Database, query: string, limit: number) {
	const ids: number[] = []

	for (const designation of parseDesignationQuery(query)) {
		if (designation.constellation) {
			const constellation = CONSTELLATION_LIST.indexOf(designation.constellation)
			const components = designation.components ? `${escapeLike(designation.name)}-%` : ''
			const rows = db
				.query<{ objectId: number }, [number, string, string, number, number]>("SELECT n.objectId FROM names n JOIN objects o ON o.id = n.objectId WHERE n.type = ? AND (n.name = ? OR n.name LIKE ? ESCAPE '\\') AND o.constellation = ? ORDER BY o.magnitude IS NULL, o.magnitude LIMIT ?")
				.all(designation.type, designation.name, components, constellation, limit)
			for (const row of rows) ids.push(row.objectId)
		} else {
			const rows = db.query<{ objectId: number }, [number, string, number]>('SELECT n.objectId FROM names n JOIN objects o ON o.id = n.objectId WHERE n.type = ? AND n.name = ? ORDER BY o.magnitude IS NULL, o.magnitude LIMIT ?').all(designation.type, designation.name, limit)
			for (const row of rows) ids.push(row.objectId)
		}
	}

	return ids
}

// Ids of objects whose proper name matches a LIKE pattern, brightest first.
function nameMatches(db: Database, pattern: string, limit: number) {
	return db
		.query<{ objectId: number }, [string, number]>("SELECT DISTINCT n.objectId FROM names n JOIN objects o ON o.id = n.objectId WHERE n.type = 0 AND n.name LIKE ? ESCAPE '\\' ORDER BY o.magnitude IS NULL, o.magnitude LIMIT ?")
		.all(pattern, limit)
		.map((e) => e.objectId)
}

// Searches stars and deep-sky objects: exact designations ("M 31", "HIP 32349", "Alp CMa") first, then
// proper names starting with the query, then proper names containing it; brightest first within each
// group. Returns at most `limit` results (capped at MAX_SEARCH_LIMIT).
export function searchCatalog(db: Database, query: string, limit: number = 20): SkySearchResult[] {
	const text = query.trim()
	if (!text) return []

	const max = Math.max(1, Math.min(MAX_SEARCH_LIMIT, Math.trunc(limit)))
	const ids = new Set<number>()

	for (const id of designationMatches(db, text, max)) ids.add(id)
	if (ids.size < max) for (const id of nameMatches(db, `${escapeLike(text)}%`, max)) ids.add(id)
	if (ids.size < max) for (const id of nameMatches(db, `%${escapeLike(text)}%`, max)) ids.add(id)

	const ordered = [...ids].slice(0, max)
	if (ordered.length === 0) return []

	const objects = new Map(
		db
			.query<SkyCatalogObjectRow, number[]>(`SELECT * FROM objects WHERE id IN (${placeholders(ordered.length)})`)
			.all(...ordered)
			.map((e) => [e.id, e]),
	)
	const names = namesOf(db, ordered)
	const results: SkySearchResult[] = []

	for (const id of ordered) {
		const object = objects.get(id)
		if (!object) continue

		const { name, designations, catalogDesignation } = objectNames(names.get(id) ?? [], object.constellation)
		// The catalog designation is listed first so proper-named objects still show "M 31" or "Alp CMa".
		const listed = catalogDesignation ? [catalogDesignation, ...designations.filter((e) => e !== catalogDesignation)] : designations
		const result: SkySearchResult = {
			ref: { kind: 'catalog', id },
			name,
			designations: listed.slice(0, SEARCH_DESIGNATIONS),
			category: isStar(object.type) ? 'star' : 'deepSky',
			typeName: objectTypeName(object.type),
			constellation: constellationAbbreviation(object.constellation),
		}

		results.push(object.magnitude === null ? result : { ...result, magnitude: object.magnitude })
	}

	return results
}

// Returns the catalog data of a star or deep-sky object; undefined when the id is unknown.
export function catalogObject(db: Database, id: number): SkyCatalogObject | undefined {
	const row = db.query<SkyCatalogObjectRow, [number]>('SELECT * FROM objects WHERE id = ?').get(id)
	if (!row) return undefined

	const { name, designations } = objectNames(namesOf(db, [id]).get(id) ?? [], row.constellation)
	const constellation = CONSTELLATION_LIST[row.constellation]

	return {
		id,
		category: isStar(row.type) ? 'star' : 'deepSky',
		type: row.type,
		typeName: objectTypeName(row.type),
		name,
		designations,
		rightAscension: row.rightAscension,
		declination: row.declination,
		magnitude: row.magnitude ?? undefined,
		bv: row.bv ?? undefined,
		pmRA: row.pmRA,
		pmDEC: row.pmDEC,
		distance: row.distance ?? undefined,
		rv: row.rv,
		constellation: CONSTELLATIONS[constellation].iau,
		constellationName: CONSTELLATIONS[constellation].name,
		classification: row.classification ?? undefined,
		majorAxis: row.majorAxis ?? undefined,
		minorAxis: row.minorAxis ?? undefined,
		orientation: row.orientation ?? undefined,
	}
}

// Converts J2000 coordinates to the true equator and equinox of date with a precomputed
// precession-nutation matrix.
class EquatorOfDate {
	readonly #matrix: Mat3
	readonly #input: MutVec3 = [0, 0, 0]
	readonly #output: MutVec3 = [0, 0, 0]
	// Julian years elapsed since J2000, for proper motion.
	readonly years: number

	// Prepares the conversion to the equator of `time`.
	constructor(time: Time) {
		this.#matrix = precessionNutationMatrix(time)
		this.years = (time.day - J2000 + time.fraction) / DAYS_PER_JULIAN_YEAR
	}

	// Returns [right ascension in [0, 2π), declination] in radians of a J2000 position.
	convert(rightAscension: number, declination: number): [number, number] {
		const [x, y, z] = matMulVec(this.#matrix, eraS2c(rightAscension, declination, this.#input), this.#output)
		const [ra, dec] = eraC2s(x, y, z)
		return [normalizeAngle(ra), dec]
	}
}

// J2000 data of a rendered star, read once per database.
interface StarRow {
	// Catalog id.
	readonly id: number
	// Right ascension at J2000 in radians.
	readonly rightAscension: number
	// Declination at J2000 in radians.
	readonly declination: number
	// Visual magnitude.
	readonly magnitude: number
	// B-V color index in magnitudes, or null.
	readonly bv: number | null
	// Proper motion dα/dt in radians per Julian year.
	readonly pmRA: number
	// Proper motion in declination in radians per Julian year.
	readonly pmDEC: number
	// Primary proper name, or empty.
	readonly name: string
}

// Rendered star rows by database. The catalog is read-only, so they are read once and only the
// conversion to the equator of date runs per request.
const STAR_ROWS = new WeakMap<Database, readonly StarRow[]>()

// Returns the rendered star rows of a database, brightest first.
function starRows(db: Database): readonly StarRow[] {
	const cached = STAR_ROWS.get(db)
	if (cached) return cached

	const names = new Map(
		db
			.query<{ objectId: number; name: string }, []>('SELECT objectId, name FROM names WHERE type = 0 AND rank = 0')
			.all()
			.map((e) => [e.objectId, e.name]),
	)
	const stars = db.query<Omit<StarRow, 'name'> & { name: string }, [number]>("SELECT id, rightAscension, declination, magnitude, bv, pmRA, pmDEC, '' AS name FROM objects WHERE type = ? AND magnitude IS NOT NULL ORDER BY magnitude").all(StellariumObjectType.STAR)
	for (const star of stars) star.name = names.get(star.id) ?? ''
	STAR_ROWS.set(db, stars)
	return stars
}

// Rounds an angle in radians to 1e-7 rad (0.02″), well under a pixel at any zoom, to keep payloads small.
function roundAngle(value: number) {
	return Math.round(value * 1e7) / 1e7
}

// Returns every star of the catalog for rendering, at the true equator of `time` (Unix milliseconds).
// Proper motion is applied linearly from J2000, which is accurate to well under an arcsecond over the
// decades the map is used for.
export function renderStars(db: Database, time: number): SkyStarData {
	const equator = new EquatorOfDate(timeUnix(time / 1000, true))
	const rows = starRows(db)
	const data = { time, ids: new Array<number>(rows.length), names: new Array<string>(rows.length), ra: new Array<number>(rows.length), dec: new Array<number>(rows.length), mag: new Array<number>(rows.length), bv: new Array<number>(rows.length) }

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		const [ra, dec] = equator.convert(row.rightAscension + row.pmRA * equator.years, row.declination + row.pmDEC * equator.years)
		data.ids[i] = row.id
		data.names[i] = row.name
		data.ra[i] = roundAngle(ra)
		data.dec[i] = roundAngle(dec)
		data.mag[i] = row.magnitude
		data.bv[i] = row.bv ?? DEFAULT_BV
	}

	return data
}

// Returns the deep-sky objects to render, at the true equator of `time` (Unix milliseconds): those up to
// `magnitudeLimit` and those without a magnitude that belong to a classic visual catalog.
export function renderDeepSky(db: Database, time: number, magnitudeLimit: number = DEFAULT_DEEP_SKY_MAGNITUDE_LIMIT): SkyDeepSkyData {
	const equator = new EquatorOfDate(timeUnix(time / 1000, true))
	const rows = db
		.query<Pick<SkyCatalogObjectRow, 'id' | 'type' | 'rightAscension' | 'declination' | 'magnitude' | 'majorAxis' | 'constellation'>, (number | string)[]>(
			`SELECT o.id, o.type, o.rightAscension, o.declination, o.magnitude, o.majorAxis, o.constellation FROM objects o WHERE o.type <> ? AND (o.magnitude <= ? OR (o.magnitude IS NULL AND EXISTS (SELECT 1 FROM names n WHERE n.objectId = o.id AND n.type IN (${placeholders(RENDERED_UNKNOWN_MAGNITUDE_CATALOGS.length)})))) ORDER BY o.magnitude IS NULL, o.magnitude`,
		)
		.all(StellariumObjectType.STAR, magnitudeLimit, ...RENDERED_UNKNOWN_MAGNITUDE_CATALOGS)
	const names = namesOf(
		db,
		rows.map((e) => e.id),
	)
	const data = {
		time,
		ids: new Array<number>(rows.length),
		names: new Array<string>(rows.length),
		types: new Array<number>(rows.length),
		ra: new Array<number>(rows.length),
		dec: new Array<number>(rows.length),
		mag: new Array<number | null>(rows.length),
		size: new Array<number>(rows.length),
		typeNames: OBJECT_TYPE_NAMES,
	}

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i]
		const [ra, dec] = equator.convert(row.rightAscension, row.declination)
		data.ids[i] = row.id
		data.names[i] = objectNames(names.get(row.id) ?? [], row.constellation).name
		data.types[i] = row.type
		data.ra[i] = roundAngle(ra)
		data.dec[i] = roundAngle(dec)
		data.mag[i] = row.magnitude
		data.size[i] = row.majorAxis === null ? 0 : Math.round(toArcmin(row.majorAxis) * 100) / 100
	}

	return data
}

// J2000 constellation figures, boundaries, and labels, as stored in api/data.
export interface ConstellationSource {
	// Stick-figure polylines of [right ascension, declination] vertices in radians.
	readonly lines: readonly (readonly (readonly number[])[])[]
	// Boundary polylines of [right ascension, declination] vertices in radians.
	readonly boundaries: readonly (readonly (readonly number[])[])[]
	// Labels at the constellation centers, in radians.
	readonly labels: readonly { readonly name: string; readonly rightAscension: number; readonly declination: number }[]
}

// Returns the constellation data at the true equator of `time` (Unix milliseconds).
export function renderConstellations(source: ConstellationSource, time: number): SkyConstellations {
	const equator = new EquatorOfDate(timeUnix(time / 1000, true))
	const polyline = (line: readonly (readonly number[])[]) => line.map(([ra, dec]) => equator.convert(ra, dec).map(roundAngle) as [number, number])

	return {
		time,
		lines: source.lines.map(polyline),
		boundaries: source.boundaries.map(polyline),
		labels: source.labels.map(({ name, rightAscension, declination }) => {
			const [ra, dec] = equator.convert(rightAscension, declination)
			return { name, rightAscension: roundAngle(ra), declination: roundAngle(dec) }
		}),
	}
}
