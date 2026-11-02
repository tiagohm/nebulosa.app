import { mkdir, readdir, rm } from 'fs/promises'
import { join } from 'path'
import type { CalibrationKind, CalibrationMetadata, CalibrationRecipe, CompatibilityFinding, MasterReference } from './calibrationlibrary.compatibility'
import { type AppDatabase, DEFAULT_DATA_DIRECTORY } from './database'
import { errorCode } from './util'

// Persistence of the Calibration Library. The frames it indexes, what an operator declared about them, and every revision of
// every master are rows of the operational database; each master FITS file is products/<masterId>/vNNNN/master.fit, whose
// row says everything else about it. A revision is publishing from the moment its number is taken until its directory is
// in products/, and deleting from the moment an operator deletes it until its directory is gone, so a crash between the
// two halves is reconciled from the disk on the next start; a number is never used again. Jobs and what an import found
// live in memory and are never written; staging holds only the work of a running build. Calibration frames are
// referenced, never copied here unless an import asks for it, and nothing in this file touches a frame or a plan of the
// Dark Library. Every read and write is synchronous and short; a caller that changes many rows passes them together, so
// one transaction covers them.

// Default directory of the products, staging, and copies of the library.
export const DEFAULT_CALIBRATION_LIBRARY_DIRECTORY = join(DEFAULT_DATA_DIRECTORY, 'calibration-library')

// Most rows one listing returns.
export const MAX_PAGE_SIZE = 200

// Where a frame came from:
// - darkPlan: a frame of a Dark Library plan.
// - flatWizard: a frame the Flat Wizard published.
// - import: a file of a scanned directory.
export type SourceOrigin = 'darkPlan' | 'flatWizard' | 'import'

// State of the file of a frame:
// - available: its size and modification time are the indexed ones.
// - missing: it is not there now, which can change.
// - changed: it is there with another size or time.
// - corrupt: it cannot be read as an image.
export type SourceStatus = 'available' | 'missing' | 'changed' | 'corrupt'

// Format of a frame.
export type SourceFormat = 'fits' | 'xisf'

// Indexed calibration frame.
export interface CalibrationSource {
	// Stable id, derived from its path.
	readonly sourceId: string
	// Where it came from.
	readonly origin: SourceOrigin
	// planId/groupId/frameId, or the session or import it came from.
	readonly originId?: string
	// Role.
	readonly kind: CalibrationKind
	// Absolute path; never published in an event or a list.
	readonly path: string
	// Format.
	readonly format: SourceFormat
	// Size, in bytes.
	readonly bytes: number
	// Modification time, in milliseconds since the epoch.
	readonly mtimeMillis: number
	// SHA-256 of the file, once a job has read it at this size and time.
	readonly digest?: string
	// What is known about it.
	readonly metadata: CalibrationMetadata
	// What should be said about it.
	readonly warnings: readonly string[]
	// State of its file.
	readonly status: SourceStatus
	// Why an operator left it out of masters; absent when included.
	readonly excluded?: string
	// Frames its plan required in its group.
	readonly required?: number
	// Whether a master can read it at all.
	readonly supported: boolean
	// Compatibility key.
	readonly key: string
	// Id of its group.
	readonly groupId: string
}

// What a list shows of a frame: no path.
export type CalibrationSourceSummary = Omit<CalibrationSource, 'path'> & {
	// Name of its file.
	readonly name: string
}

// State of a master revision:
// - ready: its file is there, as it was published.
// - warning: published with something an operator accepted.
// - stale: a dependency or a source changed after it was published; it still is what its row says.
// - unavailable: its file is not there, or does not match.
export type ProductStatus = 'ready' | 'warning' | 'stale' | 'unavailable'

// What a master is made of, on disk and in the catalog.
export type MasterCalibrationState = 'rawBiasIncluded' | 'rawBias' | 'calibratedNormalized'

// Statistics of one plane of a master.
export interface MasterPlaneDiagnostics {
	// Plane: a CFA phase or a channel, from 0.
	readonly plane: number
	// Median and robust standard deviation before any final normalization, in DN or dimensionless.
	readonly median: number
	readonly sigma: number
}

