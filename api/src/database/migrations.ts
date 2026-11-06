import type { Database } from 'bun:sqlite'
import initial from './migrations/0001_initial.sql' with { type: 'text' }

// Schema history of the operational database: the SQL migrations the server knows, in order, and their application
// to a database, which records each one with its checksum and refuses a history it does not know.

// One step of the schema, applied once in a transaction of its own.
export interface Migration {
	// Position of the step in the history, from 1, without gaps.
	readonly version: number
	// Statements of the step.
	readonly sql: string
}

// Migrations of the schema, in order. While the application is in development the history is the baseline alone,
// edited in place and synchronized table by table (synchronizeBaseline); numbered migrations start with the first release.
export const MIGRATIONS: readonly Migration[] = [{ version: 1, sql: initial }]

// Version of the baseline, the only migration whose change recreates the database instead of stopping the server.
export const BASELINE_VERSION = 1

// Epoch of the baseline while the application is in development, recorded as PRAGMA user_version: raising it deletes
// every database of another epoch and creates it again, once, when a change cannot be synchronized table by table.
export const BASELINE_EPOCH = 0

// Thrown when the baseline applied to a database is not the one the server knows, so the database is created again.
export class BaselineChangedError extends Error {}

// SHA-256 of the statements of a migration, in lowercase hexadecimal.
export function migrationChecksum(sql: string) {
	return new Bun.CryptoHasher('sha256').update(sql).digest('hex')
}

// Brings the schema of db to the end of migrations, applying each missing step in a transaction with the record of
// its version, checksum, and instant (Unix milliseconds, UTC). Throws BaselineChangedError when the applied baseline
// differs from the known one, and an Error when the history holds an unknown newer version, a gap, or another changed
// step; nothing is applied then. The baseline creates the schema_migrations table, so a database without it has no
// migration applied.
export function migrate(db: Database, migrations: readonly Migration[], now: number = Date.now()) {
	const recorded = db.query("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'").get() !== null
	const applied = recorded ? db.query<{ version: number; checksum: string }, []>('SELECT version, checksum FROM schema_migrations ORDER BY version').all() : []
	const newest = applied.at(-1)?.version ?? 0

	if (newest > migrations.length) throw new Error(`The schema version ${newest} of the database is newer than this server knows (${migrations.length})`)

	for (const [index, { version, checksum }] of applied.entries()) {
		if (version !== index + 1) throw new Error(`The schema history of the database misses version ${index + 1}`)
		if (checksum === migrationChecksum(migrations[index].sql)) continue
		if (version === BASELINE_VERSION) throw new BaselineChangedError(`The baseline schema of the database changed`)
		throw new Error(`The schema version ${version} of the database is not the one this server knows`)
	}

	for (const migration of migrations.slice(applied.length)) {
		db.transaction(() => {
			db.run(migration.sql)
			db.query('INSERT INTO schema_migrations (version, checksum, applied_at) VALUES (?, ?, ?)').run(migration.version, migrationChecksum(migration.sql), now)
		}).immediate()
	}
}
