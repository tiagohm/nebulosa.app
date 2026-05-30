import { afterAll, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Cover } from 'nebulosa/src/indi.device'
import { CoverManager } from 'nebulosa/src/indi.manager'
import { ClientSimulator, CoverSimulator } from 'nebulosa/src/indi.simulator'
import { CoverHandler, cover as coverEndpoints } from 'src/api/cover'
import { WebSocketMessageHandler, type Messager } from 'src/api/message'
import type { CoverAdded, CoverRemoved, CoverUpdated } from 'src/shared/types'

type SocketMessage<T = unknown> = {
	readonly type: string
	readonly body: T
}

const wsm = new WebSocketMessageHandler()
const coverManager = new CoverManager()
const coverHandler = new CoverHandler(wsm, coverManager)
const endpoints = coverEndpoints(coverHandler)
const handler = new IndiClientHandlerSet([coverManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new CoverSimulator('Cover Simulator', client)

const socketMessages: SocketMessage[] = []
const socket: Messager = {
	sendText(data) {
		const separator = data.indexOf('@')
		const type = data.slice(0, separator)
		const payload = data.slice(separator + 1)

		socketMessages.push({ type, body: payload ? JSON.parse(payload) : undefined })
	},
}

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socketMessages.length = 0
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

async function json<T>(response: Response) {
	expect(response.status).toBe(200)
	return (await response.json()) as T
}

async function waitUntil(condition: () => boolean, timeout = 1500) {
	const start = performance.now()

	while (!condition()) {
		if (performance.now() - start >= timeout) return false
		await Bun.sleep(10)
	}

	return true
}

function coverUpdates(property: keyof Cover & string) {
	return socketMessages.filter((message): message is SocketMessage<CoverUpdated> => message.type === 'cover:update' && (message.body as CoverUpdated).property === property)
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

		expect(await waitUntil(() => socketMessages.some((message) => message.type === 'cover:add'))).toBeTrue()

		const message = socketMessages.find((message): message is SocketMessage<CoverAdded> => message.type === 'cover:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('cover')
	})

	test('emits connection and capability updates', () => {
		const device = getCover()

		wsm.open(socket)
		socketMessages.length = 0

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
		const device = getCover()

		wsm.open(socket)
		coverManager.connect(device)
		socketMessages.length = 0

		expect(endpoints['/covers/:id/park'].POST(request(device.id))).toBeDefined()
		expect(device.parking).toBeTrue()
		expect(coverUpdates('parking').at(-1)?.body.device.parking).toBeTrue()

		expect(await waitUntil(() => device.parked && !device.parking)).toBeTrue()
		expect(device.parked).toBeTrue()
		expect(coverUpdates('parked').at(-1)?.body.device.parked).toBeTrue()

		socketMessages.length = 0

		expect(endpoints['/covers/:id/unpark'].POST(request(device.id))).toBeDefined()
		expect(device.parking).toBeTrue()

		expect(await waitUntil(() => !device.parked && !device.parking)).toBeTrue()
		expect(device.parked).toBeFalse()
		expect(coverUpdates('parked').at(-1)?.body.device.parked).toBeFalse()
	})

	test('stops an active park transition', () => {
		const device = getCover()

		wsm.open(socket)
		coverManager.connect(device)
		socketMessages.length = 0

		coverHandler.park(device)

		expect(device.parking).toBeTrue()

		coverHandler.stop(device)

		expect(device.parking).toBeFalse()
		expect(device.parked).toBeFalse()
		expect(coverUpdates('parking').at(-1)?.body.state).toBe('Alert')
	})

	test('delegates handler actions to the cover manager', () => {
		const device = getCover()
		const park = spyOn(coverManager, 'park')
		const unpark = spyOn(coverManager, 'unpark')
		const stop = spyOn(coverManager, 'stop')

		try {
			coverHandler.park(device)
			coverHandler.unpark(device)
			coverHandler.stop(device)

			expect(park).toHaveBeenCalledWith(device)
			expect(unpark).toHaveBeenCalledWith(device)
			expect(stop).toHaveBeenCalledWith(device)
		} finally {
			park.mockRestore()
			unpark.mockRestore()
			stop.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const coverManager = new CoverManager()
		const coverHandler = new CoverHandler(wsm, coverManager)
		const handler = new IndiClientHandlerSet([coverManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const coverSimulator = new CoverSimulator('Cover Simulator', client)
		const messages: SocketMessage[] = []
		const socket: Messager = {
			sendText(data) {
				const separator = data.indexOf('@')
				const type = data.slice(0, separator)
				const payload = data.slice(separator + 1)

				messages.push({ type, body: payload ? JSON.parse(payload) : undefined })
			},
		}

		wsm.open(socket)
		messages.length = 0
		coverSimulator.dispose()

		const message = messages.find((message): message is SocketMessage<CoverRemoved> => message.type === 'cover:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Cover Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
