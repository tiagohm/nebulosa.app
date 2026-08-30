import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Cover } from 'nebulosa/src/devices/indi/device'
import { CoverManager } from 'nebulosa/src/devices/indi/manager/cover'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { CoverSimulator } from 'nebulosa/src/devices/indi/simulator/cover'
import { CoverHandler, coverBus, cover as coverEndpoints } from 'src/api/cover'
import { CoverCommander } from 'src/api/cover.commander'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import type { CoverAdded, CoverRemoved, CoverUpdated } from '#/cover'
import { successfulOperationResult, failedOperationResult } from '#/orchestration'
import { json, SocketMessager, waitUntil } from './util'

coverBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const coverManager = new CoverManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const coverCommander = new CoverCommander(coverManager)
const coverHandler = new CoverHandler(wsm, coverManager, new NotificationHandler(wsm), coverCommander, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(coverManager)
const endpoints = coverEndpoints(coverHandler)
const handler = new IndiClientHandlerSet([coverManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new CoverSimulator('Cover Simulator', client)
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
	coverManager.disconnect(getCover())
})

afterEach(async () => {
	await operationCoordinator.cancelAll('aborted')
	coverManager.disconnect(getCover())
})

function getCover() {
	const device = coverManager.get(client, 'Cover Simulator')!
	expect(device).toBeDefined()
	return device
}

function request(id = 'Cover Simulator', search = '') {
	return { url: `http://localhost/covers/${encodeURIComponent(id)}${search}`, params: { id } } as unknown as Bun.BunRequest
}

function free(device: Cover) {
	return resourceArbiter.availability(resourceKey(device)) === 'available'
}

function coverUpdates(property: keyof Cover & string) {
	return socket.filter<CoverUpdated>((message) => message.type === 'cover:update' && message.body.property === property)
}

async function connected() {
	const device = getCover()

	coverManager.connect(device)

	expect(device.connected).toBeTrue()
	await waitUntil(() => free(device))

	return device
}

describe('cover handler', () => {
	test('lists and returns covers through endpoints', async () => {
		const device = getCover()
		const list = await json<Cover[]>(endpoints['/covers'].GET(request()))
		const withId = await json<Cover>(endpoints['/covers/:id'].GET(request(device.id)))
		const listWithClient = await json<Cover[]>(endpoints['/covers'].GET(request('Cover Simulator', `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getCover()

		wsm.open(socket)

		await waitUntil(() => socket.some((message) => message.type === 'cover:add'))

		const message = socket.find<CoverAdded>((message) => message.type === 'cover:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('cover')
	})

	test('emits connection and capability updates', () => {
		const device = getCover()

		wsm.open(socket)
		socket.clear()

		coverManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.canPark).toBeTrue()
		expect(device.canAbort).toBeTrue()
		expect(device.parked).toBeFalse()
		expect(coverUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(coverUpdates('canPark').at(-1)?.body.device.canPark).toBeTrue()
		expect(coverUpdates('canAbort').at(-1)?.body.device.canAbort).toBeTrue()
	})

	test('parks and unparks through handler endpoints', async () => {
		wsm.open(socket)

		const device = await connected()

		socket.clear()

		expect(endpoints['/covers/:id/park'].POST(request(device.id))).toBeDefined()

		await waitUntil(() => device.parking)
		expect(coverUpdates('parking').at(-1)?.body.device.parking).toBeTrue()

		await waitUntil(() => device.parked && !device.parking, 3000)
		expect(coverUpdates('parked').at(-1)?.body.device.parked).toBeTrue()
		await waitUntil(() => free(device))

		socket.clear()

		expect(endpoints['/covers/:id/unpark'].POST(request(device.id))).toBeDefined()

		await waitUntil(() => device.parking)

		await waitUntil(() => !device.parked && !device.parking, 3000)
		expect(coverUpdates('parked').at(-1)?.body.device.parked).toBeFalse()
		await waitUntil(() => free(device))
	})

	test('holds the cover until it stands at the commanded end', async () => {
		const device = await connected()

		const parked = coverCommander.park(operationCoordinator, device)

		await waitUntil(() => device.parking)
		expect(await parked).toEqual(successfulOperationResult(undefined))
		expect(device.parked).toBeTrue()
		expect(device.parking).toBeFalse()

		expect(await coverCommander.unpark(operationCoordinator, device)).toEqual(successfulOperationResult(undefined))
		expect(device.parked).toBeFalse()
	})

	test('stops an active park transition and releases the cover', async () => {
		wsm.open(socket)

		const device = await connected()

		socket.clear()
		coverHandler.park(device)

		await waitUntil(() => device.parking)

		expect(await coverHandler.stop(device)).toEqual(successfulOperationResult(undefined))
		expect(device.parking).toBeFalse()
		expect(device.parked).toBeFalse()
		expect(coverUpdates('parking').at(-1)?.body.state).toBe('Alert')
		await waitUntil(() => free(device))
	})

	test('refuses a command competing for a cover already owned', async () => {
		const device = await connected()

		coverHandler.park(device)

		await waitUntil(() => !free(device))

		const unparked = await coverCommander.unpark(operationCoordinator, device)

		expect(unparked).toMatchObject(failedOperationResult('busy'))
	})

	test('refuses to move a disconnected cover', async () => {
		const device = getCover()
		const park = spyOn(coverManager, 'park')

		try {
			expect(await coverCommander.park(operationCoordinator, device)).toMatchObject({ ok: false })
			expect(park).not.toHaveBeenCalled()
		} finally {
			park.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const coverManager = new CoverManager()
		const resourceArbiter = new ResourceArbiter()
		const operationCoordinator = new OperationCoordinator(resourceArbiter)
		const coverHandler = new CoverHandler(wsm, coverManager, new NotificationHandler(wsm), new CoverCommander(coverManager), operationCoordinator)
		const handler = new IndiClientHandlerSet([coverManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const coverSimulator = new CoverSimulator('Cover Simulator', client)
		const socket = new SocketMessager()

		wsm.open(socket)
		socket.clear()
		coverSimulator.dispose()

		const message = socket.find<CoverRemoved>((message) => message.type === 'cover:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Cover Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
