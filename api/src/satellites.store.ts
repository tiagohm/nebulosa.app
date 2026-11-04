import type { OMM } from 'nebulosa/src/astronomy/orbits/propagation/sgp4'
import type { AppDatabase } from './database'

// Catalog of artificial satellites kept in the operational database: the identity and SATCAT metadata of each object,
// its element sets (the latest GP set and the last imported one), the groups of the sources, and the download state of
// each CelesTrak query, and the groups downloaded automatically. Shared by every profile. A download is published in one short transaction, so a failure never
// leaves a partial catalog, and a source that fails keeps its previous rows. NORAD ids are canonical decimal strings.

// Kind of an element set: GP from CelesTrak, or imported by an operator.
export type SatelliteElementKind = 'gp' | 'manual'

// SATCAT object type.
export type SatelliteObjectType = 'payload' | 'rocketBody' | 'debris' | 'unknown'

// Dataset of a CelesTrak query.
export type SatelliteProvider = 'gp' | 'satcat'

// Source key of the element sets an operator imported, also the group listing them.
export const MANUAL_SOURCE_KEY = 'manual'

// Largest page of a search.
export const SATELLITE_SEARCH_LIMIT = 100

// Metadata of an object from the CelesTrak SATCAT. A field the catalog does not publish is absent.
export interface SatelliteCatalogMetadata {
	// Object type.
	readonly objectType?: SatelliteObjectType
	// Operational status code as published (+, -, P, B, S, X, D, ?).
	readonly opsStatus?: string
	// Owner or source code.
	readonly owner?: string
	// Launch date (YYYY-MM-DD).
	readonly launchDate?: string
	// Decay date (YYYY-MM-DD); absent when the object has not decayed.
	readonly decayDate?: string
	// Orbit center code, such as EA for the Earth.
	readonly orbitCenter?: string
	// Orbit type code (ORB, LAN, IMP, DOC, R/T).
	readonly orbitType?: string
	// Published orbital period, in minutes.
	readonly periodMinutes?: number
	// Published apogee and perigee heights, in kilometers.
	readonly apogeeKm?: number
	readonly perigeeKm?: number
}

// Object written by a publication.
export interface SatelliteObjectInput {
	// NORAD catalog number, canonical decimal digits.
	readonly noradId: string
	// Name as published.
	readonly name: string
	// International designator; absent keeps the stored one.
	readonly cosparId?: string
	// SATCAT metadata, which replaces the stored metadata entirely; absent keeps it.
	readonly catalog?: SatelliteCatalogMetadata
	// Element set chosen for the predictions; absent keeps the choice.
	readonly elementSource?: SatelliteElementKind
}

// Element set of an object.
export interface SatelliteElementSet {
	// NORAD catalog number.
	readonly noradId: string
	// Kind of the set.
	readonly kind: SatelliteElementKind
	// Source key of the query or import that delivered it.
	readonly sourceKey: string
	// Epoch of the elements, Unix milliseconds (UTC).
	readonly epoch: number
	// The elements as a normalized OMM.
	readonly omm: OMM
	// SHA-256 of the normalized OMM, lowercase hexadecimal.
	readonly digest: string
	// When the set was received, Unix milliseconds (UTC).
	readonly fetchedAt: number
}

// Download state of a CelesTrak query.
export interface SatelliteSourceState {
	// Source key, such as gp:GROUP:STATIONS.
	readonly sourceKey: string
	// Dataset read.
	readonly provider: SatelliteProvider
	// Query parameter and value, such as GROUP=STATIONS.
	readonly query: string
	// When a download was last attempted, Unix milliseconds (UTC); absent when never.
	readonly lastAttemptAt?: number
	// When a download last succeeded, Unix milliseconds (UTC); absent when never.
	readonly lastSuccessAt?: number
	// Earliest instant of the next download, Unix milliseconds (UTC).
	readonly nextAllowedAt: number
	// Failed downloads since the last success.
	readonly failures: number
	// HTTP status of the last failed download; absent when it had none or the last download succeeded.
	readonly lastStatus?: number
	// Why the last download failed; absent when it succeeded.
	readonly lastError?: string
	// Objects of the last successful download; absent when never downloaded.
	readonly recordCount?: number
	// Objects the last successful download left out because their elements failed validation.
	readonly rejectedCount?: number
	// Revision of the data, increased by every successful download; 0 when never downloaded.
	readonly revision: number
}

