import type { OperationFailureReason } from 'nebulosa/src/devices/orchestration/operation'
import type { AppDatabase } from './database'
import type { OperationKind } from './operations'
import type { ServerEvent } from './websocket'

// History of the device operations of the server: when each one started, the devices it held, and how it ended, kept
// in the operational database apart from the OperationRegistry, which holds only the running ones. The composition
// hands every server event to consume; only the start and the end of an operation are written, never its progress,
// and never the text of its error, which may hold server paths. An operation still running when the server stopped is
// recorded as interrupted when it starts again: nothing resumes it. Rows older than OPERATION_RETENTION and beyond
// MAX_OPERATION_RUNS are deleted as operations end. A row that cannot be written is reported on the console and never
// reaches the service that published the event.

// Age after which an operation is deleted from the history, in milliseconds (90 days).
export const OPERATION_RETENTION = 90 * 24 * 60 * 60 * 1000

// Operations kept in the history; the oldest are deleted first.
export const MAX_OPERATION_RUNS = 10000

// Most operations of a page of GET /api/operations/history.
export const MAX_OPERATION_PAGE = 200

// Outcome of an operation in the history; interrupted when the server stopped while it ran.
export type OperationRunState = 'running' | 'succeeded' | 'failed' | 'interrupted'

// Device an operation held, as it was named when the operation started.
export interface OperationRunDevice {
	// Id of the connection that provided the device.
	readonly connectionId: string
	// Exact id of the device.
	readonly deviceId: string
	// Name of the device when the operation started; absent when it was not known.
	readonly name?: string
}

// Operation of the history.
export interface OperationRun {
	// Id of the operation.
	readonly operationId: string
	// Kind of operation.
	readonly kind: OperationKind
	// Devices it held.
	readonly devices: readonly OperationRunDevice[]
	// Outcome.
	readonly state: OperationRunState
	// Why it failed; present only when state is failed.
	readonly reason?: OperationFailureReason
	// When it started, Unix milliseconds (UTC).
	readonly startedAt: number
	// When it ended, Unix milliseconds (UTC); absent while running.
	readonly endedAt?: number
}

// Page of GET /api/operations/history: operations newest first.
export interface OperationHistoryPage {
	// Operations of the page, newest first.
	readonly items: readonly OperationRun[]
	// Cursor of the next page, the before parameter of the next request; absent on the last one.
	readonly next?: string
}

// Name of a device of a connection, or undefined when it is not known.
export type DeviceNameResolver = (connectionId: string, deviceId: string) => string | undefined

// Row of operation_runs.
interface OperationRunRow {
	readonly operation_id: string
	readonly kind: OperationKind
	readonly devices: string
	readonly state: OperationRunState
	readonly reason: OperationFailureReason | null
	readonly started_at: number
	readonly ended_at: number | null
}

// Returns the operation of a row.
function rowRun({ operation_id, kind, devices, state, reason, started_at, ended_at }: OperationRunRow): OperationRun {
	return { operationId: operation_id, kind, devices: JSON.parse(devices) as OperationRunDevice[], state, ...(reason !== null && { reason }), startedAt: started_at, ...(ended_at !== null && { endedAt: ended_at }) }
}

// Records the start and the end of every device operation in the operational database.
export class OperationRecorder {
	// Operations whose start was recorded and whose end was not yet, so a progress writes nothing.
	readonly #running = new Set<string>()

	// Creates the recorder of database, naming the devices of an operation through name, at the instants of now.
	constructor(
		readonly database: AppDatabase,
		readonly name: DeviceNameResolver = () => undefined,
		readonly now: () => number = Date.now,
	) {}

	// Records the operations a previous run of the server left running as interrupted, at now. Returns how many there were.
	interruptRunning(): number {
		return this.database.db.query("UPDATE operation_runs SET state = 'interrupted', ended_at = ? WHERE state = 'running'").run(this.now()).changes
	}

	// Records the start or the end of an operation an event reports; any other event, and a progress, writes nothing.
	// Never throws.
	consume(event: ServerEvent) {
		if (event.type !== 'operation:updated') return
		const { operationId, kind, devices, state, reason, startedAt } = event.operation

		try {
			if (state === 'running') {
				if (this.#running.has(operationId)) return
				const named = devices.map(({ connectionId, deviceId }) => ({ connectionId, deviceId, name: this.name(connectionId, deviceId) }))
				this.database.db.query("INSERT OR IGNORE INTO operation_runs (operation_id, kind, devices, state, started_at) VALUES (?, ?, ?, 'running', ?)").run(operationId, kind, JSON.stringify(named), startedAt)
				this.#running.add(operationId)
				return
			}

			this.#running.delete(operationId)
			const now = this.now()

			this.database.write(() => {
				const { db } = this.database
				db.query('UPDATE operation_runs SET state = ?, reason = ?, ended_at = ? WHERE operation_id = ?').run(state, reason ?? null, now, operationId)
				db.query('DELETE FROM operation_runs WHERE started_at < ? OR rowid IN (SELECT rowid FROM operation_runs ORDER BY started_at DESC LIMIT -1 OFFSET ?)').run(now - OPERATION_RETENTION, MAX_OPERATION_RUNS)
			})
		} catch (error) {
			console.warn('operations: an operation cannot be recorded in the history', error)
		}
	}

	// Returns a page of the history, newest first: at most limit operations after the cursor before (the next of the
	// previous page: the start instant, in Unix milliseconds, and the id of its last operation), or the newest ones.
	// Operations that started in the same millisecond, as the operations a composed tool starts together, are ordered by
	// their id, so a page boundary between them loses none.
	history(before?: string, limit: number = MAX_OPERATION_PAGE): OperationHistoryPage {
		const size = Math.min(Math.max(1, limit), MAX_OPERATION_PAGE)
		const separator = before?.indexOf(':') ?? -1
		const startedAt = before === undefined ? Number.MAX_SAFE_INTEGER : Number(before.slice(0, separator))
		const operationId = before === undefined ? '' : before.slice(separator + 1)
		const rows = this.database.db.query<OperationRunRow, [number, string, number]>('SELECT * FROM operation_runs WHERE started_at < ?1 OR (started_at = ?1 AND operation_id > ?2) ORDER BY started_at DESC, operation_id LIMIT ?3').all(startedAt, operationId, size)
		const items = rows.map(rowRun)
		const last = items.at(-1)
		return items.length === size && last ? { items, next: `${last.startedAt}:${last.operationId}` } : { items }
	}
}

// Routes of the operation history.
export function createOperationHistoryRoutes(recorder: OperationRecorder) {
	return {
		'/api/operations/history': {
			// A page of the history, newest first (OperationHistoryPage): ?before= the next cursor, &limit= at most
			// MAX_OPERATION_PAGE operations.
			GET: (req) => {
				const params = new URL(req.url).searchParams
				const before = params.get('before')
				const limit = params.get('limit')
				return Response.json(recorder.history(before ?? undefined, limit === null ? undefined : Number(limit)))
			},
		},
	} as const satisfies Bun.Serve.Routes<undefined, string>
}
