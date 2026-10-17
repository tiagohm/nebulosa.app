import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { connect, type ConnectionState, disconnect, handleConnectionEvent, removeConnection, saveConnection } from './connection'

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

	test('accepts a blank host for a simulator', () => {
		const state = newState()

		expect(saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })).toEqual({ id: expect.any(String), name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })
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

describe('connect and disconnect', () => {
	const fetchSpy = spyOn(globalThis, 'fetch')

	afterEach(() => fetchSpy.mockReset())

	test('connect makes the server connection active and ignores repeated clicks', async () => {
		const state = newState()
		const sim = saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })!
		fetchSpy.mockResolvedValue(Response.json({ type: 'SIMULATOR', id: 'server-1' }))

		const pending = connect(state, sim)
		expect(state.loading).toBe('connect')
		await Promise.all([pending, connect(state, sim)])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({ type: 'SIMULATOR' })
		expect(state.active).toEqual({ connectionId: sim.id, serverId: 'server-1' })
		expect(state.loading).toBeUndefined()

		await connect(state, sim)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
	})

	test('connect stores the server error', async () => {
		const state = newState()
		const indi = saveConnection(state, { name: 'Pi', host: 'pi.local', port: 7624, type: 'INDI' })!
		fetchSpy.mockResolvedValue(Response.json({ error: 'Unable to connect' }, { status: 502 }))

		await connect(state, indi)

		expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({ type: 'INDI', host: 'pi.local', port: 7624 })
		expect(state.active).toBeUndefined()
		expect(state.error).toBe('Unable to connect')
	})

	test('disconnect releases the active connection, also when the server no longer has it', async () => {
		for (const status of [204, 404]) {
			const state: ConnectionState = { ...newState(), active: { connectionId: 'a', serverId: 'server-1' } }
			fetchSpy.mockResolvedValue(new Response(null, { status }))

			await disconnect(state)

			expect(fetchSpy).toHaveBeenLastCalledWith('/api/connections/server-1', { method: 'DELETE' })
			expect(state.active).toBeUndefined()
			expect(state.error).toBeUndefined()
		}
	})
})

describe('connection events', () => {
	test('a close releases only the matching active connection', () => {
		const state: ConnectionState = { ...newState(), active: { connectionId: 'a', serverId: 'server-1' } }

		handleConnectionEvent(state, { type: 'connection:close', id: 'server-2' })
		handleConnectionEvent(state, { type: 'connection:open', connection: { type: 'SIMULATOR', id: 'server-1' } })
		expect(state.active).toEqual({ connectionId: 'a', serverId: 'server-1' })

		handleConnectionEvent(state, { type: 'connection:close', id: 'server-1' })
		expect(state.active).toBeUndefined()
	})
})
