import { afterEach, describe, expect, spyOn, test } from 'bun:test'
import { proxy } from 'valtio'
import { MemoryStorage } from '../storage.memory'
import { connect, CONNECTIONS_KEY, type ConnectionState, disconnect, handleConnectionEvent, highlightConnection, loadConnections, persistConnections, removeConnection, saveConnection, SELECTED_CONNECTION_KEY, serverOf } from './connection'

function newState(): ConnectionState {
	return { open: true, connections: [], servers: [], errors: {} }
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

describe('highlight connection', () => {
	test('highlights a saved connection and ignores an absent or unknown one', () => {
		const state = newState()
		const a = saveConnection(state, { name: 'A', host: 'a', port: 1, type: 'INDI' })!
		saveConnection(state, { name: 'B', host: 'b', port: 2, type: 'INDI' })

		highlightConnection(state, a.id)
		expect(state.selected).toBe(a.id)

		highlightConnection(state, undefined)
		highlightConnection(state, 'gone')
		expect(state.selected).toBe(a.id)
	})
})

describe('persistence', () => {
	test('restores saved connections and skips unreadable entries', () => {
		const storage = new MemoryStorage()
		storage.setItem(CONNECTIONS_KEY, JSON.stringify([{ id: 'a', name: 'A', host: 'h', port: 1, type: 'INDI' }, { id: 'b' }, 42, { id: 'a', name: 'dup', type: 'SIMULATOR' }]))
		const state = newState()

		loadConnections(state, storage)

		expect(state.connections).toEqual([{ id: 'a', name: 'A', host: 'h', port: 1, type: 'INDI' }])
		expect(state.selected).toBe('a')
	})

	test('loads invalid JSON as empty without overwriting it', () => {
		const storage = new MemoryStorage()
		storage.setItem(CONNECTIONS_KEY, '{not json')
		const state = proxy(newState())

		loadConnections(state, storage)
		persistConnections(state, storage)

		expect(state.connections).toBeEmpty()
		expect(storage.getItem(CONNECTIONS_KEY)).toBe('{not json')
	})

	test('restores the last highlighted connection, or the first when it no longer exists', () => {
		const storage = new MemoryStorage()
		storage.setItem(
			CONNECTIONS_KEY,
			JSON.stringify([
				{ id: 'a', name: 'A', type: 'SIMULATOR' },
				{ id: 'b', name: 'B', type: 'SIMULATOR' },
			]),
		)
		storage.setItem(SELECTED_CONNECTION_KEY, 'b')
		const state = newState()

		loadConnections(state, storage)
		expect(state.selected).toBe('b')

		storage.setItem(SELECTED_CONNECTION_KEY, 'gone')
		loadConnections(state, storage)
		expect(state.selected).toBe('a')
	})

	test('writes the highlighted connection', async () => {
		const storage = new MemoryStorage()
		const state = proxy(newState())
		loadConnections(state, storage)
		persistConnections(state, storage)

		const saved = saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })!
		await Bun.sleep(0)
		expect(storage.getItem(SELECTED_CONNECTION_KEY)).toBe(saved.id)

		removeConnection(state, saved.id)
		await Bun.sleep(0)
		expect(storage.getItem(SELECTED_CONNECTION_KEY)).toBe('')
	})

	test('writes later changes', async () => {
		const storage = new MemoryStorage()
		const state = proxy(newState())
		loadConnections(state, storage)
		persistConnections(state, storage)

		const saved = saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })!
		await Bun.sleep(0)

		expect(JSON.parse(storage.getItem(CONNECTIONS_KEY)!)).toEqual([saved])
	})
})