// Evidence of an integration.
export interface CalibrationMasterDiagnostics {
	// Frames requested, and those that entered the master.
	readonly requestedFrames: number
	readonly integratedFrames: number
	// Method really used, which a small set can reduce to a mean.
	readonly method: CalibrationRecipe['method']
	// Whether fewer frames than recommended went in.
	readonly lowSampleCount: boolean
	// Input samples rejected below and above the center, and non-finite ones.
	readonly rejectedLow: number
	readonly rejectedHigh: number
	readonly nonFinite: number
	// Pixels whose rejection stopped at the retained-sample limit.
	readonly clipLimited: number
	// Share of input samples rejected per frame, in the order of the sources.
	readonly rejectedPerFrame: readonly number[]
	// Levels per plane.
	readonly planes: readonly MasterPlaneDiagnostics[]
	// Pixels more than 5 robust deviations above their plane; a dark's hot pixels. Absent on a flat.
	readonly hotPixels?: number
	// Pixels of a flat with no valid response, kept as they came out.
	readonly invalidResponsePixels?: number
	// Flats left out, and why.
	readonly excludedFrames?: readonly { readonly sourceId: string; readonly reason: string }[]
}

// One published revision of a master.
export interface CalibrationMaster {
	// Id of the master: the identity of its group.
	readonly masterId: string
	// Revision, from 1; never reused or rewritten.
	readonly revision: number
	// Role.
	readonly kind: CalibrationKind
	// What its pixels contain.
	readonly calibrationState: MasterCalibrationState
	// Units of its pixels.
	readonly units: 'DN' | 'dimensionless'
	// Algebra a calibrator must follow, in words a person can check.
	readonly usage: string
	// Digital full scale of its source frames, to convert a master in DN to normalized samples.
	readonly fullScaleDn: number
	// Sources, with their digests, in integration order.
	readonly sourceIds: readonly string[]
	readonly sourceDigests: readonly string[]
	// File names of the sources, so a revision still names a frame deleted since.
	readonly sourceNames: readonly string[]
	// Masters it depends on.
	readonly dependencies: readonly MasterReference[]
	// How it was combined.
	readonly recipe: CalibrationRecipe
	// Identity of its inputs and recipe.
	readonly fingerprint: string
	// What is known about it.
	readonly metadata: CalibrationMetadata
	// Compatibility key of its group.
	readonly key: string
	// Id of its group.
	readonly groupId: string
	// Evidence of its integration.
	readonly diagnostics: CalibrationMasterDiagnostics
	// What an operator accepted when requesting it.
	readonly acknowledged: readonly CompatibilityFinding[]
	// SHA-256 of its FITS file.
	readonly contentDigest: string
	// Size of its FITS file, in bytes.
	readonly bytes: number
	// When it was published.
	readonly createdAt: number
	// State.
	readonly status: ProductStatus
}

// Name of the FITS file of a revision.
export const MASTER_FILE = 'master.fit'

// Publication state of a revision row: publishing until its directory is in products/, deleting until it is gone.
export type RevisionPublication = 'publishing' | 'published' | 'deleting'

// Camera with frames in the library.
export interface CalibrationCamera {
	// Hardware id.
	readonly id: string
	// Name of the camera; null when no frame recorded one.
	readonly name: string | null
}

// Filters of a listing of frames.
export interface SourceFilter {
	// Role.
	readonly kind?: CalibrationKind
	// Camera hardware id; empty for frames without one.
	readonly camera?: string
	// State of the file.
	readonly status?: SourceStatus
	// Group.
	readonly groupId?: string
	// Text in the file name or camera name.
	readonly search?: string
}

// Filters of a listing of masters.
export interface MasterFilter {
	// Role.
	readonly kind?: CalibrationKind
	// Camera hardware id; empty for masters without one.
	readonly camera?: string
	// Filter name.
	readonly filter?: string
	// State.
	readonly status?: ProductStatus
	// Master.
	readonly masterId?: string
}

