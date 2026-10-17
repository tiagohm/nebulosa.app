import { afterEach, describe, expect, test } from 'bun:test'
import { type ConnectionEvent, ConnectionManager } from './connection'
import { routes, websocket } from './index'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable[Symbol.dispose]()
})

function newManager() {
	const manager = new ConnectionManager()
	const events: ConnectionEvent[] = []
	manager.listen((event) => events.push(event))
	disposables.push(manager)
	return { manager, events }
}

// Fake indiserver: accepts sockets and can drop them from the server side.
function listenIndi() {
	const sockets = new Set<Bun.Socket>()
	const server = Bun.listen({
		hostname: '127.0.0.1',
		port: 0,
		socket: {
			open: (socket) => void sockets.add(socket),
			data: () => {},
			close: (socket) => void sockets.delete(socket),
		},
	})
	disposables.push({ [Symbol.dispose]: () => server.stop(true) })
	return { port: server.port, sockets }
}

describe('simulator connection', () => {
	test('is opened once and shared', async () => {
		const { manager, events } = newManager()
		const [a, b] = await Promise.all([manager.connect({ type: 'SIMULATOR' }), manager.connect({ type: 'SIMULATOR' })])
		const c = await manager.connect({ type: 'SIMULATOR' })

		expect(a).toEqual({ type: 'SIMULATOR', id: expect.any(String) })
		expect(b).toBe(a)
		expect(c).toBe(a)
		expect(events).toEqual([{ type: 'connection:open', connection: a }])
	})

	test('disconnect closes it once', async () => {
		const { manager, events } = newManager()
		const { id } = await manager.connect({ type: 'SIMULATOR' })

		expect(manager.disconnect(id)).toBeTrue()
		expect(manager.disconnect(id)).toBeFalse()
		expect(events.at(-1)).toEqual({ type: 'connection:close', id })
		expect(events).toHaveLength(2)
	})
})

describe('indi connection', () => {
	test('is deduplicated by endpoint', async () => {
		const { port, sockets } = listenIndi()
		const { manager, events } = newManager()
		const a = await manager.connect({ type: 'INDI', host: '127.0.0.1', port })
		const b = await manager.connect({ type: 'INDI', host: '127.0.0.1', port })

		expect(a).toEqual({ type: 'INDI', host: '127.0.0.1', port, id: expect.any(String) })
		expect(b).toBe(a)
		expect(events).toHaveLength(1)
		await Bun.sleep(50)
		expect(sockets.size).toBe(1)

		expect(manager.disconnect(a.id)).toBeTrue()
		await Bun.sleep(50)
		expect(events).toEqual([
			{ type: 'connection:open', connection: a },
			{ type: 'connection:close', id: a.id },
		])
	})

	test('publishes a close initiated by the server once', async () => {
		const { port, sockets } = listenIndi()
		const { manager, events } = newManager()
		const { id } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port })
		await Bun.sleep(50)

		for (const socket of sockets) socket.end()
		await Bun.sleep(100)

		expect(events.at(-1)).toEqual({ type: 'connection:close', id })
		expect(events).toHaveLength(2)
		expect(manager.disconnect(id)).toBeFalse()
	})

	test('rejects an unreachable server', async () => {
		const listener = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data: () => {} } })
		const port = listener.port
		listener.stop(true)
		const { manager, events } = newManager()

		const error = await manager.connect({ type: 'INDI', host: '127.0.0.1', port }).catch((e: unknown) => e)

		expect(error).toBeInstanceOf(Error)
		expect((error as Error).message).toBe(`Unable to connect to INDI server at 127.0.0.1:${port}`)
		await Bun.sleep(50)
		expect(events).toBeEmpty()
	})
})

describe('routes', () => {
	test('connect, broadcast, and disconnect over HTTP', async () => {
		const server = Bun.serve({ hostname: '127.0.0.1', port: 0, routes, websocket })
		disposables.push({ [Symbol.dispose]: () => void server.stop(true) })

		const ws = new WebSocket(`ws://127.0.0.1:${server.port}/api/ws`)
		const messages: ConnectionEvent[] = []
		ws.addEventListener('message', (message: MessageEvent<string>) => messages.push(JSON.parse(message.data) as ConnectionEvent))
		await new Promise((resolve) => {
			ws.addEventListener('open', resolve)
		})
		disposables.push({ [Symbol.dispose]: () => ws.close() })

		const post = (body: string) => fetch(`${server.url}api/connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

		expect((await post(JSON.stringify({ type: 'INDI', host: '', port: 7624 }))).status).toBe(502)

		const response = await post(JSON.stringify({ type: 'SIMULATOR' }))
		expect(response.status).toBe(200)
		const status = (await response.json()) as { id: string }

		expect((await fetch(`${server.url}api/connections/${status.id}`, { method: 'DELETE' })).status).toBe(204)
		expect((await fetch(`${server.url}api/connections/${status.id}`, { method: 'DELETE' })).status).toBe(404)

		await Bun.sleep(50)
		expect(messages).toEqual([
			{ type: 'connection:open', connection: { type: 'SIMULATOR', id: status.id } },
			{ type: 'connection:close', id: status.id },
		])
	})
})
