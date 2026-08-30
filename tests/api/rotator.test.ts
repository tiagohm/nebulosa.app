import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager/rotator'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { RotatorSimulator } from 'nebulosa/src/devices/indi/simulator/rotator'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { RotatorHandler, rotatorBus, rotator as rotatorEndpoints } from 'src/api/rotator'
import { RotatorCommander } from 'src/api/rotator.commander'
import { failedOperationResult } from '#/orchestration'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from '#/rotator'
import { json, noContent, SocketMessager, waitUntil } from './util'

rotatorBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const rotatorManager = new RotatorManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const rotatorCommander = new RotatorCommander(rotatorManager)
const rotatorHandler = new RotatorHandler(wsm, rotatorManager, new NotificationHandler(wsm), rotatorCommander, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(rotatorManager)
const endpoints = rotatorEndpoints(rotatorHandler)
const handler = new IndiClientHandlerSet([rotatorManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new RotatorSimulator('Rotator Simulator', client)
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	rotatorManager.disconnect(getRotator())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	rotatorManager.disconnect(getRotator())
})

function getRotator() {
	const device = rotatorManager.get(client, 'Rotator Simulator')!
	expect(device).toBeDefined()
	return device
}

function request(id = 'Rotator Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/rotators/${encodeURIComponent(id)}${search}`,
		params: { id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

async function succeeded(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
}

function free(device: Rotator) {
	return resourceArbiter.availability(resourceKey(device)) === 'available'
}

function rotatorUpdates(property: keyof Rotator & string) {
	return socket.filter<RotatorUpdated>((message) => message.type === 'rotator:update' && message.body.property === property)
}

async function connected(angle?: number) {
	const device = getRotator()

	rotatorManager.connect(device)

	expect(device.connected).toBeTrue()

	if (angle !== undefined) rotatorManager.syncTo(device, angle)

	await waitUntil(() => free(device) && (angle === undefined || device.angle.value === angle))

	return device
}

describe('rotator handler', () => {
	test('lists and returns rotators through endpoints', async () => {
		const device = getRotator()
		const list = await json<Rotator[]>(endpoints['/rotators'].GET(request()))
		const withId = await json<Rotator>(endpoints['/rotators/:id'].GET(request(device.id)))
		const listWithClient = await json<Rotator[]>(endpoints['/rotators'].GET(request('Rotator Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getRotator()

		wsm.open(socket)

		await waitUntil(() => socket.some<RotatorAdded>((message) => message.type === 'rotator:add'))

		const message = socket.find<RotatorAdded>((message) => message.type === 'rotator:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('rotator')
	})

	test('emits connection, capability, and angle metadata updates', () => {
		const device = getRotator()

		wsm.open(socket)
		socket.clear()

		rotatorManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.canAbort).toBeTrue()
		expect(device.canHome).toBeTrue()
		expect(device.canReverse).toBeTrue()
		expect(device.canSync).toBeTrue()
		expect(rotatorUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(rotatorUpdates('canAbort').at(-1)?.body.device.canAbort).toBeTrue()
		expect(rotatorUpdates('canHome').at(-1)?.body.device.canHome).toBeTrue()
		expect(rotatorUpdates('canReverse').at(-1)?.body.device.canReverse).toBeTrue()
		expect(rotatorUpdates('canSync').at(-1)?.body.device.canSync).toBeTrue()
		expect(rotatorUpdates('angle').at(-1)?.body.device.angle!.max).toBe(device.angle.max)

		rotatorManager.disconnect(device)

		expect(rotatorUpdates('connected').at(-1)?.body.device.connected).toBeFalse()
	})

	test('syncs angle and reverses direction through endpoints', async () => {
		wsm.open(socket)

		const device = await connected()

		socket.clear()

		await succeeded(await endpoints['/rotators/:id/sync'].POST(request(device.id, 123.45)))

		expect(device.angle.value).toBe(123.45)
		expect(rotatorUpdates('angle').at(-1)?.body.device.angle!.value).toBe(123.45)

		await succeeded(await endpoints['/rotators/:id/reverse'].POST(request(device.id, true)))

		expect(device.reversed).toBeTrue()
		expect(rotatorUpdates('reversed').at(-1)?.body.device.reversed).toBeTrue()

		await succeeded(await endpoints['/rotators/:id/reverse'].POST(request(device.id, false)))

		expect(device.reversed).toBeFalse()
		expect(rotatorUpdates('reversed').at(-1)?.body.device.reversed).toBeFalse()
	})

	test('moves, homes, and stops through endpoints', async () => {
		wsm.open(socket)

		const device = await connected(45)

		socket.clear()

		await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 90)))

		await waitUntil(() => device.moving)
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await succeeded(await endpoints['/rotators/:id/stop'].POST(request(device.id)))

		expect(device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.state).toBe('Alert')
		await waitUntil(() => free(device))

		rotatorManager.syncTo(device, 10)
		socket.clear()

		await noContent(endpoints['/rotators/:id/home'].POST(request(device.id)))

		await waitUntil(() => device.moving)
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeTrue()
	})

	test('holds the rotator until a home the driver reports late has finished', async () => {
		const device = await connected(45)

		const home = spyOn(rotatorManager, 'home').mockImplementation(() => {
			setTimeout(() => {
				device.moving = true
				rotatorCommander.updated(device, 'moving', 'Busy')

				setTimeout(() => {
					device.moving = false
					rotatorCommander.updated(device, 'moving', 'Idle')
				}, 200)
			}, 200)
		})

		try {
			await noContent(endpoints['/rotators/:id/home'].POST(request(device.id)))

			await waitUntil(() => !free(device))
			expect(await waitUntil(() => free(device), 100, true)).toBeFalse()
			await waitUntil(() => device.moving)
			await waitUntil(() => free(device), 3000)
		} finally {
			home.mockRestore()
			device.moving = false
		}
	})

	test('holds the rotator until the commanded angle is reached', async () => {
		const device = await connected(45)

		await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 60)))

		await waitUntil(() => !free(device))
		await waitUntil(() => device.angle.value === 60 && !device.moving, 10000)
		await waitUntil(() => free(device))
	}, 15000)

	test('resolves an angle outside the driver limits to the equivalent one it publishes', async () => {
		const device = await connected(45)
		const moveTo = spyOn(rotatorManager, 'moveTo')

		try {
			await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, device.angle.max + 30)))

			await waitUntil(() => moveTo.mock.calls.length > 0)
			expect(moveTo).toHaveBeenCalledWith(device, device.angle.min + 30)
		} finally {
			moveTo.mockRestore()
		}
	})

	test('refuses a command competing for a rotator already owned', async () => {
		const device = await connected(45)

		await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 90)))

		await waitUntil(() => !free(device))

		const response = await endpoints['/rotators/:id/sync'].POST(request(device.id, 10))

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject(failedOperationResult('busy'))
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const rotatorManager = new RotatorManager()
		const resourceArbiter = new ResourceArbiter()
		const operationCoordinator = new OperationCoordinator(resourceArbiter)
		const rotatorHandler = new RotatorHandler(wsm, rotatorManager, new NotificationHandler(wsm), new RotatorCommander(rotatorManager), operationCoordinator)
		const handler = new IndiClientHandlerSet([rotatorManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const rotatorSimulator = new RotatorSimulator('Rotator Simulator', client)
		const socket = new SocketMessager()

		wsm.open(socket)
		socket.clear()
		rotatorSimulator.dispose()

		const message = socket.find<RotatorRemoved>((message) => message.type === 'rotator:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Rotator Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