// Everything one successful download or import writes, in one transaction.
export interface SatellitePublication {
	// Source key the data came from.
	readonly sourceKey: string
	// Objects to insert or update.
	readonly objects: readonly SatelliteObjectInput[]
	// Element sets to store. A GP set replaces the stored one only when its epoch is not older; an imported set always
	// replaces the previous import.
	readonly elements: readonly SatelliteElementSet[]
	// NORAD ids the source lists, replacing its previous membership; absent leaves the membership unchanged except for
	// adding the published objects.
	readonly members?: readonly string[]
	// Download state written for the source; absent for an import.
	readonly source?: SatelliteSourceState
	// When the data was received, Unix milliseconds (UTC).
	readonly at: number
}

// Filters and page of a search.
export interface SatelliteSearchQuery {
	// Text matched against the NORAD id, the international designator, and the name; absent lists every object.
	readonly text?: string
	// Source key whose group the objects must belong to.
	readonly group?: string
	// Object type.
	readonly objectType?: SatelliteObjectType
	// Operational status code.
	readonly opsStatus?: string
	// NORAD ids the objects must be among, such as the favorites of a profile.
	readonly ids?: readonly string[]
	// Number of objects skipped, from 0.
	readonly offset?: number
	// Page size, 1 to SATELLITE_SEARCH_LIMIT.
	readonly limit: number
}

// Object of a search or of its details.
export interface SatelliteSummary extends SatelliteCatalogMetadata {
	// NORAD catalog number.
	readonly noradId: string
	// Name as published.
	readonly name: string
	// International designator.
	readonly cosparId?: string
	// Source keys of the groups listing the object, sorted.
	readonly groups: readonly string[]
	// Kind of the element set the predictions use; absent for a metadata-only object.
	readonly elementKind?: SatelliteElementKind
	// Epoch of that element set, Unix milliseconds (UTC).
	readonly elementEpoch?: number
	// Element set chosen by an operator; absent to use GP, then imported elements.
	readonly elementSource?: SatelliteElementKind
	// Source key and time of the SATCAT metadata, Unix milliseconds (UTC); absent when never read.
	readonly metadataSource?: string
	readonly metadataAt?: number
}

// Page of a search.
export interface SatelliteSearchPage {
	// Objects of the page: exact NORAD id or international designator first, then names starting with the text, then
	// names containing it, each by name.
	readonly items: readonly SatelliteSummary[]
	// Objects matching the filters, in every page.
	readonly total: number
}

// Group of a source with its size.
export interface SatelliteGroup {
	// Source key.
	readonly sourceKey: string
	// Objects the group lists.
	readonly members: number
	// When the source last listed an object, Unix milliseconds (UTC).
	readonly confirmedAt: number
}

// Row of satellite_objects with the selected element set and the groups.
interface SummaryRow {
	readonly norad_id: string
	readonly name: string
	readonly cospar_id: string | null
	readonly object_type: SatelliteObjectType | null
	readonly ops_status: string | null
	readonly owner: string | null
	readonly launch_date: string | null
	readonly decay_date: string | null
	readonly orbit_center: string | null
	readonly orbit_type: string | null
	readonly period_min: number | null
	readonly apogee_km: number | null
	readonly perigee_km: number | null
	readonly metadata_source: string | null
	readonly metadata_at: number | null
	readonly element_source: SatelliteElementKind | null
	readonly element_kind: SatelliteElementKind | null
	readonly element_epoch: number | null
	readonly groups: string | null
}

// Row of satellite_element_sets.
interface ElementRow {
	readonly norad_id: string
	readonly kind: SatelliteElementKind
	readonly source_key: string
	readonly epoch: number
	readonly omm: string
	readonly digest: string
	readonly fetched_at: number
}