// One page of a listing.
export interface Page<T> {
	// Rows.
	readonly items: readonly T[]
	// Rows matching the filter.
	readonly total: number
}

// Identity of a group, with the frames that make it.
export interface StoredGroup {
	// Id of the group.
	readonly groupId: string
	// Its frames.
	readonly sources: readonly CalibrationSource[]
}

// Revision whose publication or deletion a crash may have interrupted.
export interface PendingRevision {
	// The revision as it was recorded.
	readonly master: CalibrationMaster
	// Which half is unfinished.
	readonly publication: Exclude<RevisionPublication, 'published'>
}

// Returns the part of a path after its last separator, for either platform.
export function fileNameOf(path: string) {
	return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

// Removes the server path of a frame.
export function sourceSummary({ path, ...source }: CalibrationSource): CalibrationSourceSummary {
	return { ...source, name: fileNameOf(path) }
}

// Row of calibration_sources.
interface SourceRow {
	readonly source_id: string
	readonly group_id: string
	readonly key: string
	readonly kind: CalibrationKind
	readonly status: SourceStatus
	readonly origin: SourceOrigin
	readonly origin_id: string | null
	readonly path: string
	readonly format: SourceFormat
	readonly bytes: number
	readonly mtime_ms: number
	readonly digest: string | null
	readonly excluded_reason: string | null
	readonly required: number | null
	readonly supported: number
	readonly metadata: string
	readonly warnings: string
}

// Columns of calibration_sources read into a CalibrationSource.
const SOURCE_COLUMNS = 'source_id, group_id, key, kind, status, origin, origin_id, path, format, bytes, mtime_ms, digest, excluded_reason, required, supported, metadata, warnings'

// Returns the frame of a row.
function rowSource(row: SourceRow): CalibrationSource {
	return {
		sourceId: row.source_id,
		origin: row.origin,
		...(row.origin_id !== null && { originId: row.origin_id }),
		kind: row.kind,
		path: row.path,
		format: row.format,
		bytes: row.bytes,
		mtimeMillis: row.mtime_ms,
		...(row.digest !== null && { digest: row.digest }),
		metadata: JSON.parse(row.metadata) as CalibrationMetadata,
		warnings: JSON.parse(row.warnings) as string[],
		status: row.status,
		...(row.excluded_reason !== null && { excluded: row.excluded_reason }),
		...(row.required !== null && { required: row.required }),
		supported: row.supported === 1,
		key: row.key,
		groupId: row.group_id,
	}
}

// What calibration_revisions keeps of a master as JSON.
type MasterContent = Pick<CalibrationMaster, 'calibrationState' | 'units' | 'usage' | 'fullScaleDn' | 'recipe' | 'metadata' | 'diagnostics' | 'acknowledged'>

// Row of calibration_revisions.
interface RevisionRow {
	readonly master_id: string
	readonly revision: number
	readonly publication: RevisionPublication
	readonly status: ProductStatus
	readonly kind: CalibrationKind
	readonly group_id: string
	readonly key: string
	readonly fingerprint: string
	readonly created_at: number
	readonly content_digest: string
	readonly bytes: number
	readonly master: string
}

// Columns of calibration_revisions read into a CalibrationMaster.
const REVISION_COLUMNS = 'master_id, revision, publication, status, kind, group_id, key, fingerprint, created_at, content_digest, bytes, master'

// Row of calibration_revision_sources.
interface RevisionSourceRow {
	readonly source_id: string
	readonly digest: string
	readonly name: string
}

// Row of calibration_revision_dependencies.
interface RevisionDependencyRow {
	readonly dependency_master_id: string
	readonly dependency_revision: number
	readonly digest: string
}

// Frames and masters of the library in the operational database, and the directories of its files.
export class CalibrationLibraryStore {
	// Creates the store of the rows of database and the files under directory.
	constructor(
		readonly database: AppDatabase,
		readonly directory: string = DEFAULT_CALIBRATION_LIBRARY_DIRECTORY,
	) {}

	// Directory of every master.
	get productsDirectory() {
		return join(this.directory, 'products')
	}

	// Directory the revision directories without a row are moved to; nothing is ever deleted from it.
	get orphanedDirectory() {
		return join(this.directory, 'orphaned')
	}

	// Directory of the work of a job, on the filesystem of the products so publishing is a rename.
	stagingDirectory(jobId: string) {
		return join(this.directory, 'staging', jobId)
	}

	// Directory of the copies of an import.
	sourcesDirectory(importId: string) {
		return join(this.directory, 'sources', importId)
	}

	// Directory of a revision.
	revisionDirectory(masterId: string, revision: number) {
		return join(this.productsDirectory, masterId, `v${String(revision).padStart(4, '0')}`)
	}

	// Writes frames in one transaction.
	putSources(sources: readonly CalibrationSource[]) {
		if (sources.length === 0) return
		this.database.write(() => this.#putSources(sources))
	}

	// Writes frames in the transaction of the caller.
	#putSources(sources: readonly CalibrationSource[]) {
		const statement = this.database.db.query(`INSERT OR REPLACE INTO calibration_sources (${SOURCE_COLUMNS}, camera_id, name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)

		for (const source of sources) {
			statement.run(
				source.sourceId,
				source.groupId,
				source.key,
				source.kind,
				source.status,
				source.origin,
				source.originId ?? null,
				source.path,
				source.format,
				source.bytes,
				source.mtimeMillis,
				source.digest ?? null,
				source.excluded ?? null,
				source.required ?? null,
				source.supported ? 1 : 0,
				JSON.stringify(source.metadata),
				JSON.stringify(source.warnings),
				source.metadata.cameraId.value ?? '',
				fileNameOf(source.path).toLowerCase(),
			)
		}
	}

	// Forgets frames in one transaction.
	removeSources(sourceIds: readonly string[]) {
		if (sourceIds.length === 0) return
		this.database.write(() => {
			const statement = this.database.db.query('DELETE FROM calibration_sources WHERE source_id = ?')
			for (const sourceId of sourceIds) statement.run(sourceId)
		})
	}

	// Returns a frame.
	source(sourceId: string) {
		const row = this.database.db.query<SourceRow, [string]>(`SELECT ${SOURCE_COLUMNS} FROM calibration_sources WHERE source_id = ?`).get(sourceId)
		return row ? rowSource(row) : undefined
	}

	// Returns frames by id, in the order given, leaving out unknown ids.
	sourcesById(sourceIds: readonly string[]) {
		return sourceIds.flatMap((sourceId) => this.source(sourceId) ?? [])
	}

	// Lists every frame of an origin, or every frame, for refreshes.
	sourcesOf(origin?: SourceOrigin) {
		const { db } = this.database
		const rows = origin === undefined ? db.query<SourceRow, []>(`SELECT ${SOURCE_COLUMNS} FROM calibration_sources`).all() : db.query<SourceRow, [string]>(`SELECT ${SOURCE_COLUMNS} FROM calibration_sources WHERE origin = ?`).all(origin)
		return rows.map(rowSource)
	}

	// Lists frames by file name within a filter, by page.
	sources(filter: SourceFilter, offset: number, limit: number): Page<CalibrationSource> {
		const { where, values } = sourceWhere(filter)
		const { db } = this.database
		const { total } = db.query<{ total: number }, string[]>(`SELECT COUNT(*) AS total FROM calibration_sources ${where}`).get(...values)!
		const rows = db.query<SourceRow, (string | number)[]>(`SELECT ${SOURCE_COLUMNS} FROM calibration_sources ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset)
		return { items: rows.map(rowSource), total }
	}

	// Lists groups by page, each with all its frames.
	groups(filter: SourceFilter, offset: number, limit: number): Page<StoredGroup> {
		const { where, values } = sourceWhere(filter)
		const { db } = this.database
		const { total } = db.query<{ total: number }, string[]>(`SELECT COUNT(DISTINCT group_id) AS total FROM calibration_sources ${where}`).get(...values)!
		const rows = db.query<{ group_id: string }, (string | number)[]>(`SELECT DISTINCT group_id FROM calibration_sources ${where} ORDER BY kind, camera_id, group_id LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset)
		return { items: rows.map((row) => this.group(row.group_id)), total }
	}

	// Returns a group with all its frames; an unknown group has none.
	group(groupId: string): StoredGroup {
		const rows = this.database.db.query<SourceRow, [string]>(`SELECT ${SOURCE_COLUMNS} FROM calibration_sources WHERE group_id = ? ORDER BY name`).all(groupId)
		return { groupId, sources: rows.map(rowSource) }
	}

	// Counts frames and published masters by state, and lists the cameras the filters of the tool can take.
	counts() {
		const { db } = this.database
		const sources = db.query<{ kind: CalibrationKind; status: SourceStatus; count: number }, []>('SELECT kind, status, COUNT(*) AS count FROM calibration_sources GROUP BY kind, status').all()
		const masters = db.query<{ kind: CalibrationKind; status: ProductStatus; count: number }, []>("SELECT kind, status, COUNT(*) AS count FROM calibration_revisions WHERE publication = 'published' GROUP BY kind, status").all()
		const cameras = db.query<CalibrationCamera, []>("SELECT camera_id AS id, MAX(json_extract(metadata, '$.cameraName')) AS name FROM calibration_sources WHERE camera_id <> '' GROUP BY camera_id ORDER BY name, camera_id").all()
		return { sources, masters, cameras }
	}

	// Returns the master of a revision row, with its frames and dependencies.
	#master(row: RevisionRow): CalibrationMaster {
		const { db } = this.database
		const sources = db.query<RevisionSourceRow, [string, number]>('SELECT source_id, digest, name FROM calibration_revision_sources WHERE master_id = ? AND revision = ? ORDER BY position').all(row.master_id, row.revision)
		const dependencies = db.query<RevisionDependencyRow, [string, number]>('SELECT dependency_master_id, dependency_revision, digest FROM calibration_revision_dependencies WHERE master_id = ? AND revision = ? ORDER BY position').all(row.master_id, row.revision)
		const content = JSON.parse(row.master) as MasterContent

		return {
			masterId: row.master_id,
			revision: row.revision,
			kind: row.kind,
			calibrationState: content.calibrationState,
			units: content.units,
			usage: content.usage,
			fullScaleDn: content.fullScaleDn,
			sourceIds: sources.map(({ source_id }) => source_id),
			sourceDigests: sources.map(({ digest }) => digest),
			sourceNames: sources.map(({ name }) => name),
			dependencies: dependencies.map(({ dependency_master_id, dependency_revision, digest }) => ({ masterId: dependency_master_id, revision: dependency_revision, digest })),
			recipe: content.recipe,
			fingerprint: row.fingerprint,
			metadata: content.metadata,
			key: row.key,
			groupId: row.group_id,
			diagnostics: content.diagnostics,
			acknowledged: content.acknowledged,
			contentDigest: row.content_digest,
			bytes: row.bytes,
			createdAt: row.created_at,
			status: row.status,
		}
	}

	// Returns a published revision.
	master(masterId: string, revision: number) {
		const row = this.database.db.query<RevisionRow, [string, number]>(`SELECT ${REVISION_COLUMNS} FROM calibration_revisions WHERE master_id = ? AND revision = ? AND publication = 'published'`).get(masterId, revision)
		return row ? this.#master(row) : undefined
	}

	// Returns the published revision with a fingerprint, which a repeated request answers with.
	masterByFingerprint(fingerprint: string) {
		const row = this.database.db.query<RevisionRow, [string]>(`SELECT ${REVISION_COLUMNS} FROM calibration_revisions WHERE fingerprint = ? AND publication = 'published' ORDER BY revision DESC`).get(fingerprint)
		return row ? this.#master(row) : undefined
	}

	// Lists published revisions newest first, by page.
	masters(filter: MasterFilter, offset: number, limit: number): Page<CalibrationMaster> {
		const clauses = ["publication = 'published'"]
		const values: string[] = []

		function add(clause: string, value: string) {
			clauses.push(clause)
			values.push(value)
		}

		if (filter.kind !== undefined) add('kind = ?', filter.kind)
		if (filter.camera !== undefined) add('camera_id = ?', filter.camera)
		if (filter.filter !== undefined) add('filter = ?', filter.filter)
		if (filter.status !== undefined) add('status = ?', filter.status)
		if (filter.masterId !== undefined) add('master_id = ?', filter.masterId)

		const where = `WHERE ${clauses.join(' AND ')}`
		const { db } = this.database
		const { total } = db.query<{ total: number }, string[]>(`SELECT COUNT(*) AS total FROM calibration_revisions ${where}`).get(...values)!
		const rows = db.query<RevisionRow, (string | number)[]>(`SELECT ${REVISION_COLUMNS} FROM calibration_revisions ${where} ORDER BY created_at DESC, revision DESC LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset)
		return { items: rows.map((row) => this.#master(row)), total }
	}

	// Lists every published revision, for reconciliation.
	allMasters() {
		return this.database.db
			.query<RevisionRow, []>(`SELECT ${REVISION_COLUMNS} FROM calibration_revisions WHERE publication = 'published'`)
			.all()
			.map((row) => this.#master(row))
	}

	// Lists the revisions whose publication or deletion did not finish.
	pending(): PendingRevision[] {
		return this.database.db
			.query<RevisionRow, []>(`SELECT ${REVISION_COLUMNS} FROM calibration_revisions WHERE publication <> 'published'`)
			.all()
			.map((row) => ({ master: this.#master(row), publication: row.publication as PendingRevision['publication'] }))
	}

	// Returns whether a row exists for a revision, whatever its publication.
	hasRevision(masterId: string, revision: number) {
		return this.database.db.query('SELECT 1 FROM calibration_revisions WHERE master_id = ? AND revision = ?').get(masterId, revision) !== null
	}

	// Takes the next revision number of a master, never used before, and records the revision as publishing. Returns it
	// with its number.
	beginPublication(master: Omit<CalibrationMaster, 'revision'>): CalibrationMaster {
		return this.database.write(() => {
			const { db } = this.database
			const { revision } = db.query<{ revision: number }, [string]>('INSERT INTO calibration_masters (master_id, last_revision) VALUES (?, 1) ON CONFLICT (master_id) DO UPDATE SET last_revision = last_revision + 1 RETURNING last_revision AS revision').get(master.masterId)!
			const published: CalibrationMaster = { ...master, revision }
			const { calibrationState, units, usage, fullScaleDn, recipe, metadata, diagnostics, acknowledged } = published
			const content: MasterContent = { calibrationState, units, usage, fullScaleDn, recipe, metadata, diagnostics, acknowledged }
			const status = published.status === 'warning' ? 'warning' : 'ready'

			db.query("INSERT INTO calibration_revisions (master_id, revision, publication, status, published_status, kind, camera_id, filter, group_id, key, fingerprint, created_at, content_digest, bytes, master) VALUES (?, ?, 'publishing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
				master.masterId,
				revision,
				status,
				status,
				master.kind,
				metadata.cameraId.value ?? '',
				metadata.filter.value ?? '',
				master.groupId,
				master.key,
				master.fingerprint,
				master.createdAt,
				master.contentDigest,
				master.bytes,
				JSON.stringify(content),
			)

			const source = db.query('INSERT INTO calibration_revision_sources (master_id, revision, position, source_id, digest, name) VALUES (?, ?, ?, ?, ?, ?)')
			for (const [position, sourceId] of master.sourceIds.entries()) source.run(master.masterId, revision, position, sourceId, master.sourceDigests[position], master.sourceNames[position])
			const dependency = db.query('INSERT INTO calibration_revision_dependencies (master_id, revision, position, dependency_master_id, dependency_revision, digest) VALUES (?, ?, ?, ?, ?, ?)')
			for (const [position, reference] of master.dependencies.entries()) dependency.run(master.masterId, revision, position, reference.masterId, reference.revision, reference.digest)

			return published
		})
	}

	// Makes a revision whose directory is in products/ published, and records the digests its job read on its frames.
	completePublication(masterId: string, revision: number, sources: readonly CalibrationSource[]) {
		this.database.write(() => {
			this.database.db.query("UPDATE calibration_revisions SET publication = 'published' WHERE master_id = ? AND revision = ?").run(masterId, revision)
			this.#putSources(sources)
		})
	}

	// Forgets a revision whose publication failed or whose deletion finished, with its preference; its number stays taken.
	discardRevision(masterId: string, revision: number) {
		this.database.write(() => this.database.db.query('DELETE FROM calibration_revisions WHERE master_id = ? AND revision = ?').run(masterId, revision))
	}

	// Returns whether another revision was corrected with a revision.
	isDependency(masterId: string, revision: number) {
		return this.database.db.query('SELECT 1 FROM calibration_revision_dependencies WHERE dependency_master_id = ? AND dependency_revision = ?').get(masterId, revision) !== null
	}

	// Records that the directory of a published revision is being deleted, which hides it, or that it was not after all.
	setDeleting(masterId: string, revision: number, deleting: boolean) {
		this.database.write(() => this.database.db.query('UPDATE calibration_revisions SET publication = ? WHERE master_id = ? AND revision = ?').run(deleting ? 'deleting' : 'published', masterId, revision))
	}

	// Changes the state of revisions in one transaction: unavailable, stale, or what they were published with.
	setStatuses(changes: readonly { readonly masterId: string; readonly revision: number; readonly status: ProductStatus | 'published' }[]) {
		if (changes.length === 0) return
		this.database.write(() => {
			const statement = this.database.db.query("UPDATE calibration_revisions SET status = CASE WHEN ?1 = 'published' THEN published_status ELSE ?1 END WHERE master_id = ?2 AND revision = ?3")
			for (const { masterId, revision, status } of changes) statement.run(status, masterId, revision)
		})
	}

	// Makes a revision the preferred one of its master.
	setPreferred(masterId: string, revision: number) {
		this.database.write(() => this.database.db.query('INSERT OR REPLACE INTO calibration_preferred (master_id, revision) VALUES (?, ?)').run(masterId, revision))
	}

	// Returns the preferred revision of a master.
	preferred(masterId: string) {
		return this.database.db.query<{ revision: number }, [string]>('SELECT revision FROM calibration_preferred WHERE master_id = ?').get(masterId)?.revision
	}

	// Lists the revision directories under products/, as master id and revision number; a directory whose name is not a
	// revision is left out.
	async productDirectories() {
		const directories: { readonly masterId: string; readonly revision: number; readonly name: string }[] = []

		for (const masterId of await directoryNames(this.productsDirectory)) {
			for (const name of await directoryNames(join(this.productsDirectory, masterId))) {
				const revision = /^v(\d+)$/.exec(name)?.[1]
				directories.push({ masterId, revision: revision === undefined ? 0 : Number(revision), name })
			}
		}

		return directories
	}

	// Removes every staged work, which no job of a new process owns.
	async removeStaging() {
		await rm(join(this.directory, 'staging'), { recursive: true, force: true })
	}

	// Creates the staging directory of a job.
	async createStaging(jobId: string) {
		const directory = this.stagingDirectory(jobId)
		await mkdir(directory, { recursive: true })
		return directory
	}
}

// Builds the WHERE clause of a frame filter.
function sourceWhere(filter: SourceFilter) {
	const clauses: string[] = []
	const values: string[] = []

	function add(clause: string, value: string) {
		clauses.push(clause)
		values.push(value)
	}

	if (filter.kind !== undefined) add('kind = ?', filter.kind)
	if (filter.camera !== undefined) add('camera_id = ?', filter.camera)
	if (filter.status !== undefined) add('status = ?', filter.status)
	if (filter.groupId !== undefined) add('group_id = ?', filter.groupId)
	if (filter.search !== undefined) add('name LIKE ?', `%${filter.search.toLowerCase()}%`)

	return { where: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '', values }
}

// Lists the names of the subdirectories of a directory, none when it is missing.
async function directoryNames(directory: string) {
	try {
		return (await readdir(directory, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name)
	} catch (error) {
		if (errorCode(error) === 'ENOENT') return []
		throw error
	}
}
