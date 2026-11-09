import type { AppDatabase } from './database'

// Persistence of the IAU meteor shower catalog in the operational database: the snapshots the operator downloaded, the
// one in use, its revision, and the outcome of the last refresh. A snapshot is the document as published, written only
// after it was validated, in one transaction that also activates it, raises the revision, and keeps at most one previous
// snapshot; a failure leaves the active one untouched. The catalog bundled with the application is never written here.

// Code of a failed refresh, kept with it.
export type MeteorCatalogFailureCode = 'upstreamUnavailable' | 'invalidCatalog' | 'catalogTooLarge' | 'persistenceFailure'

// A snapshot to install.
export interface MeteorCatalogSnapshotInput {
	// Version the document names itself with.
	readonly version: string
	// SHA-256 of the document's bytes, lowercase hexadecimal.
	readonly sha256: string
	// URL it was downloaded from.
	readonly url: string
	// When the download finished, Unix milliseconds (UTC).
	readonly retrievedAt: number
	// Shower records of the document.
	readonly recordCount: number
	// Solutions of all its records.
	readonly solutionCount: number
	// The document as published.
	readonly payload: string
}

// The active snapshot, with its document.
export interface MeteorCatalogSnapshot extends MeteorCatalogSnapshotInput {
	// Row id.
	readonly id: number
}

// State of the catalog source.
export interface MeteorCatalogSourceState {
	// Revision of the active catalog: 0 for the bundled one, raised by every installed snapshot.
	readonly revision: number
	// When the last refresh started, Unix milliseconds (UTC); absent before the first one.
	readonly lastAttemptAt?: number
	// When the last refresh failed, Unix milliseconds (UTC); absent when it succeeded or none failed.
	readonly lastFailureAt?: number
	// Code of the last failure; absent when the last refresh succeeded or none failed.
	readonly lastErrorCode?: MeteorCatalogFailureCode
}

// Row of meteor_catalog_source.
interface SourceRow {
	readonly revision: number
	readonly active_snapshot_id: number | null
	readonly last_attempt_at: number | null
	readonly last_failure_at: number | null
	readonly last_error_code: MeteorCatalogFailureCode | null
}

// Row of meteor_catalog_snapshots.
interface SnapshotRow {
	readonly id: number
	readonly version: string
	readonly sha256: string
	readonly url: string
	readonly retrieved_at: number
	readonly record_count: number
	readonly solution_count: number
	readonly payload: string
}

// Snapshots kept: the active one and the previous one.
const SNAPSHOT_LIMIT = 2

// Store of the IAU meteor shower catalog snapshots.
export class MeteorShowerStore {
	// Creates the store over database.
	constructor(readonly database: AppDatabase) {}

	// State of the source; revision 0 with nothing else before anything was written.
	state(): MeteorCatalogSourceState {
		const row = this.#source()
		if (!row) return { revision: 0 }
		return { revision: row.revision, ...(row.last_attempt_at !== null && { lastAttemptAt: row.last_attempt_at }), ...(row.last_failure_at !== null && { lastFailureAt: row.last_failure_at }), ...(row.last_error_code !== null && { lastErrorCode: row.last_error_code }) }
	}

	// The active snapshot with its document; absent while the bundled catalog is active.
	active(): MeteorCatalogSnapshot | undefined {
		const id = this.#source()?.active_snapshot_id
		if (id === undefined || id === null) return undefined
		const row = this.database.db.query<SnapshotRow, [number]>('SELECT id, version, sha256, url, retrieved_at, record_count, solution_count, payload FROM meteor_catalog_snapshots WHERE id = ?').get(id)
		if (!row) return undefined
		return { id: row.id, version: row.version, sha256: row.sha256, url: row.url, retrievedAt: row.retrieved_at, recordCount: row.record_count, solutionCount: row.solution_count, payload: row.payload }
	}

	// Records the start of a refresh. Throws when the database cannot be written.
	recordAttempt(time: number) {
		this.database.write(() => {
			this.#ensureSource()
			this.database.db.query('UPDATE meteor_catalog_source SET last_attempt_at = ? WHERE singleton = 1').run(time)
		})
	}

	// Records a failed refresh, keeping the active snapshot. Throws when the database cannot be written.
	recordFailure(time: number, code: MeteorCatalogFailureCode) {
		this.database.write(() => {
			this.#ensureSource()
			this.database.db.query('UPDATE meteor_catalog_source SET last_failure_at = ?, last_error_code = ? WHERE singleton = 1').run(time, code)
		})
	}

	// Writes a validated snapshot and makes it the active one in one transaction, raising the revision, clearing the last
	// failure, and removing the snapshots beyond the active and the previous one. Returns the new revision. Throws when the
	// database cannot be written; the active snapshot is then unchanged.
	install(snapshot: MeteorCatalogSnapshotInput): number {
		return this.database.write(() => {
			const current = this.#ensureSource()
			const { lastInsertRowid } = this.database.db
				.query('INSERT INTO meteor_catalog_snapshots (version, sha256, url, retrieved_at, record_count, solution_count, payload) VALUES (?, ?, ?, ?, ?, ?, ?)')
				.run(snapshot.version, snapshot.sha256, snapshot.url, snapshot.retrievedAt, snapshot.recordCount, snapshot.solutionCount, snapshot.payload)
			const revision = current.revision + 1
			this.database.db.query('UPDATE meteor_catalog_source SET active_snapshot_id = ?, revision = ?, last_failure_at = NULL, last_error_code = NULL WHERE singleton = 1').run(Number(lastInsertRowid), revision)
			this.database.db.query('DELETE FROM meteor_catalog_snapshots WHERE id NOT IN (SELECT id FROM meteor_catalog_snapshots ORDER BY id DESC LIMIT ?)').run(SNAPSHOT_LIMIT)
			return revision
		})
	}

	// Row of the source, absent before anything was written.
	#source() {
		return this.database.db.query<SourceRow, []>('SELECT revision, active_snapshot_id, last_attempt_at, last_failure_at, last_error_code FROM meteor_catalog_source WHERE singleton = 1').get() ?? undefined
	}

	// Row of the source, created at revision 0 when missing; inside a write.
	#ensureSource(): SourceRow {
		this.database.db.query('INSERT INTO meteor_catalog_source (singleton, revision) VALUES (1, 0) ON CONFLICT (singleton) DO NOTHING').run()
		return this.#source()!
	}
}