// Row of satellite_sources.
interface SourceRow {
	readonly source_key: string
	readonly provider: SatelliteProvider
	readonly query: string
	readonly last_attempt_at: number | null
	readonly last_success_at: number | null
	readonly next_allowed_at: number
	readonly failures: number
	readonly last_status: number | null
	readonly last_error: string | null
	readonly record_count: number | null
	readonly rejected_count: number | null
	readonly revision: number
}

// Order of the element sets of an object: the operator's choice, then GP, then imported. Expects the object as `o` and
// the set as `e`.
const ELEMENT_PREFERENCE = "CASE WHEN e.kind = o.element_source THEN 0 WHEN e.kind = 'gp' THEN 1 ELSE 2 END"

// Columns of a summary, the selected element set and the groups included. Expects the object as `o`.
const SUMMARY_COLUMNS = `o.norad_id, o.name, o.cospar_id, o.object_type, o.ops_status, o.owner, o.launch_date, o.decay_date, o.orbit_center, o.orbit_type, o.period_min, o.apogee_km, o.perigee_km, o.metadata_source, o.metadata_at, o.element_source,
	(SELECT e.kind FROM satellite_element_sets e WHERE e.norad_id = o.norad_id ORDER BY ${ELEMENT_PREFERENCE} LIMIT 1) AS element_kind,
	(SELECT e.epoch FROM satellite_element_sets e WHERE e.norad_id = o.norad_id ORDER BY ${ELEMENT_PREFERENCE} LIMIT 1) AS element_epoch,
	(SELECT json_group_array(source_key) FROM (SELECT m.source_key FROM satellite_memberships m WHERE m.norad_id = o.norad_id ORDER BY m.source_key)) AS groups`

// Filters of a search, bound by name. Expects the object as `o`.
const SEARCH_FILTER = `(:text IS NULL OR o.norad_id = :id OR o.cospar_id = :cospar OR o.search_name LIKE :contains ESCAPE '\\')
	AND (:group IS NULL OR EXISTS (SELECT 1 FROM satellite_memberships m WHERE m.norad_id = o.norad_id AND m.source_key = :group))
	AND (:type IS NULL OR o.object_type = :type)
	AND (:status IS NULL OR o.ops_status = :status)
	AND (:ids IS NULL OR o.norad_id IN (SELECT value FROM json_each(:ids)))`

// Returns text in the form names are searched in: decomposed, without combining marks, in lower case.
export function satelliteSearchText(text: string) {
	return text.normalize('NFD').replaceAll(/\p{M}/gu, '').toLowerCase()
}

// Returns the canonical NORAD id a text names when it is decimal digits (leading zeros dropped); undefined otherwise.
export function canonicalNoradId(text: string) {
	const trimmed = text.trim()
	if (!/^\d+$/.test(trimmed)) return undefined
	return trimmed.replace(/^0+(?=\d)/, '')
}

// Escapes the LIKE wildcards of text with a backslash.
function escapeLike(text: string) {
	return text.replaceAll(/[\\%_]/g, (c) => `\\${c}`)
}

// Converts a summary row.
function summaryOf(row: SummaryRow): SatelliteSummary {
	return {
		noradId: row.norad_id,
		name: row.name,
		cosparId: row.cospar_id ?? undefined,
		objectType: row.object_type ?? undefined,
		opsStatus: row.ops_status ?? undefined,
		owner: row.owner ?? undefined,
		launchDate: row.launch_date ?? undefined,
		decayDate: row.decay_date ?? undefined,
		orbitCenter: row.orbit_center ?? undefined,
		orbitType: row.orbit_type ?? undefined,
		periodMinutes: row.period_min ?? undefined,
		apogeeKm: row.apogee_km ?? undefined,
		perigeeKm: row.perigee_km ?? undefined,
		metadataSource: row.metadata_source ?? undefined,
		metadataAt: row.metadata_at ?? undefined,
		elementSource: row.element_source ?? undefined,
		elementKind: row.element_kind ?? undefined,
		elementEpoch: row.element_epoch ?? undefined,
		groups: row.groups ? (JSON.parse(row.groups) as string[]) : [],
	}
}

