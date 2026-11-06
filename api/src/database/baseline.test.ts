import { Database } from 'bun:sqlite'
import { expect, test } from 'bun:test'
import { synchronizeBaseline } from './baseline'
import { BaselineChangedError, migrate, migrationChecksum } from './migrations'

const HISTORY = 'CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_at INTEGER NOT NULL) STRICT;\n'

const PARENTS = `
CREATE TABLE parents (
	-- Id.
	id INTEGER PRIMARY KEY,
	name TEXT NOT NULL
) STRICT;
`

const CHILDREN = `
CREATE TABLE cascaded (parent_id INTEGER NOT NULL REFERENCES parents (id) ON DELETE CASCADE) STRICT;
CREATE TABLE restricted (parent_id INTEGER NOT NULL REFERENCES parents (id) ON DELETE RESTRICT) STRICT;
CREATE TABLE nulled (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES parents (id) ON DELETE SET NULL) STRICT;
CREATE TABLE grandchildren (nulled_id INTEGER NOT NULL REFERENCES nulled (id) ON DELETE CASCADE) STRICT;
CREATE TABLE unrelated (value INTEGER NOT NULL) STRICT;
`

function create(sql: string) {
	const db = new Database(':memory:', { strict: true })
	db.run('PRAGMA foreign_keys = ON')
	migrate(db, [{ version: 1, sql: HISTORY + sql }])
	return db
}

function seed(db: Database) {
	db.run("INSERT INTO parents VALUES (1, 'a')")
	db.run('INSERT INTO cascaded VALUES (1)')
	db.run('INSERT INTO restricted VALUES (1)')
	db.run('INSERT INTO nulled VALUES (7, 1)')
	db.run('INSERT INTO grandchildren VALUES (7)')
	db.run('INSERT INTO unrelated VALUES (42)')
}

function count(db: Database, table: string) {
	return db.query<{ count: number }, []>(`SELECT count(*) AS count FROM ${table}`).get()!.count
}

function checksum(db: Database) {
	return db.query<{ checksum: string }, []>('SELECT checksum FROM schema_migrations WHERE version = 1').get()!.checksum
}

test('an unchanged baseline and a database without history are left as they are', () => {
	const db = create(PARENTS)
	expect(synchronizeBaseline(db, HISTORY + PARENTS, 0)).toBeUndefined()

	const empty = new Database(':memory:', { strict: true })
	expect(synchronizeBaseline(empty, HISTORY + PARENTS, 0)).toBeUndefined()
})

test('comments and spaces keep every row and record the new baseline', () => {
	const db = create(PARENTS + CHILDREN)
	seed(db)

	const edited = HISTORY + PARENTS.replace('-- Id.', '-- Id of the parent, from 1.').replace('name TEXT NOT NULL', 'name  TEXT\n\tNOT NULL /* shown */') + CHILDREN.replaceAll('parents (id)', 'parents(id)')
	expect(synchronizeBaseline(db, edited, 0)).toEqual({ created: [], rebuilt: [], dropped: [], emptied: [], indexes: [] })
	expect(count(db, 'parents')).toBe(1)
	expect(count(db, 'cascaded')).toBe(1)
	expect(checksum(db)).toBe(migrationChecksum(edited))
})

test('a changed table is emptied with the tables that depend on it, and SET NULL keeps the rows', () => {
	const db = create(PARENTS + CHILDREN)
	seed(db)

	const changes = synchronizeBaseline(db, HISTORY + PARENTS.replace('name TEXT NOT NULL', 'name TEXT NOT NULL,\n\tnotes TEXT') + CHILDREN, 0)
	expect(changes).toEqual({ created: [], rebuilt: ['parents'], dropped: [], emptied: ['cascaded', 'restricted'], indexes: [] })
	expect(db.query('SELECT name FROM pragma_table_info(?)').all('parents')).toEqual([{ name: 'id' }, { name: 'name' }, { name: 'notes' }])
	expect(count(db, 'parents')).toBe(0)
	expect(count(db, 'cascaded')).toBe(0)
	expect(count(db, 'restricted')).toBe(0)
	expect(db.query('SELECT id, parent_id FROM nulled').all()).toEqual([{ id: 7, parent_id: null }])
	expect(count(db, 'grandchildren')).toBe(1)
	expect(count(db, 'unrelated')).toBe(1)

	db.run("INSERT INTO parents (id, name) VALUES (2, 'b')")
	db.run('INSERT INTO cascaded VALUES (2)')
	expect(() => db.run('INSERT INTO cascaded VALUES (3)')).toThrow('FOREIGN KEY')
})

