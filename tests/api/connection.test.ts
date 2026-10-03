import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Client, Device } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA } from 'nebulosa/src/devices/indi/device'
import type { DeviceProvider } from 'nebulosa/src/devices/indi/manager/device'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager/focuser'
import { GuideOutputManager } from 'nebulosa/src/devices/indi/manager/guideoutput'
import { MountManager } from 'nebulosa/src/devices/indi/manager/mount'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { CameraSimulator } from 'nebulosa/src/devices/indi/simulator/camera'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { ConnectionHandler, connectionBus } from 'src/api/connection'
import { startAlpacaConnection } from 'src/api/connection.alpaca'
import { startIndiConnection } from 'src/api/connection.indi'
import { startSimulatorConnection } from 'src/api/connection.simulator'
import type { ConnectionInitializers } from 'src/api/connection.start'
import { indiBus } from 'src/api/indi'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import type { Connect, ConnectionEvent } from '#/connection'
import { failedOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'

class TestIndiHandler extends IndiClientHandlerSet implements DeviceProvider<Device> {
	get(): Device | undefined {
		return undefined
	}
}

let appDir: string
const cleanup: (() => void | Promise<void>)[] = []
const request: Connect = { type: 'SIMULATOR', host: '', port: -1, secured: false }

beforeEach(async () => {
	appDir = await mkdtemp(join(tmpdir(), 'nebulosa-connection-'))
})

afterEach(async () => {
	for (const dispose of cleanup.splice(0).toReversed()) await dispose()
	await rm(appDir, { recursive: true, force: true })
})

function simulator() {
	return startSimulatorConnection({
		appDir,
		handler: new TestIndiHandler(),
		mountManager: new MountManager(),
		focuserManager: new FocuserManager(),
		rotatorManager: new RotatorManager(),
		guideOutputManager: new GuideOutputManager({ get: () => undefined }),
	})
}

function handlerFixture(initializers?: ConnectionInitializers, disconnectCleanupTimeout?: number) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const wsm = new WebSocketMessageHandler()
	const handler = new ConnectionHandler(wsm, new NotificationHandler(wsm), coordinator, initializers ?? { SIMULATOR: simulator }, disconnectCleanupTimeout)
	cleanup.push(async () => {
		for (const status of handler.list()) await handler.disconnect(status.id)
	})
	return { arbiter, coordinator, handler }
}

async function connectionFixture(disconnectCleanupTimeout?: number) {
	const fixture = handlerFixture(undefined, disconnectCleanupTimeout)
	const status = await fixture.handler.connect(request)
	if (status === undefined) throw new Error('simulator connection failed')
	return { ...fixture, status }
}

function openEvents() {
	const events: ConnectionEvent[] = []
	cleanup.push(
		connectionBus.subscribe('open', (event) => {
			events.push(event)
		}),
	)
	return events
}

function camera(clientId: string): Device {
	return {
		...structuredClone(DEFAULT_CAMERA),
		id: 'camera-1',
		name: 'camera-1',
		connected: true,
		client: { type: 'SIMULATOR', id: clientId },
	}
}

describe('connection handler', () => {
	test('waits for client operation cleanup before disposing an expected disconnect', async () => {
		const { arbiter, coordinator, handler, status } = await connectionFixture()
		const clientId = status.id
		const device = camera(clientId)
		const key = resourceKey(device)
		const executorStarted = Promise.withResolvers<void>()
		const cleanupStarted = Promise.withResolvers<void>()
		const cleanupGate = Promise.withResolvers<void>()
		const handle = coordinator.start('capture', [{ key, device }], (context) => {
			context.onCleanup(async () => {
				cleanupStarted.resolve()
				await cleanupGate.promise
			})
			executorStarted.resolve()

			return new Promise<OperationResult<void>>((resolve) => {
				context.signal.addEventListener('abort', () => resolve(failedOperationResult('disconnected')), { once: true })
			})
		})

		await executorStarted.promise
		const disconnected = handler.disconnect(clientId)
		await cleanupStarted.promise

		expect(handle.signal.aborted).toBeTrue()
		expect(handler.list()).toEqual([status])
		expect(arbiter.availability(key)).toBe('unavailable')

		cleanupGate.resolve()
		await disconnected

		expect(handler.list()).toEqual([])
		expect(await handle.result).toEqual(failedOperationResult('disconnected'))
	})

	test('bounds cleanup before disposing an unresponsive client operation', async () => {
		const { coordinator, handler, status } = await connectionFixture(5)
		const device = camera(status.id)
		const executor = Promise.withResolvers<OperationResult<void>>()
		const handle = coordinator.start('capture', [{ key: resourceKey(device), device }], () => executor.promise)

		await handler.disconnect(status.id)

		expect(handle.signal.aborted).toBeTrue()
		expect(handler.list()).toEqual([])

		executor.resolve(failedOperationResult('disconnected'))
		expect(await handle.result).toEqual(failedOperationResult('disconnected'))
	})
})

