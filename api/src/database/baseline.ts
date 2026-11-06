import { Database } from 'bun:sqlite'
import { BASELINE_VERSION, BaselineChangedError, migrationChecksum } from './migrations'

// Synchronization of the baseline schema while the application is in development, when the baseline is edited in
// place: a database follows each edit table by table instead of being deleted. The baseline is applied to a database in
// memory, and each of its tables is compared with the table of the same name of the database, without comments or
// insignificant spaces. A new table is created and an index is created, dropped, or created again, keeping every row. A
// table whose definition changed is emptied and created again, and one the baseline no longer has is emptied and dropped.
// Emptying a table empties the tables that depend on it through a foreign key, unless the key is ON DELETE SET NULL or
// SET DEFAULT, whose rows stay and lose the reference, as when an operator deletes every row of the table.
//
// Two directives, written as a comment of their own in the body of a CREATE TABLE of the baseline, say what the
// definition does not:
// - '-- @version <n>' (a positive integer) is part of the definition: raising it empties the table and creates it again,
//   when the shape of the data it holds changes without its columns changing, as the JSON of a payload.
// - '-- @clearedWith <table> [<table>...]' empties the table whenever one of those tables is emptied, for data that
//   depends on them without a foreign key.

// Table of the history of the schema, which is never synchronized: a change of it creates the database again.
const HISTORY_TABLE = 'schema_migrations'

// What a synchronization did to the tables and indexes of a database, by name.
export interface BaselineChanges {
	// Tables the baseline added, created empty.
	readonly created: readonly string[]
	// Tables whose definition changed, emptied and created again.
	readonly rebuilt: readonly string[]
	// Tables the baseline no longer has, emptied and dropped.
	readonly dropped: readonly string[]
	// Tables kept with their definition but emptied, because a table they depend on was emptied.
	readonly emptied: readonly string[]
	// Indexes created, created again, or dropped on tables that kept their rows.
	readonly indexes: readonly string[]
}

// Definition of a table of a schema.
interface TableDefinition {
	// Name of the table.
	readonly name: string
	// CREATE TABLE statement as SQLite keeps it.
	readonly sql: string
	// Statement without comments or insignificant spaces, followed by its @version: equal keys are the same definition.
	readonly key: string
	// Tables whose emptying empties this one (@clearedWith).
	readonly clearedWith: readonly string[]
}

// Definition of an index of a schema, created by a CREATE INDEX statement.
interface IndexDefinition {
	// Name of the index, and of the table it indexes.
	readonly name: string
	readonly tableName: string
	// CREATE INDEX statement as SQLite keeps it.
	readonly sql: string
	// Statement without comments or insignificant spaces: equal keys are the same index.
	readonly key: string
}

// Tables and indexes of a schema, by name; the internal objects of SQLite and the automatic indexes of constraints are
// left out, as part of what creates them.
interface SchemaDefinition {
	readonly tables: ReadonlyMap<string, TableDefinition>
	readonly indexes: ReadonlyMap<string, IndexDefinition>
}

// Row of sqlite_schema.
interface SchemaRow {
	readonly type: string
	readonly name: string
	readonly tableName: string
	readonly sql: string | null
}

// Table that depends on another one, and what deleting a row of that one does to its rows.
interface Dependent {
	// Name of the dependent table.
	readonly table: string
	// ON DELETE action of its foreign key ('CASCADE', 'RESTRICT', 'NO ACTION', 'SET NULL', 'SET DEFAULT'); CASCADE for
	// a @clearedWith directive.
	readonly action: string
}

// Characters around which spaces are insignificant in a statement.
const PUNCTUATION = '(),;=<>!+-*/|.'

