import { describe, expect, test } from 'bun:test'
import { type ConnectionState, removeConnection, saveConnection } from './connection'

function newState(): ConnectionState {
	return { open: true, connections: [] }
}

describe('save connection', () => {
	test('adds a trimmed connection and selects it', () => {
		const state = newState()
		const saved = saveConnection(state, { name: ' Observatory ', host: ' 192.168.0.10 ', port: 7624, type: 'INDI' })

		expect(saved).toEqual({ id: expect.any(String), name: 'Observatory', host: '192.168.0.10', port: 7624, type: 'INDI' })
		expect(state.connections).toEqual([saved!])
		expect(state.selected).toBe(saved!.id)
	})

	test('rejects blank name or host', () => {
		const state = newState()

		expect(saveConnection(state, { name: '  ', host: 'localhost', port: 7624, type: 'INDI' })).toBeUndefined()
		expect(saveConnection(state, { name: 'Local', host: '', port: 7624, type: 'INDI' })).toBeUndefined()
		expect(state.connections).toBeEmpty()
	})

	test('replaces the connection with the given id in place', () => {
		const state = newState()
		const a = saveConnection(state, { name: 'A', host: 'a', port: 1, type: 'INDI' })!
		const b = saveConnection(state, { name: 'B', host: 'b', port: 2, type: 'INDI' })!
		const edited = saveConnection(state, { name: 'A2', host: 'a2', port: 11111, type: 'ALPACA' }, a.id)

		expect(edited).toEqual({ id: a.id, name: 'A2', host: 'a2', port: 11111, type: 'ALPACA' })
		expect(state.connections.map((c) => c.id)).toEqual([a.id, b.id])
		expect(state.selected).toBe(a.id)
	})
})

describe('remove connection', () => {
	test('removes the connection and selects the first remaining one', () => {
		const state = newState()
		const a = saveConnection(state, { name: 'A', host: 'a', port: 1, type: 'INDI' })!
		const b = saveConnection(state, { name: 'B', host: 'b', port: 2, type: 'SIMULATOR' })!

		removeConnection(state, b.id)
		expect(state.connections).toEqual([a])
		expect(state.selected).toBe(a.id)

		removeConnection(state, a.id)
		expect(state.connections).toBeEmpty()
		expect(state.selected).toBeUndefined()
	})
})
