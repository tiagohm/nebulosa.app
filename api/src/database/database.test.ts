import { Database } from 'bun:sqlite'
import { afterAll, afterEach, expect, spyOn, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AppDatabase, DEFAULT_DATA_DIRECTORY } from '.'
import { openConnection } from './connection'
import { BASELINE_EPOCH, MIGRATIONS, migrate, migrationChecksum } from './migrations'

const root = mkdtempSync(join(tmpdir(), 'nebulosa-database-'))
const opened: AppDatabase[] = []

afterEach(() => {
	for (const database of opened.splice(0)) database.close()
})

afterAll(() => rmSync(root, { recursive: true, force: true }))

let files = 0

function databaseFile() {
	return join(root, `${++files}`, 'nebulosa.sqlite')
}

function open(file: string) {
	const database = new AppDatabase(file)
	opened.push(database)
	database.open()
	return database
}

function migrations(db: Database) {
	return db.query<{ version: number; checksum: string; applied_at: number }, []>('SELECT version, checksum, applied_at FROM schema_migrations ORDER BY version').all()
}

function tables(db: Database) {
	return db
		.query<{ name: string }, []>("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name")
		.all()
		.map(({ name }) => name)
}

test('the tests run in a data directory of their own', () => {
	expect(DEFAULT_DATA_DIRECTORY).toBe(process.env.NEBULOSA_HOME!)
	expect(DEFAULT_DATA_DIRECTORY.startsWith(tmpdir())).toBeTrue()
})

test('a new database is created with its schema and the settings of the server', () => {
	const file = databaseFile()
	const { db } = open(file)

	expect(existsSync(file)).toBeTrue()
	expect(migrations(db)).toEqual([{ version: 1, checksum: migrationChecksum(MIGRATIONS[0].sql), applied_at: expect.any(Number) }])
	expect(db.query('PRAGMA foreign_keys').get()).toEqual({ foreign_keys: 1 })
	expect(db.query('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' })
	expect(db.query('PRAGMA synchronous').get()).toEqual({ synchronous: 2 })
	expect(db.query('PRAGMA locking_mode').get()).toEqual({ locking_mode: 'exclusive' })
})

test('reopening keeps the data and the record of the migrations', () => {
	const file = databaseFile()
	const first = open(file)
	first.db.run('CREATE TABLE marker (value INTEGER) STRICT')
	first.db.run('INSERT INTO marker VALUES (42)')
	const applied = migrations(first.db)
	first.close()

	const { db } = open(file)
	expect(db.query('SELECT value FROM marker').all()).toEqual([{ value: 42 }])
	expect(migrations(db)).toEqual(applied)
})

test('a changed baseline is synchronized table by table, keeping the rows of unchanged tables, with a warning', () => {
	const file = databaseFile()
	const first = open(file)
	first.db.run('CREATE TABLE marker (value INTEGER) STRICT')
	first.db.run("INSERT INTO observing_sites VALUES ('site', 'Home', 0, 0, 0, 'UTC', 0, 1, 0, 0)")
	first.db.run("UPDATE schema_migrations SET checksum = 'changed' WHERE version = 1")
	first.close()

	const warn = spyOn(console, 'warn').mockImplementation(() => undefined)

	try {
		const { db } = open(file)
		expect(tables(db)).not.toContain('marker')
		expect(db.query('SELECT id FROM observing_sites').all()).toEqual([{ id: 'site' }])
		expect(migrations(db)).toEqual([{ version: 1, checksum: migrationChecksum(MIGRATIONS[0].sql), applied_at: expect.any(Number) }])
		expect(warn).toHaveBeenCalledWith(`The schema of ${file} changed: dropped marker`)
	} finally {
		warn.mockRestore()
	}
})

test('a database of another epoch is created again, with a warning', () => {
	const file = databaseFile()
	const first = open(file)
	first.db.run("INSERT INTO observing_sites VALUES ('site', 'Home', 0, 0, 0, 'UTC', 0, 1, 0, 0)")
	first.db.run(`PRAGMA user_version = ${BASELINE_EPOCH + 1}`)
	first.close()

	const warn = spyOn(console, 'warn').mockImplementation(() => undefined)

	try {
		const { db } = open(file)
		expect(db.query('SELECT id FROM observing_sites').all()).toEqual([])
		expect(db.query('PRAGMA user_version').get()).toEqual({ user_version: BASELINE_EPOCH })
		expect(warn).toHaveBeenCalledTimes(1)
	} finally {
		warn.mockRestore()
	}
})

