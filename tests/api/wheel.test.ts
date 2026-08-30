import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Wheel } from 'nebulosa/src/devices/indi/device'
import { WheelManager } from 'nebulosa/src/devices/indi/manager/wheel'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { WheelSimulator } from 'nebulosa/src/devices/indi/simulator/wheel'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import { WheelHandler, wheelBus, wheel as wheelEndpoints } from 'src/api/wheel'
import { WheelCommander } from 'src/api/wheel.commander'
import { failedOperationResult } from '#/orchestration'
import type { WheelAdded, WheelRemoved, WheelUpdated } from '#/wheel'
import { json, noContent, SocketMessager, waitUntil } from './util'

wheelBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const wheelManager = new WheelManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const wheelCommander = new WheelCommander(wheelManager)
const wheelHandler = new WheelHandler(wsm, wheelManager, new NotificationHandler(wsm), wheelCommander, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(wheelManager)
const endpoints = wheelEndpoints(wheelHandler)
const handler = new IndiClientHandlerSet([wheelManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new WheelSimulator('Wheel Simulator', client)
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	wheelManager.disconnect(getWheel())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	wheelManager.disconnect(getWheel())
})

function getWheel() {
	const device = wheelManager.get(client, 'Wheel Simulator')!
	expect(device).toBeDefined()
	return device
}

function request(id = 'Wheel Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/wheels/${encodeURIComponent(id)}${search}`,
		params: { id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

async function succeeded(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
}

function free(device: Wheel) {
	return resourceArbiter.availability(resourceKey(device)) === 'available'
}

function wheelUpdates(property: keyof Wheel & string) {
	return socket.filter<WheelUpdated>((message) => message.type === 'wheel:update' && message.body.property === property)
}

async function connected() {
	const device = getWheel()

	wheelManager.connect(device)

	expect(device.connected).toBeTrue()
	await waitUntil(() => free(device))

	return device
}

describe('wheel handler', () => {
	test('lists and returns wheels through endpoints', async () => {
		const device = getWheel()
		const list = await json<Wheel[]>(endpoints['/wheels'].GET(request()))
		const withId = await json<Wheel>(endpoints['/wheels/:id'].GET(request(device.id)))
		const listWithClient = await json<Wheel[]>(endpoints['/wheels'].GET(request('Wheel Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getWheel()

		wsm.open(socket)

		await waitUntil(() => socket.some((message) => message.type === 'wheel:add'))

		const message = socket.find<WheelAdded>((message) => message.type === 'wheel:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('wheel')
	})

	test('emits connection, slot count, and slot name updates', () => {
		const device = getWheel()

		wsm.open(socket)
		socket.clear()

		wheelManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.count).toBeGreaterThan(0)
		expect(device.names).toHaveLength(device.count)
		expect(device.canSetNames).toBeTrue()
		expect(wheelUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(wheelUpdates('count').at(-1)?.body.device.count).toBe(device.count)
		expect(wheelUpdates('names').at(-1)?.body.device.names).toEqual(device.names)

		wheelManager.disconnect(device)

		expect(wheelUpdates('connected').at(-1)?.body.device.connected).toBeFalse()
	})

	test('moves to a slot and updates slot names through endpoints', async () => {
		const names = ['Lum', 'Red', 'Green', 'Blue', 'Ha', 'OIII', 'SII', 'Dark']

		wsm.open(socket)

		const device = await connected()

		socket.clear()

		await noContent(await endpoints['/wheels/:id/moveto'].POST(request(device.id, 2)))

		await waitUntil(() => device.moving)
		expect(wheelUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await waitUntil(() => device.position === 2 && !device.moving, 3000)
		expect(wheelUpdates('position').at(-1)?.body.device.position).toBe(2)
		expect(wheelUpdates('moving').at(-1)?.body.device.moving).toBeFalse()

		await waitUntil(() => free(device))

		await succeeded(await endpoints['/wheels/:id/names'].POST(request(device.id, names)))

		expect(device.names).toEqual(names)
		expect(wheelUpdates('names').at(-1)?.body.device.names).toEqual(names)
	})

	test('clamps a slot outside the carousel to one the wheel can reach', async () => {
		const device = await connected()
		const moveTo = spyOn(wheelManager, 'moveTo')

		try {
			await noContent(await endpoints['/wheels/:id/moveto'].POST(request(device.id, device.count + 4)))

			await waitUntil(() => device.position === device.count - 1 && !device.moving, 3000)
			expect(moveTo).toHaveBeenCalledWith(device, device.count - 1)
		} finally {
			moveTo.mockRestore()
		}
	})

	test('holds a canceled move until the wheel reaches the commanded slot', async () => {
		const device = await connected()
		const moveTo = spyOn(wheelManager, 'moveTo').mockImplementation(() => {})

		try {
			const handle = operationCoordinator.start('wheelMoveTo', [{ key: resourceKey(device), device }], (context) => wheelCommander.moveTo(context, device, 2))

			await waitUntil(() => moveTo.mock.calls.length > 0)

			const canceled = handle.cancel()

			expect(await waitUntil(() => free(device), 200, true)).toBeFalse()

			device.moving = true
			wheelCommander.updated(device, 'moving', 'Busy')

			expect(await waitUntil(() => free(device), 200, true)).toBeFalse()

			device.moving = false
			device.position = 2
			wheelCommander.updated(device, 'position', 'Ok')

			await canceled

			const result = await handle.result

			expect(result.ok).toBeFalse()
			await waitUntil(() => free(device))
		} finally {
			device.moving = false
			moveTo.mockRestore()
		}
	})

	test('refuses a command competing for a wheel already owned', async () => {
		const device = await connected()

		await noContent(await endpoints['/wheels/:id/moveto'].POST(request(device.id, 3)))

		await waitUntil(() => !free(device))

		const response = await endpoints['/wheels/:id/names'].POST(request(device.id, ['L', 'R', 'G', 'B']))

		expect(response.status).toBe(200)
		expect(await response.json()).toMatchObject(failedOperationResult('busy'))
	})

	test('refuses to rename the slots of a disconnected wheel', async () => {
		const device = getWheel()
		const slots = spyOn(wheelManager, 'slots')

		try {
			const response = await endpoints['/wheels/:id/names'].POST(request(device.id, ['L', 'R', 'G', 'B']))

			expect(response.status).toBe(200)
			expect(await response.json()).toMatchObject({ ok: false })
			expect(slots).not.toHaveBeenCalled()
		} finally {
			slots.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const wheelManager = new WheelManager()
		const resourceArbiter = new ResourceArbiter()
		const operationCoordinator = new OperationCoordinator(resourceArbiter)
		const wheelHandler = new WheelHandler(wsm, wheelManager, new NotificationHandler(wsm), new WheelCommander(wheelManager), operationCoordinator)
		const handler = new IndiClientHandlerSet([wheelManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const wheelSimulator = new WheelSimulator('Wheel Simulator', client)
		const socket = new SocketMessager()

		wsm.open(socket)
		socket.clear()
		wheelSimulator.dispose()

		const message = socket.find<WheelRemoved>((message) => message.type === 'wheel:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Wheel Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
