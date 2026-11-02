import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { mkdir, open, readdir, readFile, rm } from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'
import type { ImportCandidate } from './calibrationlibrary'
import type { CalibrationKind, CalibrationMetadata, CalibrationRecipe, CompatibilityFinding, MasterReference, OverridableField } from './calibrationlibrary.compatibility'
import type { CalibrationJob } from './calibrationlibrary.jobs'
import { errorCode, isRecord, writeAtomically } from './util'

// Persistence of the Calibration Library, in three layers with different duties. Masters are immutable directories with
// their FITS file and a manifest that explains them without any index. Facts only an operator or a wizard can state
// (imported frames, registered flats, overrides, exclusions, preferred revisions, deletions) go to a synced journal. catalog.sqlite
// is a derived index of both and of the Dark Library plans, plus the job queue, so it can be deleted at any time: a
// different schema version discards and rebuilds it, and there are no migrations. Only a newer version is left alone,
// because older code must not destroy what newer code wrote. Calibration frames are referenced, never copied here
// unless an import asks for it, and nothing in this file touches a frame, a plan, or a journal of the Dark Library.

// Version of the schema of the catalog. A change rebuilds the catalog from the journal, the manifests, and the plans.
const CATALOG_VERSION = 2

// Version of the format of the manifests and of the journal.
export const MANIFEST_VERSION = 1

// Default directory of the library.
export const DEFAULT_CALIBRATION_LIBRARY_DIRECTORY = join(homedir(), 'Nebulosa', 'calibration-library')

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
// - stale: a dependency or a source changed after it was published; it still is what its manifest says.
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
	// File names of the sources, so a manifest explains itself without the catalog.
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

// Manifest next to a master, which holds the whole master record.
export interface MasterManifest extends CalibrationMaster {
	// Version of the format.
	readonly version: number
}

// Name of the FITS file of a revision.
export const MASTER_FILE = 'master.fit'

// Name of the manifest of a revision.
export const MANIFEST_FILE = 'manifest.json'

// Record of the journal of the library. Each one states a fact nothing else can recover.
export type CalibrationJournalRecord =
	// A frame of a wizard or an import, with what was known about it then.
	| { readonly type: 'source'; readonly at: number; readonly source: CalibrationSource }
	// An audited value of a frame.
	| { readonly type: 'override'; readonly at: number; readonly sourceId: string; readonly field: OverridableField; readonly value: string | number; readonly reason: string }
	// An audited role of a frame.
	| { readonly type: 'classification'; readonly at: number; readonly sourceId: string; readonly kind: CalibrationKind; readonly reason: string }
	// A frame an operator left out, or brought back when reason is absent.
	| { readonly type: 'exclusion'; readonly at: number; readonly sourceId: string; readonly reason?: string }
	// The revision an operator prefers.
	| { readonly type: 'preferred'; readonly at: number; readonly masterId: string; readonly revision: number }
	// A frame an operator deleted with its file.
	| { readonly type: 'removal'; readonly at: number; readonly sourceId: string }
	// A revision an operator deleted with its directory; its number is never used again.
	| { readonly type: 'masterRemoval'; readonly at: number; readonly masterId: string; readonly revision: number }

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

// Row of a stored document.
interface DataRow {
	readonly data: string
}

// Schema of the catalog. Each table keeps its record as JSON, with only what queries filter on as columns.
const CATALOG_SCHEMA = `
CREATE TABLE sources (source_id TEXT PRIMARY KEY, group_id TEXT NOT NULL, kind TEXT NOT NULL, camera TEXT NOT NULL, status TEXT NOT NULL, name TEXT NOT NULL, data TEXT NOT NULL);
CREATE INDEX sources_group ON sources (group_id);
CREATE INDEX sources_filter ON sources (kind, camera, status);
CREATE TABLE masters (master_id TEXT NOT NULL, revision INTEGER NOT NULL, kind TEXT NOT NULL, camera TEXT NOT NULL, filter TEXT NOT NULL, status TEXT NOT NULL, fingerprint TEXT NOT NULL, created_at INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (master_id, revision));
CREATE INDEX masters_fingerprint ON masters (fingerprint);
CREATE TABLE preferred (master_id TEXT PRIMARY KEY, revision INTEGER NOT NULL);
CREATE TABLE removed_masters (master_id TEXT NOT NULL, revision INTEGER NOT NULL, PRIMARY KEY (master_id, revision));
CREATE TABLE jobs (job_id TEXT PRIMARY KEY, state TEXT NOT NULL, fingerprint TEXT, token TEXT, created_at INTEGER NOT NULL, data TEXT NOT NULL);
CREATE INDEX jobs_state ON jobs (state);
CREATE INDEX jobs_token ON jobs (token);
CREATE TABLE candidates (job_id TEXT NOT NULL, position INTEGER NOT NULL, path TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (job_id, position));
`

