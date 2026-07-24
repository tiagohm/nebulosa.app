import { Database, Statement } from 'bun:sqlite'
import type { SQLQueryBindings } from 'bun:sqlite'
import { join } from 'path'
import { JSON_DEFAULT_HEADERS, query, response } from './http'
import type { Endpoints } from './http'

export type KeyValue<T = string> = { readonly value: T }

export class StorageHandler {
	private readonly db: Database
	private readonly getQuery: Statement<KeyValue, SQLQueryBindings[]>
	private readonly hasQuery: Statement<KeyValue<number>, SQLQueryBindings[]>
	private readonly allQuery: Statement<{ readonly key: string; readonly value: string }, SQLQueryBindings[]>

	constructor(memory: boolean) {
		this.db = new Database(memory ? ':memory:' : join(Bun.env.appDir, 'storage.sqlite'))

		this.db.run('PRAGMA journal_mode = OFF')
		this.db.run('PRAGMA synchronous = OFF')
		this.db.run('PRAGMA temp_store = MEMORY')
		this.db.run('PRAGMA locking_mode = EXCLUSIVE')
		this.db.run('PRAGMA cache_size = -262144')
		this.db.run('PRAGMA mmap_size = 0')
		this.db.run('PRAGMA automatic_index = ON')
		this.db.run('PRAGMA optimize')
		this.db.run('PRAGMA foreign_keys = OFF')
		this.db.run('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)')

		this.getQuery = this.db.query('SELECT value FROM kv WHERE key = ?')
		this.hasQuery = this.db.query('SELECT 1 as value FROM kv WHERE key = ?')
		this.allQuery = this.db.query('SELECT key, value FROM kv')
	}

	get(key: string, raw: boolean = false) {
		const value = this.getQuery.get(key)?.value
		if (value === undefined || value === null || value === '') return undefined
		return raw ? value : JSON.parse(value)
	}

	has(key: string) {
		return this.hasQuery.get(key)?.value === 1
	}

	put(key: string, data: unknown, raw: boolean = false) {
		if (data === undefined || data === null) return this.delete(key)
		const value = raw && typeof data === 'string' ? data : JSON.stringify(data)
		return this.db.run('INSERT INTO kv (key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', [key, value]).changes === 1
	}

	putAll(data: Record<string, unknown>, raw: boolean = false) {
		for (const [key, value] of Object.entries(data)) {
			this.put(key, value, raw)
		}
	}

	delete(key: string) {
		return this.db.run('DELETE FROM kv WHERE key = ?', [key]).changes === 1
	}

	clear() {
		this.db.run('DELETE FROM kv')
	}

	keys() {
		return this.db
			.query<{ readonly key: string }, null[]>('SELECT key FROM kv')
			.all()
			.flatMap((e) => e.key)
	}

	all(raw: boolean = false) {
		const res: Record<string, unknown> = {}
		for (const item of this.allQuery) res[item.key] = raw ? item.value : JSON.parse(item.value)
		return res
	}
}

export function storage(storage: StorageHandler) {
	return {
		'/storage': { GET: (req) => response(storage.all(query(req).raw === 'true')), PUT: async (req) => response(storage.putAll(await req.json(), query(req).raw === 'true')) },
		'/storage/keys': { GET: () => response(storage.keys()) },
		'/storage/:key': { GET: (req) => new Response(storage.get(req.params.key, true), { headers: JSON_DEFAULT_HEADERS }), PUT: async (req) => response(storage.put(req.params.key, await req.json())), DELETE: (req) => response(storage.delete(req.params.key)) },
	} as const satisfies Endpoints
}