// Converts an element row.
function elementOf(row: ElementRow): SatelliteElementSet {
	return { noradId: row.norad_id, kind: row.kind, sourceKey: row.source_key, epoch: row.epoch, omm: JSON.parse(row.omm) as OMM, digest: row.digest, fetchedAt: row.fetched_at }
}

// Converts a source row.
function sourceOf(row: SourceRow): SatelliteSourceState {
	return {
		sourceKey: row.source_key,
		provider: row.provider,
		query: row.query,
		lastAttemptAt: row.last_attempt_at ?? undefined,
		lastSuccessAt: row.last_success_at ?? undefined,
		nextAllowedAt: row.next_allowed_at,
		failures: row.failures,
		lastStatus: row.last_status ?? undefined,
		lastError: row.last_error ?? undefined,
		recordCount: row.record_count ?? undefined,
		rejectedCount: row.rejected_count ?? undefined,
		revision: row.revision,
	}
}

// Catalog of artificial satellites in the operational database. Reads are snapshots; every write is one transaction.
export class SatelliteStore {
	// Creates the store of the catalog in database.
	constructor(readonly database: AppDatabase) {}

	// Returns a page of the objects matching query. With text, the exact NORAD id (leading zeros ignored) and the exact
	// international designator (case ignored) come first, then names starting with the text, then names containing it,
	// diacritics and case ignored.
	search(query: SatelliteSearchQuery): SatelliteSearchPage {
		const text = query.text?.trim() || undefined
		const name = text === undefined ? undefined : escapeLike(satelliteSearchText(text))
		const params = {
			text: text ?? null,
			id: text === undefined ? null : (canonicalNoradId(text) ?? null),
			cospar: text?.toUpperCase() ?? null,
			prefix: name === undefined ? null : `${name}%`,
			contains: name === undefined ? null : `%${name}%`,
			group: query.group ?? null,
			type: query.objectType ?? null,
			status: query.opsStatus ?? null,
			ids: query.ids === undefined ? null : JSON.stringify(query.ids),
			limit: Math.min(Math.max(1, query.limit), SATELLITE_SEARCH_LIMIT),
			offset: Math.max(0, query.offset ?? 0),
		}
		const { db } = this.database
		const { total } = db.query<{ total: number }, typeof params>(`SELECT COUNT(*) AS total FROM satellite_objects o WHERE ${SEARCH_FILTER}`).get(params)!
		const rank = "CASE WHEN o.norad_id = :id OR o.cospar_id = :cospar THEN 0 WHEN o.search_name LIKE :prefix ESCAPE '\\' THEN 1 ELSE 2 END"
		const rows = db.query<SummaryRow, typeof params>(`SELECT ${SUMMARY_COLUMNS} FROM satellite_objects o WHERE ${SEARCH_FILTER} ORDER BY ${rank}, o.search_name, length(o.norad_id), o.norad_id LIMIT :limit OFFSET :offset`).all(params)
		return { items: rows.map(summaryOf), total }
	}

	// Returns an object, or undefined when the catalog does not know it.
	object(noradId: string): SatelliteSummary | undefined {
		const row = this.database.db.query<SummaryRow, [string]>(`SELECT ${SUMMARY_COLUMNS} FROM satellite_objects o WHERE o.norad_id = ?`).get(noradId)
		return row ? summaryOf(row) : undefined
	}

	// Returns the element set the predictions of an object use: the one an operator chose, else GP, else imported;
	// undefined for a metadata-only or unknown object.
	elements(noradId: string): SatelliteElementSet | undefined {
		const row = this.database.db.query<ElementRow, [string]>(`SELECT e.* FROM satellite_element_sets e JOIN satellite_objects o ON o.norad_id = e.norad_id WHERE e.norad_id = ? ORDER BY ${ELEMENT_PREFERENCE} LIMIT 1`).get(noradId)
		return row ? elementOf(row) : undefined
	}

