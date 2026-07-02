import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Rotator } from 'nebulosa/src/devices/indi/device'
import { RotatorManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator, RotatorSimulator } from 'nebulosa/src/devices/indi/simulator'
import { WebSocketMessageHandler } from 'src/api/message'
import { RotatorHandler, rotatorBus, rotator as rotatorEndpoints } from 'src/api/rotator'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'
import { json, noContent, SocketMessager, waitUntil } from './util'

rotatorBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const rotatorManager = new RotatorManager()
const rotatorHandler = new RotatorHandler(wsm, rotatorManager)
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

afterEach(() => {
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

function rotatorUpdates(property: keyof Rotator & string) {
	return socket.filter<RotatorUpdated>((message) => message.type === 'rotator:update' && message.body.property === property)
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

		expect(await waitUntil(() => socket.some<RotatorAdded>((message) => message.type === 'rotator:add'))).toBeTrue()

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
		const device = getRotator()

		wsm.open(socket)
		rotatorManager.connect(device)
		socket.clear()

		await noContent(await endpoints['/rotators/:id/sync'].POST(request(device.id, 123.45)))

		expect(device.angle.value).toBe(123.45)
		expect(rotatorUpdates('angle').at(-1)?.body.device.angle!.value).toBe(123.45)

		await noContent(await endpoints['/rotators/:id/reverse'].POST(request(device.id, true)))

		expect(device.reversed).toBeTrue()
		expect(rotatorUpdates('reversed').at(-1)?.body.device.reversed).toBeTrue()

		await noContent(await endpoints['/rotators/:id/reverse'].POST(request(device.id, false)))

		expect(device.reversed).toBeFalse()
		expect(rotatorUpdates('reversed').at(-1)?.body.device.reversed).toBeFalse()
	})

	test('moves, homes, and stops through endpoints', async () => {
		const device = getRotator()

		wsm.open(socket)
		rotatorManager.connect(device)
		rotatorManager.syncTo(device, 45)
		socket.clear()

		await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 90)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await noContent(endpoints['/rotators/:id/stop'].POST(request(device.id)))

		expect(device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.state).toBe('Alert')

		rotatorManager.syncTo(device, 10)
		socket.clear()

		await noContent(endpoints['/rotators/:id/home'].POST(request(device.id)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeTrue()
	})

	test('delegates endpoint actions to the rotator manager', async () => {
		const device = getRotator()
		const moveTo = spyOn(rotatorManager, 'moveTo')
		const syncTo = spyOn(rotatorManager, 'syncTo')
		const home = spyOn(rotatorManager, 'home')
		const reverse = spyOn(rotatorManager, 'reverse')
		const stop = spyOn(rotatorManager, 'stop')

		try {
			await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 100)))
			await noContent(await endpoints['/rotators/:id/sync'].POST(request(device.id, 120)))
			await noContent(endpoints['/rotators/:id/home'].POST(request(device.id)))
			await noContent(await endpoints['/rotators/:id/reverse'].POST(request(device.id, true)))
			await noContent(endpoints['/rotators/:id/stop'].POST(request(device.id)))

			expect(moveTo).toHaveBeenCalledWith(device, 100)
			expect(syncTo).toHaveBeenCalledWith(device, 120)
			expect(home).toHaveBeenCalledWith(device)
			expect(reverse).toHaveBeenCalledWith(device, true)
			expect(stop).toHaveBeenCalledWith(device)
		} finally {
			stop.mockRestore()
			reverse.mockRestore()
			home.mockRestore()
			syncTo.mockRestore()
			moveTo.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const rotatorManager = new RotatorManager()
		const rotatorHandler = new RotatorHandler(wsm, rotatorManager)
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