describe('connection initialization', () => {
	test('starts and reuses an INDI transport, then accepts a fresh reconnect', async () => {
		const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
		cleanup.push(() => server.stop(true))
		const { handler } = handlerFixture({ INDI: (request) => startIndiConnection(request, new TestIndiHandler()) })
		const req: Connect = { type: 'INDI', host: '127.0.0.1', port: server.port, secured: false }
		const [first, duplicate] = await Promise.all([handler.connect(req), handler.connect(req)])
		expect(first).toMatchObject({ type: 'INDI', host: req.host, port: req.port })
		expect(duplicate).toEqual(first)
		const client = handler.get(first!.id)
		expect(await handler.connect(req)).toEqual(first)
		expect(handler.get(first!.id)).toBe(client)
		await handler.disconnect(first!.id)
		expect(handler.list()).toEqual([])
		const next = await handler.connect(req)
		expect(next).toEqual(first)
		expect(handler.get(next!.id)).not.toBe(client)
	})

	test('a refused INDI transport leaves no active connection', async () => {
		const server = Bun.listen({ hostname: '127.0.0.1', port: 0, socket: { data() {} } })
		const port = server.port
		server.stop(true)
		const { handler } = handlerFixture({ INDI: (request) => startIndiConnection(request, new TestIndiHandler()) })
		const events = openEvents()
		expect(await handler.connect({ type: 'INDI', host: '127.0.0.1', port, secured: false })).toBeUndefined()
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
	})

	test('ALPACA startup can be retried after discovery reports no devices', async () => {
		let available = false
		const polled = Promise.withResolvers<void>()
		const server = Bun.serve({
			hostname: '127.0.0.1',
			port: 0,
			fetch(request: Request) {
				const management = new URL(request.url).pathname.endsWith('/configureddevices')
				if (!management) polled.resolve()
				const devices = available ? [{ DeviceName: 'Test Wheel', DeviceType: 'FilterWheel', DeviceNumber: 0, UniqueID: 'test-wheel' }] : []
				return Response.json({ Value: management ? devices : false, ErrorNumber: 0, ErrorMessage: '', ClientTransactionID: 0, ServerTransactionID: 0 })
			},
		})
		cleanup.push(async () => {
			await server.stop(true)
		})
		const { handler } = handlerFixture({ ALPACA: (request) => startAlpacaConnection(request, new TestIndiHandler()) })
		const req: Connect = { type: 'ALPACA', host: '127.0.0.1', port: server.port!, secured: false }
		const events = openEvents()
		expect(await handler.connect(req)).toBeUndefined()
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
		available = true
		const status = await handler.connect(req)
		expect(status).toMatchObject({ type: 'ALPACA', host: req.host, port: req.port })
		expect(await handler.connect(req)).toEqual(status)
		expect(handler.list()).toEqual([status!])
		await polled.promise
		await handler.disconnect(status!.id)
		expect(handler.list()).toEqual([])
	})

	test('shares concurrent startup and publishes only fully initialized devices', async () => {
		const gate = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		let attempts = 0
		const { handler, arbiter } = handlerFixture({
			SIMULATOR: () => {
				attempts++
				const prepared = simulator()
				return {
					client: prepared.client,
					start: async () => {
						started.resolve()
						await gate.promise
						return prepared.start()
					},
				}
			},
		})
		const events = openEvents()
		const first = handler.connect(request)
		const second = handler.connect(request)
		await started.promise
		expect(attempts).toBe(1)
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
		const device = camera('client.simulator')
		arbiter.markAvailable({ key: resourceKey(device), device })
		expect(arbiter.availability(resourceKey(device))).toBe('unavailable')
		gate.resolve()
		const [a, b] = await Promise.all([first, second])
		expect(a).toBeDefined()
		expect(b).toEqual(a)
		expect(handler.list()).toEqual([a!])
		const client = handler.get(a!.id)
		expect(client).toBeInstanceOf(ClientSimulator)
		if (!(client instanceof ClientSimulator)) throw new Error('expected simulator')
		expect(client.get('Camera Simulator')).toBeInstanceOf(CameraSimulator)
		expect(client.get('Guide Camera Simulator')).toBeInstanceOf(CameraSimulator)
		expect(events).toEqual([{ status: a!, reused: false }])
		expect(await handler.connect(request)).toEqual(a)
		expect(events.at(-1)?.reused).toBeTrue()
		expect(attempts).toBe(1)
	})

	test('disposes partially initialized devices on failure and permits a fresh retry', async () => {
		let failedClient: Client | undefined
		let attempts = 0
		const { handler, arbiter } = handlerFixture({
			SIMULATOR: () => {
				const prepared = simulator()
				attempts++
				if (attempts > 1) return prepared
				failedClient = prepared.client
				return {
					client: prepared.client,
					start: async () => {
						await prepared.start()
						throw new Error('startup interrupted after device registration')
					},
				}
			},
		})
		const events = openEvents()
		expect(await handler.connect(request)).toBeUndefined()
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
		if (!(failedClient instanceof ClientSimulator)) throw new Error('expected failed simulator')
		expect(failedClient.get('Camera Simulator')).toBeUndefined()
		expect(failedClient.get('Mount Simulator')).toBeUndefined()
		const device = camera(failedClient.id)
		arbiter.markAvailable({ key: resourceKey(device), device })
		expect(arbiter.availability(resourceKey(device))).toBe('unavailable')
		const status = await handler.connect(request)
		expect(status).toBeDefined()
		expect(handler.get(status!.id)).not.toBe(failedClient)
		expect(attempts).toBe(2)
		expect(events).toEqual([{ status: status!, reused: false }])
	})

	test('a corrupt optional catalog cannot leave a partially registered connection', async () => {
		await Bun.write(join(appDir, 'HNSKY_g14.tar'), 'invalid archive')
		const { handler, status } = await connectionFixture()
		const client = handler.get(status.id)
		if (!(client instanceof ClientSimulator)) throw new Error('expected simulator')
		const camera = client.get('Camera Simulator')
		const guide = client.get('Guide Camera Simulator')
		if (!(camera instanceof CameraSimulator) || !(guide instanceof CameraSimulator)) throw new Error('expected cameras')
		expect(camera.options?.catalogSources).toBe(guide.options?.catalogSources)
		const source = camera.options?.catalogSources?.HNSKY_G14
		expect(source).toBeDefined()
		const [query] = await Promise.allSettled([source!(0, 0, 0.01)])
		expect(query.status).toBe('rejected')
		expect(handler.list()).toEqual([status])
		expect(client.get('Dust Cap Simulator')).toBeDefined()
	})

	test('disconnect during initialization drains and discards the late result', async () => {
		const gate = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		const prepared = simulator()
		const { handler } = handlerFixture({
			SIMULATOR: () => ({
				client: prepared.client,
				start: async () => {
					started.resolve()
					await gate.promise
					return prepared.start()
				},
			}),
		})
		const events = openEvents()
		const connecting = handler.connect(request)
		await started.promise
		let disconnected = false
		const disconnecting = handler.disconnect(prepared.client.id).then(() => {
			disconnected = true
		})
		expect(disconnected).toBeFalse()
		gate.resolve()
		expect(await connecting).toBeUndefined()
		await disconnecting
		expect(disconnected).toBeTrue()
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
		if (!(prepared.client instanceof ClientSimulator)) throw new Error('expected simulator')
		expect(prepared.client.get('Camera Simulator')).toBeUndefined()
	})

	test('unexpected close while starting cannot publish a stale connection', async () => {
		const gate = Promise.withResolvers<void>()
		const started = Promise.withResolvers<void>()
		const prepared = simulator()
		const { handler } = handlerFixture({
			SIMULATOR: () => ({
				client: prepared.client,
				start: async () => {
					started.resolve()
					await gate.promise
					return prepared.start()
				},
			}),
		})
		const events = openEvents()
		const connecting = handler.connect(request)
		await started.promise
		indiBus.emit('close', prepared.client)
		gate.resolve()
		expect(await connecting).toBeUndefined()
		expect(handler.list()).toEqual([])
		expect(events).toEqual([])
	})

	test('unsupported protocols never fall through to the simulator initializer', async () => {
		let attempts = 0
		const { handler } = handlerFixture({
			SIMULATOR: () => {
				attempts++
				return simulator()
			},
		})
		expect(await handler.connect({ ...request, type: 'FIRMATA' })).toBeUndefined()
		expect(handler.list()).toEqual([])
		expect(attempts).toBe(0)
	})
})
