import { Database } from 'bun:sqlite'
import { mkdirSync } from 'fs'
import { dirname } from 'path'
import { errorCode } from '../util'

// Opening of the SQLite connection of the operational database: the settings every connection runs with, the
// exclusive lock that keeps a second server off the same file, and the check of the SQLite the runtime carries.

// Name of a database that lives in memory only, as the tests open it.
export const MEMORY_DATABASE = ':memory:'

// Oldest SQLite the schema runs on: STRICT tables (3.37) and the JSON functions built in by default (3.38).
const MINIMUM_SQLITE_VERSION = [3, 38, 0] as const

// Opens the database at file with the settings of the server, creating the file and its directory when missing.
// Foreign keys are enforced, the journal is a WAL synced on every commit, and the lock taken by the first access is
// held until the connection closes, so no other process can read or write the file meanwhile. Throws an Error that
// says why it cannot be opened: another process holds it, the file is not a database, or the SQLite of the runtime
// is too old. Never deletes or rewrites an existing file.
export function openConnection(file: string): Database {
	if (file !== MEMORY_DATABASE) mkdirSync(dirname(file), { recursive: true })
	const db = new Database(file, { create: true, strict: true })

	try {
		// Before the WAL is enabled, so SQLite uses no shared memory and keeps the lock of the first access.
		db.run('PRAGMA locking_mode = EXCLUSIVE')
		db.run('PRAGMA journal_mode = WAL')
		db.run('PRAGMA synchronous = FULL')
		db.run('PRAGMA foreign_keys = ON')
		checkCapabilities(db)
		return db
	} catch (error) {
		db.close()
		throw openError(file, error)
	}
}

// Throws when the SQLite of the runtime lacks what the schema needs.
function checkCapabilities(db: Database) {
	const { version } = db.query<{ version: string }, []>('SELECT sqlite_version() AS version').get()!
	const parts = version.split('.').map(Number)
	const index = MINIMUM_SQLITE_VERSION.findIndex((minimum, i) => (parts[i] ?? 0) !== minimum)

	if (index >= 0 && (parts[index] ?? 0) < MINIMUM_SQLITE_VERSION[index]) {
		throw new Error(`SQLite ${version} is older than ${MINIMUM_SQLITE_VERSION.join('.')}`)
	}

	db.query('SELECT json_valid(?) AS valid').get('{}')
}

// Error of a database that cannot be opened, saying why in words an operator acts on.
function openError(file: string, error: unknown) {
	const code = errorCode(error)
	if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED') return new Error(`Another Nebulosa server uses ${file}`, { cause: error })
	if (code === 'SQLITE_NOTADB' || code === 'SQLITE_CORRUPT') return new Error(`${file} is not a Nebulosa database or is damaged; it was left as it is`, { cause: error })
	return new Error(`${file} cannot be opened: ${Error.isError(error) ? error.message : String(error)}`, { cause: error })
}
