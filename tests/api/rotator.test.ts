import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Rotator } from 'nebulosa/src/indi.device'
import { RotatorManager } from 'nebulosa/src/indi.manager'
import { ClientSimulator, RotatorSimulator } from 'nebulosa/src/indi.simulator'
import { WebSocketMessageHandler, type Messager } from 'src/api/message'
import { RotatorHandler, rotator as rotatorEndpoints } from 'src/api/rotator'
import type { RotatorAdded, RotatorRemoved, RotatorUpdated } from 'src/shared/types'

type SocketMessage<T = unknown> = {
	readonly type: string
	readonly body: T
}

const wsm = new WebSocketMessageHandler()
const rotatorManager = new RotatorManager()
const rotatorHandler = new RotatorHandler(wsm, rotatorManager)
const endpoints = rotatorEndpoints(rotatorHandler)
const handler = new IndiClientHandlerSet([rotatorManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new RotatorSimulator('Rotator Simulator', client)

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

async function json<T>(response: Response) {
	expect(response.status).toBe(200)
	return (await response.json()) as T
}

async function noContent(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.text()).toBe('')
}

async function waitUntil(condition: () => boolean, timeout = 1500) {
	const start = performance.now()

	while (!condition()) {
		if (performance.now() - start >= timeout) return false
		await Bun.sleep(10)
	}

	return true
}

function rotatorUpdates(property: keyof Rotator & string) {
	return socketMessages.filter((message): message is SocketMessage<RotatorUpdated> => message.type === 'rotator:update' && (message.body as RotatorUpdated).property === property)
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

		expect(await waitUntil(() => socketMessages.some((message) => message.type === 'rotator:add'))).toBeTrue()

		const message = socketMessages.find((message): message is SocketMessage<RotatorAdded> => message.type === 'rotator:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('rotator')
	})

	test('emits connection, capability, and angle metadata updates', () => {
		const device = getRotator()

		wsm.open(socket)
		socketMessages.length = 0

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
		socketMessages.length = 0

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
		socketMessages.length = 0

		await noContent(await endpoints['/rotators/:id/moveto'].POST(request(device.id, 90)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await noContent(endpoints['/rotators/:id/stop'].POST(request(device.id)))

		expect(device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.device.moving).toBeFalse()
		expect(rotatorUpdates('moving').at(-1)?.body.state).toBe('Alert')

		rotatorManager.syncTo(device, 10)
		socketMessages.length = 0

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
		rotatorSimulator.dispose()

		const message = messages.find((message): message is SocketMessage<RotatorRemoved> => message.type === 'rotator:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Rotator Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