// Brings the schema of db to the baseline whose statements are sql, table by table, in one transaction that also
// records the checksum of sql as the one of the baseline, and answers what changed. Answers undefined, changing nothing,
// when db has no history, when its history is not the baseline alone (migrate judges it), or when its baseline already
// is sql. Throws BaselineChangedError, changing nothing, when the database must be created again instead: its epoch
// (PRAGMA user_version) is not epoch, the history table changed, the schema holds a view or a trigger, or the
// synchronization failed, as when a row kept by a SET NULL key breaks a constraint of its table. Throws an Error when
// the baseline has a malformed directive.
export function synchronizeBaseline(db: Database, sql: string, epoch: number): BaselineChanges | undefined {
	if (db.query('SELECT 1 FROM sqlite_schema WHERE type = ? AND name = ?').get('table', HISTORY_TABLE) === null) return undefined

	const history = db.query<{ version: number; checksum: string }, []>(`SELECT version, checksum FROM ${HISTORY_TABLE} ORDER BY version`).all()
	if (history.length !== 1 || history[0].version !== BASELINE_VERSION) return undefined

	const { user_version } = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!
	if (user_version !== epoch) throw new BaselineChangedError(`The epoch of the baseline schema changed from ${user_version} to ${epoch}`)

	const checksum = migrationChecksum(sql)
	if (history[0].checksum === checksum) return undefined

	const target = baselineSchema(sql)
	const current = readSchema(db)

	if (target.tables.get(HISTORY_TABLE)?.key !== current.tables.get(HISTORY_TABLE)?.key) throw new BaselineChangedError(`The history table of the baseline schema changed`)

	const created = [...target.tables.keys()].filter((name) => !current.tables.has(name))
	const rebuilt: string[] = []
	const dropped: string[] = []

	for (const [name, table] of current.tables) {
		if (name === HISTORY_TABLE) continue
		const next = target.tables.get(name)
		if (!next) dropped.push(name)
		else if (next.key !== table.key) rebuilt.push(name)
	}

	const order = clearingOrder([...rebuilt, ...dropped], dependents(db, current, target))
	const emptied = order.filter((name) => !rebuilt.includes(name) && !dropped.includes(name))
	const indexes: string[] = []

	try {
		db.transaction(() => {
			for (const name of order) db.run(`DELETE FROM ${quote(name)}`)
			for (const name of [...rebuilt, ...dropped]) db.run(`DROP TABLE ${quote(name)}`)
			for (const name of [...rebuilt, ...created]) db.run(target.tables.get(name)!.sql)

			const recreated = new Set([...rebuilt, ...created])
			const existing = readSchema(db).indexes

			for (const index of existing.values()) {
				const next = target.indexes.get(index.name)
				if (next?.key === index.key && next.tableName === index.tableName) continue
				db.run(`DROP INDEX ${quote(index.name)}`)
				if (!next) indexes.push(index.name)
			}

			for (const index of target.indexes.values()) {
				const previous = existing.get(index.name)
				if (previous?.key === index.key && previous.tableName === index.tableName) continue
				db.run(index.sql)
				if (!recreated.has(index.tableName)) indexes.push(index.name)
			}

			if (db.query('PRAGMA foreign_key_check').all().length > 0) throw new Error('rows of the kept tables break their foreign keys')

			db.query(`UPDATE ${HISTORY_TABLE} SET checksum = ? WHERE version = ?`).run(checksum, BASELINE_VERSION)
		}).immediate()
	} catch (error) {
		throw new BaselineChangedError(`The baseline schema could not be synchronized: ${Error.isError(error) ? error.message : String(error)}`, { cause: error })
	}

	return { created, rebuilt, dropped, emptied, indexes }
}

// Records epoch as the epoch of the baseline of db (PRAGMA user_version), which synchronizeBaseline compares with the
// epoch of the server; nothing is written when it already is.
export function recordBaselineEpoch(db: Database, epoch: number) {
	const { user_version } = db.query<{ user_version: number }, []>('PRAGMA user_version').get()!
	if (user_version !== epoch) db.run(`PRAGMA user_version = ${epoch}`)
}

// Schema created by the statements sql, applied to a database in memory that is closed before returning. Throws an
// Error when a directive is malformed or names a table the schema does not have.
function baselineSchema(sql: string): SchemaDefinition {
	const reference = new Database(':memory:', { strict: true })

	try {
		reference.run(sql)
		const schema = readSchema(reference)

		for (const table of schema.tables.values()) {
			for (const name of table.clearedWith) {
				if (!schema.tables.has(name)) throw new Error(`The @clearedWith directive of the table ${table.name} names the unknown table ${name}`)
			}
		}

		return schema
	} finally {
		reference.close()
	}
}