test('new tables are created, removed ones dropped, and indexes follow without touching rows', () => {
	const db = create(`${PARENTS}CREATE INDEX parents_name ON parents (name);\nCREATE TABLE removed (value INTEGER) STRICT;`)
	db.run("INSERT INTO parents VALUES (1, 'a')")

	const changes = synchronizeBaseline(db, `${HISTORY}${PARENTS}CREATE INDEX parents_name ON parents (name, id);\nCREATE TABLE added (value INTEGER) STRICT;\nCREATE INDEX added_value ON added (value);`, 0)
	expect(changes).toEqual({ created: ['added'], rebuilt: [], dropped: ['removed'], emptied: [], indexes: ['parents_name'] })
	expect(count(db, 'parents')).toBe(1)
	expect(db.query("SELECT name, sql FROM sqlite_schema WHERE type = 'index' ORDER BY name").all()).toEqual([
		{ name: 'added_value', sql: 'CREATE INDEX added_value ON added (value)' },
		{ name: 'parents_name', sql: 'CREATE INDEX parents_name ON parents (name, id)' },
	])
})

test('raising @version empties the table and @clearedWith empties the tables named with it', () => {
	const sql = `${PARENTS}CREATE TABLE downloads (\n\t-- @clearedWith parents\n\tvalue INTEGER\n) STRICT;\nCREATE TABLE unrelated (value INTEGER NOT NULL) STRICT;`
	const db = create(sql)
	db.run("INSERT INTO parents VALUES (1, 'a')")
	db.run('INSERT INTO downloads VALUES (1)')
	db.run('INSERT INTO unrelated VALUES (1)')

	const changes = synchronizeBaseline(db, HISTORY + sql.replace('-- Id.', '-- @version 2'), 0)
	expect(changes).toEqual({ created: [], rebuilt: ['parents'], dropped: [], emptied: ['downloads'], indexes: [] })
	expect(count(db, 'downloads')).toBe(0)
	expect(count(db, 'unrelated')).toBe(1)
})

test('a synchronization that breaks a constraint, or another epoch, changes nothing and asks for a new database', () => {
	const sql = `${PARENTS}CREATE TABLE kept (parent_id INTEGER NOT NULL REFERENCES parents (id) ON DELETE SET NULL) STRICT;`
	const db = create(sql)
	db.run("INSERT INTO parents VALUES (1, 'a')")
	db.run('INSERT INTO kept VALUES (1)')
	const before = checksum(db)

	expect(() => synchronizeBaseline(db, HISTORY + sql.replace('-- Id.', '-- @version 2'), 0)).toThrow(BaselineChangedError)
	expect(count(db, 'parents')).toBe(1)
	expect(count(db, 'kept')).toBe(1)
	expect(checksum(db)).toBe(before)

	expect(() => synchronizeBaseline(db, HISTORY + sql, 1)).toThrow('epoch of the baseline schema changed')
})

test('a changed history table or a malformed directive is refused', () => {
	const db = create(PARENTS)
	expect(() => synchronizeBaseline(db, HISTORY.replace('applied_at INTEGER', 'applied_at REAL') + PARENTS, 0)).toThrow('history table')
	expect(() => synchronizeBaseline(db, HISTORY + PARENTS.replace('-- Id.', '-- @version two'), 0)).toThrow('not a positive integer')
	expect(() => synchronizeBaseline(db, HISTORY + PARENTS.replace('-- Id.', '-- @clearedWith nowhere'), 0)).toThrow('unknown table nowhere')
	expect(() => synchronizeBaseline(db, HISTORY + PARENTS.replace('-- Id.', '-- @size 3'), 0)).toThrow('Unknown directive @size')
})