	// Returns every element set of an object, GP first.
	elementSets(noradId: string): SatelliteElementSet[] {
		return this.database.db.query<ElementRow, [string]>("SELECT * FROM satellite_element_sets WHERE norad_id = ? ORDER BY kind = 'manual'").all(noradId).map(elementOf)
	}

	// Returns the NORAD ids of a group, in id order.
	members(sourceKey: string): string[] {
		return this.database.db
			.query<{ norad_id: string }, [string]>('SELECT norad_id FROM satellite_memberships WHERE source_key = ? ORDER BY length(norad_id), norad_id')
			.all(sourceKey)
			.map((row) => row.norad_id)
	}

	// Returns every group with its size, by source key.
	groups(): SatelliteGroup[] {
		return this.database.db
			.query<{ source_key: string; members: number; confirmed_at: number }, []>('SELECT source_key, COUNT(*) AS members, MAX(confirmed_at) AS confirmed_at FROM satellite_memberships GROUP BY source_key ORDER BY source_key')
			.all()
			.map((row) => ({ sourceKey: row.source_key, members: row.members, confirmedAt: row.confirmed_at }))
	}

	// Returns the download state of a source, or undefined when it was never attempted.
	source(sourceKey: string): SatelliteSourceState | undefined {
		const row = this.database.db.query<SourceRow, [string]>('SELECT * FROM satellite_sources WHERE source_key = ?').get(sourceKey)
		return row ? sourceOf(row) : undefined
	}

	// Returns the download state of every source attempted, by source key.
	sources(): SatelliteSourceState[] {
		return this.database.db.query<SourceRow, []>('SELECT * FROM satellite_sources ORDER BY source_key').all().map(sourceOf)
	}

