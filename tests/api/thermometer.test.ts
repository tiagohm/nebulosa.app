import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/indi.client'
import type { Thermometer } from 'nebulosa/src/indi.device'
import { FocuserManager, ThermometerManager } from 'nebulosa/src/indi.manager'
import { ClientSimulator, FocuserSimulator } from 'nebulosa/src/indi.simulator'
import { WebSocketMessageHandler, type Messager } from 'src/api/message'
import { thermometer as thermometerEndpoints, ThermometerHandler } from 'src/api/thermometer'
import type { ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'

type SocketMessage<T = unknown> = {
	readonly type: string
	readonly body: T
}

const wsm = new WebSocketMessageHandler()
const focuserManager = new FocuserManager()
const thermometerManager = new ThermometerManager({
	get: (client, name) => focuserManager.get(client, name),
})
const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
const endpoints = thermometerEndpoints(thermometerHandler)
const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new FocuserSimulator('Focuser Simulator', client)

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
	focuserManager.disconnect(getFocuser())
})

afterEach(() => {
	focuserManager.disconnect(getFocuser())
})

function getFocuser() {
	const device = focuserManager.get(client, 'Focuser Simulator')!
	expect(device).toBeDefined()
	return device
}

function getThermometer() {
	const device = thermometerManager.get(client, 'Focuser Simulator')!
	expect(device).toBeDefined()
	return device
}

function connectAndGetThermometer() {
	focuserManager.connect(getFocuser())
	return getThermometer()
}

function request(id = 'Focuser Simulator', search = '') {
	return { url: `http://localhost/thermometers/${encodeURIComponent(id)}${search}`, params: { id } } as unknown as Bun.BunRequest
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

function thermometerUpdates(property: keyof Thermometer & string) {
	return socketMessages.filter((message): message is SocketMessage<ThermometerUpdated> => message.type === 'thermometer:update' && (message.body as ThermometerUpdated).property === property)
}

describe('thermometer handler', () => {
	test('lists and returns thermometers through endpoints', async () => {
		const device = connectAndGetThermometer()
		const list = await json<Thermometer[]>(endpoints['/thermometers'].GET(request()))
		const withId = await json<Thermometer>(endpoints['/thermometers/:id'].GET(request(device.id)))
		const listWithClient = await json<Thermometer[]>(endpoints['/thermometers'].GET(request('Focuser Simulator', `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(list[0].parentId).toBe(getFocuser().id)
		expect(withId.id).toBe(device.id)
		expect(withId.parentId).toBe(getFocuser().id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = connectAndGetThermometer()

		wsm.open(socket)

		expect(await waitUntil(() => socketMessages.some((message) => message.type === 'thermometer:add'))).toBeTrue()

		const message = socketMessages.find((message): message is SocketMessage<ThermometerAdded> => message.type === 'thermometer:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.parentId).toBe(getFocuser().id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('thermometer')
	})

	test('emits add and temperature updates when parent focuser connects', () => {
		const wsm = new WebSocketMessageHandler()
		const focuserManager = new FocuserManager()
		const thermometerManager = new ThermometerManager({
			get: (client, name) => focuserManager.get(client, name),
		})
		const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
		const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new FocuserSimulator('Focuser Simulator', client)
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

		const focuser = focuserManager.get(client, 'Focuser Simulator')!
		focuserManager.connect(focuser)
		const thermometer = thermometerManager.get(client, 'Focuser Simulator')!

		expect(thermometer.connected).toBeTrue()
		expect(thermometer.hasThermometer).toBeTrue()
		expect(Number.isFinite(thermometer.temperature)).toBeTrue()

		const add = messages.find((message): message is SocketMessage<ThermometerAdded> => message.type === 'thermometer:add')
		const updates = messages.filter((message): message is SocketMessage<ThermometerUpdated> => message.type === 'thermometer:update')

		expect(add).toBeDefined()
		expect(add!.body.device.id).toBe(thermometer.id)
		expect(updates.find((message) => message.body.property === 'hasThermometer')?.body.device.hasThermometer).toBeTrue()
		expect(updates.find((message) => message.body.property === 'temperature')?.body.device.temperature).toBe(thermometer.temperature)

		focuserSimulator.dispose()
		wsm.close(socket, 1000, 'done')
	})

	test('emits reset updates when parent focuser disconnects', () => {
		wsm.open(socket)
		const device = connectAndGetThermometer()

		socketMessages.length = 0
		focuserManager.disconnect(getFocuser())

		expect(device.connected).toBeFalse()
		expect(device.hasThermometer).toBeFalse()
		expect(device.temperature).toBe(0)
		expect(thermometerUpdates('temperature').at(-1)?.body.device.temperature).toBe(0)
	})

	test('emits remove event when the parent simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const focuserManager = new FocuserManager()
		const thermometerManager = new ThermometerManager({
			get: (client, name) => focuserManager.get(client, name),
		})
		const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
		const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new FocuserSimulator('Focuser Simulator', client)
		const messages: SocketMessage[] = []
		const socket: Messager = {
			sendText(data) {
				const separator = data.indexOf('@')
				const type = data.slice(0, separator)
				const payload = data.slice(separator + 1)

				messages.push({ type, body: payload ? JSON.parse(payload) : undefined })
			},
		}

		focuserManager.connect(focuserManager.get(client, 'Focuser Simulator')!)
		wsm.open(socket)
		messages.length = 0
		focuserSimulator.dispose()

		const message = messages.find((message): message is SocketMessage<ThermometerRemoved> => message.type === 'thermometer:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Focuser Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