// Returns the part of a path after its last separator, for either platform.
export function fileNameOf(path: string) {
	return path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1)
}

// Removes the server path of a frame.
export function sourceSummary({ path, ...source }: CalibrationSource): CalibrationSourceSummary {
	return { ...source, name: fileNameOf(path) }
}

// Parses a journal, leaving out a last line a crash tore; an unreadable line elsewhere is lost on its own.
export function parseCalibrationJournal(text: string): CalibrationJournalRecord[] {
	const records: CalibrationJournalRecord[] = []

	for (const line of text.split('\n')) {
		if (line.length === 0) continue

		try {
			const record: unknown = JSON.parse(line)
			if (isRecord(record) && typeof record.type === 'string') records.push(record as unknown as CalibrationJournalRecord)
		} catch {
			continue
		}
	}

	return records
}

// Files of the library, and its catalog. Every read and write of the catalog is synchronous and short; a caller that
// changes many rows passes them together, so one transaction covers them.
export class CalibrationLibraryStore {
	// Open catalog.
	#database?: Database
	// Whether a newer version wrote the catalog.
	#newer = false

	// Creates the store of a directory, opening nothing until open.
	constructor(readonly directory: string = DEFAULT_CALIBRATION_LIBRARY_DIRECTORY) {}

	// Directory of the catalog file.
	get #catalogFile() {
		return join(this.directory, 'catalog.sqlite')
	}

	// Journal of the operator's facts.
	get #journalFile() {
		return join(this.directory, 'journal.jsonl')
	}

	// Directory of every master.
	get productsDirectory() {
		return join(this.directory, 'products')
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

	// Whether a newer version owns the catalog, which then stays closed and untouched.
	get newerVersion() {
		return this.#newer
	}

	// The open catalog. Throws before open.
	get #db() {
		if (!this.#database) throw new Error('The calibration library is not open')
		return this.#database
	}

	// Opens the catalog and returns whether it starts empty and must be rebuilt: a new one, or one of another version.
	// A file that is not a database is replaced, because everything in it can be derived again.
	open() {
		if (this.#database) return false
		mkdirSync(this.directory, { recursive: true })
		const existed = existsSync(this.#catalogFile)

		let database: Database

		try {
			database = this.#connect()
			const version = (database.query('PRAGMA user_version').get() as { readonly user_version: number }).user_version

			if (version > CATALOG_VERSION) {
				database.close()
				this.#newer = true
				return false
			}

			if (existed && version === CATALOG_VERSION) {
				this.#database = database
				return false
			}

			database.close()
		} catch (error) {
			if (errorCode(error) === 'EBUSY') throw error
		}

		this.#remove()
		database = this.#connect()
		database.run(CATALOG_SCHEMA)
		database.run(`PRAGMA user_version = ${CATALOG_VERSION}`)
		this.#database = database
		return true
	}

	// Opens the database file with a write-ahead log, so reads never wait for a long batch.
	#connect() {
		const database = new Database(this.#catalogFile, { create: true, strict: true })
		database.run('PRAGMA journal_mode = WAL')
		database.run('PRAGMA synchronous = NORMAL')
		return database
	}

	// Deletes the files of the catalog.
	#remove() {
		for (const suffix of ['', '-wal', '-shm']) rmSync(`${this.#catalogFile}${suffix}`, { force: true })
	}

	// Closes the catalog, which releases its files.
	close() {
		this.#database?.close()
		this.#database = undefined
	}

	// Reads the journal; a missing file is an empty one.
	async journal() {
		try {
			return parseCalibrationJournal(await readFile(this.#journalFile, 'utf8'))
		} catch (error) {
			if (errorCode(error) === 'ENOENT') return []
			throw error
		}
	}

	// Appends records to the journal, synced to the disk. Throws when they cannot be written; the caller then changes nothing.
	async append(records: readonly CalibrationJournalRecord[]) {
		if (records.length === 0) return
		const handle = await open(this.#journalFile, 'a')

		try {
			await handle.appendFile(records.map((record) => `${JSON.stringify(record)}\n`).join(''))
			await handle.sync()
		} finally {
			await handle.close()
		}
	}

	// Writes frames in one transaction.
	putSources(sources: readonly CalibrationSource[]) {
		const statement = this.#db.query('INSERT OR REPLACE INTO sources (source_id, group_id, kind, camera, status, name, data) VALUES (?, ?, ?, ?, ?, ?, ?)')
		this.#db.transaction(() => {
			for (const source of sources) statement.run(source.sourceId, source.groupId, source.kind, source.metadata.cameraId.value ?? '', source.status, fileNameOf(source.path).toLowerCase(), JSON.stringify(source))
		})()
	}

	// Forgets frames in one transaction.
	removeSources(sourceIds: readonly string[]) {
		const statement = this.#db.query('DELETE FROM sources WHERE source_id = ?')
		this.#db.transaction(() => {
			for (const sourceId of sourceIds) statement.run(sourceId)
		})()
	}

	// Returns a frame.
	source(sourceId: string) {
		const row = this.#db.query('SELECT data FROM sources WHERE source_id = ?').get(sourceId) as DataRow | null
		return row ? (JSON.parse(row.data) as CalibrationSource) : undefined
	}

	// Returns frames by id, in the order given, leaving out unknown ids.
	sourcesById(sourceIds: readonly string[]) {
		return sourceIds.flatMap((sourceId) => this.source(sourceId) ?? [])
	}

	// Lists every frame of an origin, for refreshes.
	sourcesOf(origin?: SourceOrigin) {
		const rows = this.#db.query('SELECT data FROM sources').all() as DataRow[]
		const sources = rows.map((row) => JSON.parse(row.data) as CalibrationSource)
		return origin === undefined ? sources : sources.filter((source) => source.origin === origin)
	}

	// Lists frames newest name first within a filter, by page.
	sources(filter: SourceFilter, offset: number, limit: number): Page<CalibrationSource> {
		const { where, values } = sourceWhere(filter)
		const { total } = this.#db.query(`SELECT COUNT(*) AS total FROM sources ${where}`).get(...values) as { readonly total: number }
		const rows = this.#db.query(`SELECT data FROM sources ${where} ORDER BY name LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset) as DataRow[]
		return { items: rows.map((row) => JSON.parse(row.data) as CalibrationSource), total }
	}

	// Lists groups by page, each with all its frames.
	groups(filter: SourceFilter, offset: number, limit: number): Page<StoredGroup> {
		const { where, values } = sourceWhere(filter)
		const { total } = this.#db.query(`SELECT COUNT(DISTINCT group_id) AS total FROM sources ${where}`).get(...values) as { readonly total: number }
		const rows = this.#db.query(`SELECT DISTINCT group_id FROM sources ${where} ORDER BY kind, camera, group_id LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset) as { readonly group_id: string }[]
		return { items: rows.map((row) => this.group(row.group_id)), total }
	}

	// Returns a group with all its frames; an unknown group has none.
	group(groupId: string): StoredGroup {
		const rows = this.#db.query('SELECT data FROM sources WHERE group_id = ? ORDER BY name').all(groupId) as DataRow[]
		return { groupId, sources: rows.map((row) => JSON.parse(row.data) as CalibrationSource) }
	}

	// Counts frames and masters by state, and lists the values the filters of the tool can take.
	counts() {
		const sources = this.#db.query('SELECT kind, status, COUNT(*) AS count FROM sources GROUP BY kind, status').all() as { readonly kind: CalibrationKind; readonly status: SourceStatus; readonly count: number }[]
		const masters = this.#db.query('SELECT kind, status, COUNT(*) AS count FROM masters GROUP BY kind, status').all() as { readonly kind: CalibrationKind; readonly status: ProductStatus; readonly count: number }[]
		const cameras = this.#db.query("SELECT camera AS id, MAX(json_extract(data, '$.metadata.cameraName')) AS name FROM sources WHERE camera <> '' GROUP BY camera ORDER BY name, camera").all() as CalibrationCamera[]
		return { sources, masters, cameras }
	}

	// Records a published revision.
	putMaster(master: CalibrationMaster) {
		this.#db
			.query('INSERT OR REPLACE INTO masters (master_id, revision, kind, camera, filter, status, fingerprint, created_at, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
			.run(master.masterId, master.revision, master.kind, master.metadata.cameraId.value ?? '', master.metadata.filter.value ?? '', master.status, master.fingerprint, master.createdAt, JSON.stringify(master))
	}

	// Returns a revision.
	master(masterId: string, revision: number) {
		const row = this.#db.query('SELECT data FROM masters WHERE master_id = ? AND revision = ?').get(masterId, revision) as DataRow | null
		return row ? (JSON.parse(row.data) as CalibrationMaster) : undefined
	}

	// Returns the published revision with a fingerprint, which a repeated request answers with.
	masterByFingerprint(fingerprint: string) {
		const row = this.#db.query('SELECT data FROM masters WHERE fingerprint = ? ORDER BY revision DESC').get(fingerprint) as DataRow | null
		return row ? (JSON.parse(row.data) as CalibrationMaster) : undefined
	}

	// Returns the highest revision a master ever had, deleted ones included, 0 before the first.
	latestRevision(masterId: string) {
		return (this.#db.query('SELECT MAX(revision) AS revision FROM (SELECT revision FROM masters WHERE master_id = ?1 UNION ALL SELECT revision FROM removed_masters WHERE master_id = ?1)').get(masterId) as { readonly revision: number | null }).revision ?? 0
	}

	// Forgets a revision, and its preference, keeping its number taken.
	removeMaster(masterId: string, revision: number) {
		this.#db.transaction(() => {
			this.#db.query('DELETE FROM masters WHERE master_id = ? AND revision = ?').run(masterId, revision)
			this.#db.query('DELETE FROM preferred WHERE master_id = ? AND revision = ?').run(masterId, revision)
			this.#db.query('INSERT OR IGNORE INTO removed_masters (master_id, revision) VALUES (?, ?)').run(masterId, revision)
		})()
	}

	// Lists revisions newest first, by page.
	masters(filter: MasterFilter, offset: number, limit: number): Page<CalibrationMaster> {
		const clauses: string[] = []
		const values: string[] = []

		function add(clause: string, value: string) {
			clauses.push(clause)
			values.push(value)
		}

		if (filter.kind !== undefined) add('kind = ?', filter.kind)
		if (filter.camera !== undefined) add('camera = ?', filter.camera)
		if (filter.filter !== undefined) add('filter = ?', filter.filter)
		if (filter.status !== undefined) add('status = ?', filter.status)
		if (filter.masterId !== undefined) add('master_id = ?', filter.masterId)

		const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''
		const { total } = this.#db.query(`SELECT COUNT(*) AS total FROM masters ${where}`).get(...values) as { readonly total: number }
		const rows = this.#db.query(`SELECT data FROM masters ${where} ORDER BY created_at DESC, revision DESC LIMIT ? OFFSET ?`).all(...values, Math.min(limit, MAX_PAGE_SIZE), offset) as DataRow[]
		return { items: rows.map((row) => JSON.parse(row.data) as CalibrationMaster), total }
	}

	// Lists every revision, for reconciliation.
	allMasters() {
		const rows = this.#db.query('SELECT data FROM masters').all() as DataRow[]
		return rows.map((row) => JSON.parse(row.data) as CalibrationMaster)
	}

	// Makes a revision the preferred one of its master.
	setPreferred(masterId: string, revision: number) {
		this.#db.query('INSERT OR REPLACE INTO preferred (master_id, revision) VALUES (?, ?)').run(masterId, revision)
	}

	// Returns the preferred revision of a master.
	preferred(masterId: string) {
		return (this.#db.query('SELECT revision FROM preferred WHERE master_id = ?').get(masterId) as { readonly revision: number } | null)?.revision
	}

	// Writes a job.
	putJob(job: CalibrationJob) {
		this.#db.query('INSERT OR REPLACE INTO jobs (job_id, state, fingerprint, token, created_at, data) VALUES (?, ?, ?, ?, ?, ?)').run(job.jobId, job.state, job.fingerprint ?? null, job.token ?? null, job.createdAt, JSON.stringify(job))
	}

	// Returns a job.
	job(jobId: string) {
		const row = this.#db.query('SELECT data FROM jobs WHERE job_id = ?').get(jobId) as DataRow | null
		return row ? (JSON.parse(row.data) as CalibrationJob) : undefined
	}

	// Returns the job a request token created.
	jobByToken(token: string) {
		const row = this.#db.query('SELECT data FROM jobs WHERE token = ?').get(token) as DataRow | null
		return row ? (JSON.parse(row.data) as CalibrationJob) : undefined
	}

	// Lists jobs in some states, oldest first.
	jobsIn(states: readonly string[]) {
		const rows = this.#db.query(`SELECT data FROM jobs WHERE state IN (${states.map(() => '?').join(', ')}) ORDER BY created_at`).all(...states) as DataRow[]
		return rows.map((row) => JSON.parse(row.data) as CalibrationJob)
	}

	// Lists jobs newest first, by page.
	jobs(offset: number, limit: number): Page<CalibrationJob> {
		const { total } = this.#db.query('SELECT COUNT(*) AS total FROM jobs').get() as { readonly total: number }
		const rows = this.#db.query('SELECT data FROM jobs ORDER BY created_at DESC LIMIT ? OFFSET ?').all(Math.min(limit, MAX_PAGE_SIZE), offset) as DataRow[]
		return { items: rows.map((row) => JSON.parse(row.data) as CalibrationJob), total }
	}

	// Replaces the files found by an import.
	putCandidates(jobId: string, candidates: readonly ImportCandidate[]) {
		const statement = this.#db.query('INSERT INTO candidates (job_id, position, path, data) VALUES (?, ?, ?, ?)')
		this.#db.transaction(() => {
			this.#db.query('DELETE FROM candidates WHERE job_id = ?').run(jobId)
			for (const [position, candidate] of candidates.entries()) statement.run(jobId, position, candidate.path, JSON.stringify(candidate))
		})()
	}

	// Lists files found by an import, by page.
	candidates(jobId: string, offset: number, limit: number): Page<ImportCandidate> {
		const { total } = this.#db.query('SELECT COUNT(*) AS total FROM candidates WHERE job_id = ?').get(jobId) as { readonly total: number }
		const rows = this.#db.query('SELECT data FROM candidates WHERE job_id = ? ORDER BY position LIMIT ? OFFSET ?').all(jobId, Math.min(limit, MAX_PAGE_SIZE), offset) as DataRow[]
		return { items: rows.map((row) => JSON.parse(row.data) as ImportCandidate), total }
	}

	// Returns every file an import found.
	allCandidates(jobId: string) {
		const rows = this.#db.query('SELECT data FROM candidates WHERE job_id = ? ORDER BY position').all(jobId) as DataRow[]
		return rows.map((row) => JSON.parse(row.data) as ImportCandidate)
	}

	// Forgets the files an import found, once it was committed or cancelled.
	dropCandidates(jobId: string) {
		this.#db.query('DELETE FROM candidates WHERE job_id = ?').run(jobId)
	}

	// Reads every manifest on disk, leaving out unreadable ones, which stay where they are. Used to rebuild and reconcile.
	async manifests() {
		const manifests: MasterManifest[] = []

		for (const masterId of await directoryNames(this.productsDirectory)) {
			for (const revision of await directoryNames(join(this.productsDirectory, masterId))) {
				try {
					const manifest: unknown = JSON.parse(await readFile(join(this.productsDirectory, masterId, revision, MANIFEST_FILE), 'utf8'))
					if (isRecord(manifest) && typeof manifest.version === 'number' && manifest.version <= MANIFEST_VERSION) manifests.push(manifest as unknown as MasterManifest)
				} catch {
					continue
				}
			}
		}

		return manifests
	}

	// Writes the immutable manifest of a revision into its staged directory.
	async writeManifest(directory: string, master: CalibrationMaster) {
		await writeAtomically(join(directory, MANIFEST_FILE), `${JSON.stringify({ version: MANIFEST_VERSION, ...master } satisfies MasterManifest, null, '\t')}\n`)
	}

	// Removes staged work no job owns, and returns how many directories went away.
	async removeOrphanStaging(active: ReadonlySet<string>) {
		const staging = join(this.directory, 'staging')
		let removed = 0

		for (const jobId of await directoryNames(staging)) {
			if (active.has(jobId)) continue
			await rm(join(staging, jobId), { recursive: true, force: true })
			removed++
		}

		return removed
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
	if (filter.camera !== undefined) add('camera = ?', filter.camera)
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