// Tables and indexes of db. Throws BaselineChangedError when it holds a view or a trigger, which are not synchronized.
function readSchema(db: Database): SchemaDefinition {
	const rows = db.query<SchemaRow, []>("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite\\_%' ESCAPE '\\'").all()
	const tables = new Map<string, TableDefinition>()
	const indexes = new Map<string, IndexDefinition>()

	for (const { type, name, tableName, sql } of rows) {
		if (type === 'table' && sql) {
			const { text, directives } = parseStatement(sql)
			const version = directives.get('version')
			const clearedWith = directives.get('clearedWith')

			if (version !== undefined && !/^[1-9]\d*$/.test(version)) throw new Error(`The @version directive of the table ${name} is not a positive integer`)
			if (clearedWith !== undefined && !clearedWith) throw new Error(`The @clearedWith directive of the table ${name} names no table`)

			tables.set(name, { name, sql, key: version ? `${text} @version ${version}` : text, clearedWith: clearedWith ? clearedWith.split(/[\s,]+/) : [] })
		} else if (type === 'index') {
			if (sql) indexes.set(name, { name, tableName, sql, key: parseStatement(sql).text })
		} else {
			throw new BaselineChangedError(`The schema holds the ${type} ${name}, which is not synchronized`)
		}
	}

	return { tables, indexes }
}

// Statement sql without comments, with one space between words and none around punctuation, and the directives of its
// comments by name, each with the text after its name. Quoted strings and identifiers are kept as they are.
function parseStatement(sql: string) {
	const directives = new Map<string, string>()
	let text = ''
	let space = false
	let i = 0

	while (i < sql.length) {
		const c = sql[i]

		if ((c === '-' && sql[i + 1] === '-') || (c === '/' && sql[i + 1] === '*')) {
			const line = c === '-'
			const end = sql.indexOf(line ? '\n' : '*/', i + 2)
			const comment = sql.slice(i + 2, end < 0 ? sql.length : end).trim()
			const directive = /^@(\w+)\s*(.*)$/s.exec(comment)

			if (directive) {
				if (directive[1] !== 'version' && directive[1] !== 'clearedWith') throw new Error(`Unknown directive @${directive[1]} in the schema`)
				directives.set(directive[1], directive[2].trim())
			}

			i = end < 0 ? sql.length : end + (line ? 1 : 2)
			space = true
			continue
		}

		if (/\s/.test(c)) {
			space = true
			i++
			continue
		}

		if (space && text && !PUNCTUATION.includes(c) && !PUNCTUATION.includes(text.at(-1)!)) text += ' '
		space = false

		const close = c === "'" || c === '"' || c === '`' ? c : c === '[' ? ']' : undefined

		if (close) {
			const end = quoteEnd(sql, i, close)
			text += sql.slice(i, end + 1)
			i = end + 1
		} else {
			text += c
			i++
		}
	}

	return { text, directives }
}

// Index in sql of the quote close that ends the quoted text opened at start, or the length of sql when it is never
// closed. A doubled quote inside the text is the quote itself; a bracket has no escape.
function quoteEnd(sql: string, start: number, close: string) {
	for (let end = sql.indexOf(close, start + 1); end >= 0; end = sql.indexOf(close, end + 2)) {
		if (close === ']' || sql[end + 1] !== close) return end
	}

	return sql.length
}

// Tables of db that depend on each table, through their foreign keys in db and the @clearedWith directives of the
// baseline target.
function dependents(db: Database, current: SchemaDefinition, target: SchemaDefinition) {
	const result = new Map<string, Dependent[]>()
	const add = (parent: string, dependent: Dependent) => result.set(parent, [...(result.get(parent) ?? []), dependent])

	for (const name of current.tables.keys()) {
		for (const { parent, action } of db.query<{ parent: string; action: string }, [string]>('SELECT "table" AS parent, on_delete AS action FROM pragma_foreign_key_list(?)').all(name)) {
			add(parent, { table: name, action })
		}

		for (const parent of target.tables.get(name)?.clearedWith ?? []) add(parent, { table: name, action: 'CASCADE' })
	}

	return result
}

// Tables to empty when the tables roots are emptied, in an order that empties each one before the tables it depends
// on, so no RESTRICT key refuses a deletion: the roots and, transitively, every table depending on them through a key
// that is not ON DELETE SET NULL or SET DEFAULT.
function clearingOrder(roots: readonly string[], dependentsOf: ReadonlyMap<string, readonly Dependent[]>) {
	const order: string[] = []
	const visited = new Set<string>()

	const visit = (name: string) => {
		if (visited.has(name)) return
		visited.add(name)

		for (const { table, action } of dependentsOf.get(name) ?? []) {
			if (action !== 'SET NULL' && action !== 'SET DEFAULT') visit(table)
		}

		order.push(name)
	}

	for (const name of roots) visit(name)
	return order
}

// Name as a quoted SQL identifier.
function quote(name: string) {
	return `"${name.replaceAll('"', '""')}"`
}
