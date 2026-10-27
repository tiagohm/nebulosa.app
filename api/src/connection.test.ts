import { afterEach, describe, expect, test } from 'bun:test'
import type { Focuser, Mount, Rotator, Wheel } from 'nebulosa/src/devices/indi/device'
import type { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import type { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { type ConnectionEvent, ConnectionManager } from './connection'
import type { DeviceEvent, DeviceSummary } from './devices'
import { routes, websocket } from './index'
import type { ServerEvent } from './websocket'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0)) disposable[Symbol.dispose]()
})

function newManager() {
	const manager = new ConnectionManager()
	const events: ConnectionEvent[] = []
	const deviceEvents: DeviceEvent[] = []
	manager.listen((event) => (event.type.startsWith('connection:') ? events.push(event as ConnectionEvent) : deviceEvents.push(event as DeviceEvent)))
	disposables.push(manager)
	return { manager, events, deviceEvents }
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
		expect(events.at(-1)).toEqual({ type: 'connection:close', id, cause: 'requested' })
		expect(events).toHaveLength(2)
	})
})

describe('simulator devices', () => {
	test('are listed by managed type and attributed to the connection', async () => {
		const { manager, deviceEvents } = newManager()
		const { id } = await manager.connect({ type: 'SIMULATOR' })
		const devices = manager.devices.list(manager.client(id)!)

		expect(new Set(devices.map((d) => d.type))).toEqual(new Set(['camera', 'mount', 'focuser', 'wheel', 'rotator', 'dome', 'cover', 'flatPanel']))
		expect(devices.every((d) => d.connectionId === id && !d.connected)).toBeTrue()
		expect(deviceEvents.filter((e) => e.type === 'device:added')).toHaveLength(devices.length)
	})

	test('connect and disconnect publish the new state', async () => {
		const { manager, deviceEvents } = newManager()
		const { id } = await manager.connect({ type: 'SIMULATOR' })
		const client = manager.client(id)!
		const mount = manager.devices.list(client).find((d) => d.type === 'mount')!

		expect(manager.devices.switch(client, mount.id, true)).toBeTrue()
		await Bun.sleep(50)
		expect(manager.devices.list(client).find((d) => d.id === mount.id)?.connected).toBeTrue()
		// The mount defines its guide output once connected.
		expect(manager.devices.list(client).some((d) => d.type === 'guideOutput')).toBeTrue()
		expect(deviceEvents).toContainEqual({ type: 'device:updated', connectionId: id, id: mount.id, connected: true, state: expect.anything() })

		expect(manager.devices.switch(client, mount.id, false)).toBeTrue()
		await Bun.sleep(50)
		expect(manager.devices.list(client).find((d) => d.id === mount.id)?.connected).toBeFalse()
		expect(manager.devices.switch(client, 'unknown', true)).toBeFalse()
	})

	test('the camera reads the snooped devices and renders the sky catalog', async () => {
		const { manager } = newManager()
		const { id } = await manager.connect({ type: 'SIMULATOR' })
		const client = manager.client(id) as ClientSimulator
		const devices = manager.devices.list(client)
		const deviceId = (type: DeviceSummary['type']) => devices.find((d) => d.type === type)!.id

		for (const type of ['camera', 'mount', 'focuser', 'wheel', 'rotator'] as const) manager.devices.switch(client, deviceId(type), true)
		await Bun.sleep(50)

		const camera = manager.devices.camera(client, deviceId('camera'))!
		const mount = manager.devices.get(client, deviceId('mount'), 'mount') as Mount
		const focuser = manager.devices.get(client, deviceId('focuser'), 'focuser') as Focuser
		const wheel = manager.devices.get(client, deviceId('wheel'), 'wheel') as Wheel
		const rotator = manager.devices.get(client, deviceId('rotator'), 'rotator') as Rotator
		manager.devices.cameras.snoop(camera, mount, focuser, wheel, rotator)

		const simulator = client.get(camera.name) as CameraSimulator
		expect(simulator.activeMount?.name).toBe(mount.name)
		expect(simulator.activeFocuser?.name).toBe(focuser.name)
		expect(simulator.activeFilter?.name).toBe(wheel.name)
		expect(simulator.activeRotator?.name).toBe(rotator.name)
		expect(simulator.catalogSourceType).toBe('SKY')
		expect(simulator.telescopeFocalLength).toBe(50)
	})

	test('keep their ids across reconnects', async () => {
		const { manager } = newManager()
		const first = await manager.connect({ type: 'SIMULATOR' })
		const before = manager.devices.list(manager.client(first.id)!).map((d) => d.id)
		manager.disconnect(first.id)
		const second = await manager.connect({ type: 'SIMULATOR' })

		expect(manager.devices.list(manager.client(second.id)!).map((d) => d.id)).toEqual(before)
	})

	test('are removed when the connection closes', async () => {
		const { manager, deviceEvents } = newManager()
		const { id } = await manager.connect({ type: 'SIMULATOR' })
		const client = manager.client(id)!
		const count = manager.devices.list(client).length
		manager.disconnect(id)

		expect(manager.devices.list(client)).toBeEmpty()
		expect(deviceEvents.filter((e) => e.type === 'device:removed')).toHaveLength(count)
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
			{ type: 'connection:close', id: a.id, cause: 'requested' },
		])
	})

	test('publishes a close initiated by the server once', async () => {
		const { port, sockets } = listenIndi()
		const { manager, events } = newManager()
		const { id } = await manager.connect({ type: 'INDI', host: '127.0.0.1', port })
		await Bun.sleep(50)

		for (const socket of sockets) socket.end()
		await Bun.sleep(100)

		expect(events.at(-1)).toEqual({ type: 'connection:close', id, cause: 'lost' })
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
		const messages: ServerEvent[] = []
		ws.addEventListener('message', (message: MessageEvent<string>) => messages.push(JSON.parse(message.data) as ServerEvent))
		await new Promise((resolve) => {
			ws.addEventListener('open', resolve)
		})
		disposables.push({ [Symbol.dispose]: () => ws.close() })

		const post = (body: string) => fetch(`${server.url}api/connections`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

		expect((await post(JSON.stringify({ type: 'INDI', host: '', port: 7624 }))).status).toBe(502)

		const response = await post(JSON.stringify({ type: 'SIMULATOR' }))
		expect(response.status).toBe(200)
		const status = (await response.json()) as { id: string }

		expect(await (await fetch(`${server.url}api/connections`)).json()).toEqual([{ type: 'SIMULATOR', id: status.id }])

		const devices = (await (await fetch(`${server.url}api/connections/${status.id}/devices`)).json()) as DeviceSummary[]
		const camera = devices.find((d) => d.type === 'camera')!
		const deviceUrl = `${server.url}api/connections/${status.id}/devices/${camera.id}`
		expect(camera.connected).toBeFalse()
		expect((await fetch(`${deviceUrl}/connect`, { method: 'POST' })).status).toBe(202)
		expect((await fetch(`${server.url}api/connections/${status.id}/devices/unknown/connect`, { method: 'POST' })).status).toBe(404)
		expect((await fetch(`${server.url}api/connections/unknown/devices`)).status).toBe(404)
		await Bun.sleep(50)
		expect(messages).toContainEqual({ type: 'device:updated', connectionId: status.id, id: camera.id, connected: true, state: expect.anything() })

		expect((await fetch(`${server.url}api/connections/${status.id}`, { method: 'DELETE' })).status).toBe(204)
		expect((await fetch(`${server.url}api/connections/${status.id}`, { method: 'DELETE' })).status).toBe(404)

		await Bun.sleep(50)
		expect(messages.filter((m) => m.type.startsWith('connection:'))).toEqual([
			{ type: 'connection:open', connection: { type: 'SIMULATOR', id: status.id } },
			{ type: 'connection:close', id: status.id, cause: 'requested' },
		])
		expect(messages.filter((m) => m.type === 'device:removed').length).toBeGreaterThanOrEqual(devices.length)
		expect(await (await fetch(`${server.url}api/connections`)).json()).toEqual([])
	})
})
