import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Wheel } from 'nebulosa/src/indi.device'
import { WheelManager } from 'nebulosa/src/indi.manager'
import { ClientSimulator, WheelSimulator } from 'nebulosa/src/indi.simulator'
import { WebSocketMessageHandler } from 'src/api/message'
import { WheelHandler, wheel as wheelEndpoints } from 'src/api/wheel'
import type { WheelAdded, WheelRemoved, WheelUpdated } from 'src/shared/types'
import { json, noContent, SocketMessager, waitUntil } from './util'

const wsm = new WebSocketMessageHandler()
const wheelManager = new WheelManager()
const wheelHandler = new WheelHandler(wsm, wheelManager)
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

afterEach(() => {
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

function wheelUpdates(property: keyof Wheel & string) {
	return socket.filter<WheelUpdated>((message) => message.type === 'wheel:update' && message.body.property === property)
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

		expect(await waitUntil(() => socket.some((message) => message.type === 'wheel:add'))).toBeTrue()

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
		const device = getWheel()
		const names = ['Lum', 'Red', 'Green', 'Blue', 'Ha', 'OIII', 'SII', 'Dark']

		wsm.open(socket)
		wheelManager.connect(device)
		socket.clear()

		await noContent(await endpoints['/wheels/:id/moveto'].POST(request(device.id, 2)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(wheelUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		expect(await waitUntil(() => device.position === 2 && !device.moving, 3000)).toBeTrue()
		expect(wheelUpdates('position').at(-1)?.body.device.position).toBe(2)
		expect(wheelUpdates('moving').at(-1)?.body.device.moving).toBeFalse()

		await noContent(await endpoints['/wheels/:id/names'].POST(request(device.id, names)))

		expect(device.names).toEqual(names)
		expect(wheelUpdates('names').at(-1)?.body.device.names).toEqual(names)
	})

	test('delegates endpoint actions to the wheel manager', async () => {
		const device = getWheel()
		const moveTo = spyOn(wheelManager, 'moveTo')
		const slots = spyOn(wheelManager, 'slots')
		const names = ['L', 'R', 'G', 'B']

		try {
			await noContent(await endpoints['/wheels/:id/moveto'].POST(request(device.id, 3)))
			await noContent(await endpoints['/wheels/:id/names'].POST(request(device.id, names)))

			expect(moveTo).toHaveBeenCalledWith(device, 3)
			expect(slots).toHaveBeenCalledWith(device, names)
		} finally {
			slots.mockRestore()
			moveTo.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const wheelManager = new WheelManager()
		const wheelHandler = new WheelHandler(wsm, wheelManager)
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
