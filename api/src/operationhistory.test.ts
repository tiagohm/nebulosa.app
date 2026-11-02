import { expect, test } from 'bun:test'
import { AppDatabase } from './database'
import { createOperationHistoryRoutes, MAX_OPERATION_RUNS, OPERATION_RETENTION, type OperationHistoryPage, OperationRecorder } from './operationhistory'
import type { OperationRecord } from './operations'
import type { ServerEvent } from './websocket'

// Event of an operation of the mount, in a state.
function event(operationId: string, patch: Partial<OperationRecord> = {}, startedAt = 1000): ServerEvent {
	return { type: 'operation:updated', operation: { operationId, kind: 'mount.goto', devices: [{ connectionId: 'c', deviceId: 'mount' }], state: 'running', startedAt, ...patch } }
}

function setup(now = () => 5000) {
	const database = AppDatabase.memory()
	const recorder = new OperationRecorder(database, (connectionId, deviceId) => `${connectionId}/${deviceId}`, now)
	return { database, recorder }
}

test('records the start and the end of an operation, with the names of its devices, never its error text', () => {
	const { recorder } = setup()
	recorder.consume(event('a'))
	recorder.consume(event('a', { state: 'failed', reason: 'timeout', error: 'C:\\secret\\path' }))

	const { items } = recorder.history()
	expect(items).toEqual([{ operationId: 'a', kind: 'mount.goto', devices: [{ connectionId: 'c', deviceId: 'mount', name: 'c/mount' }], state: 'failed', reason: 'timeout', startedAt: 1000, endedAt: 5000 }])
	expect(JSON.stringify(items)).not.toContain('secret')
})

test('a progress writes nothing, and other events are ignored', () => {
	const { database, recorder } = setup()
	recorder.consume(event('a'))
	const changes = database.db.query('SELECT total_changes() AS changes').get()
	recorder.consume(event('a', { progress: { step: 1, steps: 2, message: 'Moving' } }))
	recorder.consume({ type: 'connection:close', id: 'c', cause: 'requested' })
	expect(database.db.query('SELECT total_changes() AS changes').get()).toEqual(changes)
})

test('operations a previous run left running are interrupted, and nothing resumes them', () => {
	const { database, recorder } = setup()
	recorder.consume(event('a'))

	const restarted = new OperationRecorder(database, undefined, () => 9000)
	expect(restarted.interruptRunning()).toBe(1)
	expect(restarted.history().items).toMatchObject([{ operationId: 'a', state: 'interrupted', endedAt: 9000 }])
	expect(restarted.interruptRunning()).toBe(0)
})

test('old operations are deleted as others end', () => {
	let now = 1000
	const { recorder } = setup(() => now)
	recorder.consume(event('old', {}, 1000))
	recorder.consume(event('old', { state: 'succeeded' }, 1000))

	now = 2000 + OPERATION_RETENTION
	recorder.consume(event('new', {}, now))
	recorder.consume(event('new', { state: 'succeeded' }, now))
	expect(recorder.history().items.map(({ operationId }) => operationId)).toEqual(['new'])
	expect(MAX_OPERATION_RUNS).toBe(10000)
})

test('the history is paged newest first through its route', async () => {
	const { recorder } = setup()
	for (let i = 1; i <= 5; i++) recorder.consume(event(`op${i}`, {}, i * 100))

	const routes = createOperationHistoryRoutes(recorder)
	const first = (await routes['/api/operations/history'].GET(new Request('http://localhost/api/operations/history?limit=2') as never).json()) as OperationHistoryPage
	expect(first.items.map(({ operationId }) => operationId)).toEqual(['op5', 'op4'])
	expect(first.next).toBe('400')

	const second = (await routes['/api/operations/history'].GET(new Request(`http://localhost/api/operations/history?limit=2&before=${first.next}`) as never).json()) as OperationHistoryPage
	expect(second.items.map(({ operationId }) => operationId)).toEqual(['op3', 'op2'])
})

test('a row that cannot be written never throws into the publisher', () => {
	const { database, recorder } = setup()
	database.db.run('PRAGMA query_only = ON')
	expect(() => recorder.consume(event('a'))).not.toThrow()
	expect(() => recorder.consume(event('a', { state: 'succeeded' }))).not.toThrow()
})