describe('server of a connection', () => {
	test('matches the endpoint, ignoring host case', () => {
		const servers = [
			{ type: 'INDI', host: 'pi.local', port: 7624, id: 's1' },
			{ type: 'SIMULATOR', id: 's2' },
		] as const

		expect(serverOf(servers, { name: 'Pi', host: 'PI.local', port: 7624, type: 'INDI' })?.id).toBe('s1')
		expect(serverOf(servers, { name: 'Pi', host: 'pi.local', port: 7625, type: 'INDI' })).toBeUndefined()
		expect(serverOf(servers, { name: 'Sim', host: '', port: 0, type: 'SIMULATOR' })?.id).toBe('s2')
		expect(serverOf(servers, undefined)).toBeUndefined()
	})
})

describe('connect and disconnect', () => {
	const fetchSpy = spyOn(globalThis, 'fetch')

	afterEach(() => fetchSpy.mockReset())

	test('connect records the open server connection and ignores repeated clicks', async () => {
		const state = newState()
		const sim = saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })!
		fetchSpy.mockResolvedValue(Response.json({ type: 'SIMULATOR', id: 'server-1' }))

		const pending = connect(state, sim)
		expect(state.loading).toEqual({ kind: 'connect', connectionId: sim.id })
		await Promise.all([pending, connect(state, sim)])

		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({ type: 'SIMULATOR' })
		expect(state.servers).toEqual([{ type: 'SIMULATOR', id: 'server-1' }])
		expect(state.loading).toBeUndefined()
	})

	test('connect stores the server error', async () => {
		const state = newState()
		const indi = saveConnection(state, { name: 'Pi', host: 'pi.local', port: 7624, type: 'INDI' })!
		fetchSpy.mockResolvedValue(Response.json({ error: 'Unable to connect' }, { status: 502 }))

		await connect(state, indi)

		expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({ type: 'INDI', host: 'pi.local', port: 7624 })
		expect(state.servers).toBeEmpty()
		expect(state.errors).toEqual({ [indi.id]: 'Unable to connect' })
	})

	test('disconnect forgets the server connection, also when the server no longer has it', async () => {
		for (const status of [204, 404]) {
			const state = newState()
			const sim = saveConnection(state, { name: 'Sim', host: '', port: 7624, type: 'SIMULATOR' })!
			state.servers = [{ type: 'SIMULATOR', id: 'server-1' }]
			fetchSpy.mockResolvedValue(new Response(null, { status }))

			await disconnect(state, sim)

			expect(fetchSpy).toHaveBeenLastCalledWith('/api/connections/server-1', { method: 'DELETE' })
			expect(state.servers).toBeEmpty()
			expect(state.errors).toEqual({})
		}
	})
})

describe('connection events', () => {
	test('open and close update the server connections once', () => {
		const state = newState()

		handleConnectionEvent(state, { type: 'connection:open', connection: { type: 'SIMULATOR', id: 'server-1' } })
		handleConnectionEvent(state, { type: 'connection:open', connection: { type: 'SIMULATOR', id: 'server-1' } })
		handleConnectionEvent(state, { type: 'connection:close', id: 'server-2', cause: 'requested' })
		expect(state.servers).toEqual([{ type: 'SIMULATOR', id: 'server-1' }])

		handleConnectionEvent(state, { type: 'connection:close', id: 'server-1', cause: 'requested' })
		expect(state.servers).toBeEmpty()
	})
})

describe('connection errors', () => {
	test('belong to their connection and clear when it opens or is edited', () => {
		const state = newState()
		const a = saveConnection(state, { name: 'A', host: 'a', port: 1, type: 'INDI' })!
		const b = saveConnection(state, { name: 'B', host: 'b', port: 2, type: 'INDI' })!
		state.errors[a.id] = 'refused'
		state.errors[b.id] = 'timeout'

		handleConnectionEvent(state, { type: 'connection:open', connection: { type: 'INDI', host: 'A', port: 1, id: 's-a' } })
		expect(state.errors).toEqual({ [b.id]: 'timeout' })

		saveConnection(state, { name: 'B', host: 'b2', port: 2, type: 'INDI' }, b.id)
		expect(state.errors).toEqual({})
	})
})
