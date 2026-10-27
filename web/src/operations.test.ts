import { expect, test } from 'bun:test'
import type { OperationRecord } from 'api'
import { proxy } from 'valtio'
import { deviceBusy, handleOperationEvent, type OperationsState, refreshOperations, runningOn } from './operations'

function operation(operationId: string, state: OperationRecord['state'] = 'running', connectionId = 'a', deviceId = 'm1', startedAt = 1): OperationRecord {
	return { operationId, kind: 'mount.slew', devices: [{ connectionId, deviceId }], state, startedAt }
}

function newState() {
	return proxy<OperationsState>({ operations: {} })
}

test('follows operation events and ignores other events', () => {
	const state = newState()

	handleOperationEvent(state, { type: 'connection:close', id: 'a', cause: 'requested' })
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('x') })
	expect(state.operations.x?.state).toBe('running')

	handleOperationEvent(state, { type: 'operation:updated', operation: operation('x', 'succeeded') })
	expect(state.operations.x?.state).toBe('succeeded')
})

test('keeps every running operation and only the latest finished ones', () => {
	const state = newState()

	handleOperationEvent(state, { type: 'operation:updated', operation: operation('run') })
	for (let i = 0; i < 40; i++) handleOperationEvent(state, { type: 'operation:updated', operation: operation(`f${i}`, 'failed') })

	expect(state.operations.run).toBeDefined()
	expect(state.operations.f0).toBeUndefined()
	expect(state.operations.f39).toBeDefined()
	expect(Object.keys(state.operations)).toHaveLength(33)
})

test('a refresh replaces the running operations with the server list', async () => {
	const state = newState()
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('gone') })
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('done', 'succeeded') })

	await refreshOperations(state, (() => Promise.resolve(Response.json([operation('other')]))) as unknown as typeof fetch)

	expect(Object.keys(state.operations).toSorted()).toEqual(['done', 'other'])
})

test('a device is busy only while a running operation holds exactly it', () => {
	const state = newState()
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('b', 'running', 'a', 'm1', 2) })
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('a', 'running', 'a', 'm1', 1) })
	handleOperationEvent(state, { type: 'operation:updated', operation: operation('c', 'failed', 'a', 'm2') })

	expect(runningOn(state, 'a', 'm1').map((o) => o.operationId)).toEqual(['a', 'b'])
	expect(deviceBusy(state, 'b', 'm1')).toBeFalse()
	expect(deviceBusy(state, 'a', 'm2')).toBeFalse()
})