	// Writes the download state of a source, such as a failed attempt; the data of the source is unchanged.
	saveSource(state: SatelliteSourceState) {
		this.database.write(() => this.#saveSource(state))
	}

	// Returns the source keys of the groups downloaded automatically, in the order they were turned on.
	autoDownloads(): string[] {
		return this.database.db
			.query<{ source_key: string }, []>('SELECT source_key FROM satellite_auto_downloads ORDER BY enabled_at, source_key')
			.all()
			.map((row) => row.source_key)
	}

	// Turns the automatic downloads of a group on or off; `at` is the instant, Unix milliseconds (UTC). Turning on a group
	// already on keeps its first instant.
	setAutoDownload(sourceKey: string, enabled: boolean, at: number) {
		if (enabled) this.database.db.query('INSERT INTO satellite_auto_downloads (source_key, enabled_at) VALUES (?, ?) ON CONFLICT (source_key) DO NOTHING').run(sourceKey, at)
		else this.database.db.query('DELETE FROM satellite_auto_downloads WHERE source_key = ?').run(sourceKey)
	}

	// Sets the element set an operator chose for an object; undefined restores GP, then imported. Returns false when the
	// catalog does not know the object.
	setElementSource(noradId: string, kind: SatelliteElementKind | undefined) {
		return this.database.db.query('UPDATE satellite_objects SET element_source = ? WHERE norad_id = ?').run(kind ?? null, noradId).changes > 0
	}

	// Writes a download or an import in one transaction: the objects, their element sets, the membership of the source,
	// and its download state. When anything throws, nothing is written and the previous catalog stays.
	publish(publication: SatellitePublication) {
		this.database.write(() => {
			const { db } = this.database
			const { sourceKey, at } = publication

			const identity = db.query('INSERT INTO satellite_objects (norad_id, name, search_name, cospar_id) VALUES (:id, :name, :search, :cospar) ON CONFLICT (norad_id) DO UPDATE SET name = excluded.name, search_name = excluded.search_name, cospar_id = COALESCE(excluded.cospar_id, cospar_id)')
			const catalog = db.query(
				'UPDATE satellite_objects SET object_type = :type, ops_status = :status, owner = :owner, launch_date = :launch, decay_date = :decay, orbit_center = :center, orbit_type = :orbit, period_min = :period, apogee_km = :apogee, perigee_km = :perigee, metadata_source = :source, metadata_at = :at WHERE norad_id = :id',
			)
			const choice = db.query('UPDATE satellite_objects SET element_source = ? WHERE norad_id = ?')

			for (const object of publication.objects) {
				identity.run({ id: object.noradId, name: object.name, search: satelliteSearchText(object.name), cospar: object.cosparId ?? null })

				if (object.catalog) {
					const c = object.catalog
					catalog.run({
						id: object.noradId,
						type: c.objectType ?? null,
						status: c.opsStatus ?? null,
						owner: c.owner ?? null,
						launch: c.launchDate ?? null,
						decay: c.decayDate ?? null,
						center: c.orbitCenter ?? null,
						orbit: c.orbitType ?? null,
						period: c.periodMinutes ?? null,
						apogee: c.apogeeKm ?? null,
						perigee: c.perigeeKm ?? null,
						source: sourceKey,
						at,
					})
				}

				if (object.elementSource) choice.run(object.elementSource, object.noradId)
			}

			const element = db.query(
				"INSERT INTO satellite_element_sets (norad_id, kind, source_key, epoch, omm, digest, fetched_at) VALUES (:id, :kind, :source, :epoch, :omm, :digest, :fetched) ON CONFLICT (norad_id, kind) DO UPDATE SET source_key = excluded.source_key, epoch = excluded.epoch, omm = excluded.omm, digest = excluded.digest, fetched_at = excluded.fetched_at WHERE excluded.kind = 'manual' OR excluded.epoch >= satellite_element_sets.epoch",
			)

			for (const set of publication.elements) {
				element.run({ id: set.noradId, kind: set.kind, source: set.sourceKey, epoch: set.epoch, omm: JSON.stringify(set.omm), digest: set.digest, fetched: set.fetchedAt })
			}

			const member = db.query('INSERT INTO satellite_memberships (source_key, norad_id, confirmed_at) VALUES (?, ?, ?) ON CONFLICT (source_key, norad_id) DO UPDATE SET confirmed_at = excluded.confirmed_at')

			if (publication.members) {
				db.query('DELETE FROM satellite_memberships WHERE source_key = ? AND norad_id NOT IN (SELECT value FROM json_each(?))').run(sourceKey, JSON.stringify(publication.members))
				for (const id of publication.members) member.run(sourceKey, id, at)
			} else {
				for (const object of publication.objects) member.run(sourceKey, object.noradId, at)
			}

			if (publication.source) this.#saveSource(publication.source)
		})
	}

	// Upserts the row of a source inside the current transaction.
	#saveSource(state: SatelliteSourceState) {
		this.database.db
			.query(
				'INSERT INTO satellite_sources (source_key, provider, query, last_attempt_at, last_success_at, next_allowed_at, failures, last_status, last_error, record_count, rejected_count, revision) VALUES (:key, :provider, :query, :attempt, :success, :next, :failures, :status, :error, :records, :rejected, :revision) ON CONFLICT (source_key) DO UPDATE SET provider = excluded.provider, query = excluded.query, last_attempt_at = excluded.last_attempt_at, last_success_at = excluded.last_success_at, next_allowed_at = excluded.next_allowed_at, failures = excluded.failures, last_status = excluded.last_status, last_error = excluded.last_error, record_count = excluded.record_count, rejected_count = excluded.rejected_count, revision = excluded.revision',
			)
			.run({
				key: state.sourceKey,
				provider: state.provider,
				query: state.query,
				attempt: state.lastAttemptAt ?? null,
				success: state.lastSuccessAt ?? null,
				next: state.nextAllowedAt,
				failures: state.failures,
				status: state.lastStatus ?? null,
				error: state.lastError ?? null,
				records: state.recordCount ?? null,
				rejected: state.rejectedCount ?? null,
				revision: state.revision,
			})
	}
}