test('a newer schema stops the opening and leaves the file as it is', () => {
	const file = databaseFile()
	const first = open(file)
	first.db.run("INSERT INTO schema_migrations VALUES (2, 'unknown', 0)")
	first.close()
	const content = readFileSync(file)

	expect(() => open(file)).toThrow('newer than this server knows')
	expect(readFileSync(file)).toEqual(content)
	expect(() => open(file)).toThrow('newer than this server knows')
})

test('a file that is not a database stops the opening and is left as it is', () => {
	const file = databaseFile()
	open(file).close()
	const text = 'These are notes, not a database, and they are long enough to fill a header of SQLite.'
	writeFileSync(file, text)

	expect(() => open(file)).toThrow('is not a Nebulosa database or is damaged')
	expect(readFileSync(file, 'utf-8')).toBe(text)
})

test('without the exclusive lock, another process reads and writes the file beside the server', () => {
	const file = databaseFile()
	const server = openConnection(file, false)
	server.run('CREATE TABLE notes (text TEXT) STRICT')
	server.run("INSERT INTO notes VALUES ('server')")

	const browser = openConnection(file, false)
	expect(browser.query('SELECT text FROM notes').all()).toEqual([{ text: 'server' }])
	browser.run("INSERT INTO notes VALUES ('browser')")
	expect(server.query('SELECT text FROM notes ORDER BY text').all()).toEqual([{ text: 'browser' }, { text: 'server' }])

	browser.close()
	server.close()
})

test('a second server on the same file is refused until the first one closes', () => {
	const file = databaseFile()
	const first = open(file)

	expect(() => openConnection(file)).toThrow('Another Nebulosa server uses')

	first.close()
	const second = openConnection(file)
	expect(migrations(second)).toHaveLength(1)
	second.close()
})

test('migrations are applied in order and a history the server does not know is refused', () => {
	const steps = [
		{ version: 1, sql: 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT' },
		{ version: 2, sql: 'CREATE TABLE a (x INTEGER) STRICT' },
		{ version: 3, sql: 'CREATE TABLE b (y INTEGER) STRICT' },
	]

	const db = new Database(':memory:', { strict: true })
	migrate(db, steps.slice(0, 2), 1)
	migrate(db, steps, 2)
	expect(migrations(db).map(({ version, applied_at }) => [version, applied_at])).toEqual([
		[1, 1],
		[2, 1],
		[3, 2],
	])
	expect(tables(db)).toEqual(['a', 'b', 'schema_migrations'])

	expect(() => migrate(db, [steps[0], steps[1], { version: 3, sql: 'CREATE TABLE b (z INTEGER) STRICT' }])).toThrow('version 3 of the database is not the one')

	db.run('DELETE FROM schema_migrations WHERE version = 2')
	expect(() => migrate(db, steps)).toThrow('misses version 2')
	db.close()
})

test('a failed migration applies nothing of it', () => {
	const steps = [
		{ version: 1, sql: 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT' },
		{ version: 2, sql: 'CREATE TABLE a (x INTEGER) STRICT; CREATE TABLE a (y INTEGER) STRICT' },
	]

	const db = new Database(':memory:', { strict: true })
	expect(() => migrate(db, steps)).toThrow()
	expect(tables(db)).toEqual(['schema_migrations'])
	expect(migrations(db).map(({ version }) => version)).toEqual([1])
	db.close()
})

test('foreign keys are enforced and a failed transaction writes nothing', () => {
	const database = AppDatabase.memory()
	opened.push(database)
	const { db } = database
	db.run('CREATE TABLE parent (id INTEGER PRIMARY KEY) STRICT')
	db.run('CREATE TABLE child (parent_id INTEGER NOT NULL REFERENCES parent (id)) STRICT')

	expect(() => db.run('INSERT INTO child VALUES (1)')).toThrow('FOREIGN KEY')

	expect(() =>
		database.write(() => {
			db.run('INSERT INTO parent VALUES (1)')
			throw new Error('stop')
		}),
	).toThrow('stop')
	expect(db.query('SELECT count(*) AS count FROM parent').get()).toEqual({ count: 0 })

	expect(database.write(() => db.run('INSERT INTO parent VALUES (2)').changes)).toBe(1)
	expect(db.query('SELECT id FROM parent').all()).toEqual([{ id: 2 }])
})

test('a closed database refuses a use until it is opened again', () => {
	const database = open(databaseFile())
	database.db.run('CREATE TABLE notes (text TEXT)')
	database.close()

	expect(() => database.db).toThrow('was closed')
	database.open()
	expect(database.db.query('SELECT COUNT(*) AS count FROM notes').get()).toEqual({ count: 0 })
})
