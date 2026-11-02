import type { Database } from 'bun:sqlite'
import { rmSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { MEMORY_DATABASE, openConnection } from './connection'
import { BaselineChangedError, MIGRATIONS, migrate } from './migrations'

// Owner of the operational database of the server, the single SQLite file that holds every durable record of the
// application. It opens the one connection of the process, brings its schema up to date, and runs the transactions
// of the stores; scientific files stay files beside it, in the data directory.

// Directory of the durable data of the server: the operational database, the captured frames, the calibration library,
// and the Earth orientation tables. NEBULOSA_HOME moves it, as the tests do; ~/Nebulosa otherwise.
export const DEFAULT_DATA_DIRECTORY = process.env.NEBULOSA_HOME || join(homedir(), 'Nebulosa')

// Operational database of the server, in the data directory.
export const DEFAULT_DATABASE_FILE = join(DEFAULT_DATA_DIRECTORY, 'nebulosa.sqlite')

// Key of the connections kept on the global object across hot reloads of the modules.
const OPEN_CONNECTIONS_KEY = Symbol.for('nebulosa.database')

// Connections open in the process, by file. A hot reload evaluates this module again while the connection of the
// previous evaluation still holds the lock of its file, so the new owner takes that connection instead of being refused.
const OPEN_CONNECTIONS = ((globalThis as unknown as Record<symbol, Map<string, Database> | undefined>)[OPEN_CONNECTIONS_KEY] ??= new Map<string, Database>())

// The operational database: one file and the one connection of the process to it.
export class AppDatabase {
	#db?: Database

	// file is the path of the database, or ':memory:' for one that lives in memory only; exclusive keeps every other
	// process off the file while it is open (openConnection), which production asks for.
	constructor(
		readonly file: string,
		readonly exclusive = true,
	) {}

	// A database that lives in memory only, for tests.
	static memory() {
		return new AppDatabase(MEMORY_DATABASE)
	}

	// Connection of the database, opened on first use.
	get db(): Database {
		return this.#db ?? this.open()
	}

	// Opens the database and brings its schema to the migrations the server knows; does nothing when already open. A
	// database whose baseline schema changed is deleted, with its WAL, and created again, with a warning. Throws an Error
	// saying why the database cannot be opened (another server holds it, the file is not a database, or its schema is
	// newer than this server knows); the file is never deleted then.
	open(): Database {
		if (this.#db) return this.#db

		const shared = this.file !== MEMORY_DATABASE
		let db = (shared && OPEN_CONNECTIONS.get(this.file)) || openConnection(this.file, this.exclusive)
		OPEN_CONNECTIONS.delete(this.file)

		try {
			migrate(db, MIGRATIONS)
		} catch (error) {
			db.close()
			if (!(error instanceof BaselineChangedError)) throw error

			console.warn(`The schema of ${this.file} changed; the database was deleted and created again`)
			removeDatabaseFiles(this.file)
			db = openConnection(this.file, this.exclusive)
			migrate(db, MIGRATIONS)
		}

		if (shared) OPEN_CONNECTIONS.set(this.file, db)
		return (this.#db = db)
	}

	// Runs fn in a transaction that takes the write lock at once, committing what it wrote when it returns and undoing
	// it when it throws, and answers what fn returns. fn must not wait on anything: files and the network are worked on
	// before or after it.
	write<T>(fn: () => T): T {
		return this.db.transaction(fn).immediate()
	}

	// Closes the connection, which writes the WAL back into the file and releases its lock. Opening again is allowed.
	close() {
		if (!this.#db) return
		if (OPEN_CONNECTIONS.get(this.file) === this.#db) OPEN_CONNECTIONS.delete(this.file)
		this.#db.close()
		this.#db = undefined
	}
}

// Deletes the database at file with its WAL and shared memory files.
function removeDatabaseFiles(file: string) {
	for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })
}
