import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Thermometer } from 'nebulosa/src/devices/indi/device'
import { FocuserManager, ThermometerManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator, FocuserSimulator } from 'nebulosa/src/devices/indi/simulator'
import { FocuserHandler } from 'src/api/focuser'
import { WebSocketMessageHandler } from 'src/api/message'
import { thermometer as thermometerEndpoints, ThermometerHandler } from 'src/api/thermometer'
import type { ThermometerAdded, ThermometerRemoved, ThermometerUpdated } from 'src/shared/types'
import { json, SocketMessager, waitUntil } from './util'

const wsm = new WebSocketMessageHandler()
const focuserManager = new FocuserManager()
const thermometerManager = new ThermometerManager(focuserManager)
const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
const endpoints = thermometerEndpoints(thermometerHandler)
const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
const client = new ClientSimulator('Client Simulator', handler)
const simulator = new FocuserSimulator('Focuser Simulator', client)
const socket = new SocketMessager()

afterAll(() => {
	simulator.dispose()
	wsm.close(socket, 1000, 'done')
})

beforeEach(() => {
	wsm.close(socket, 1000, 'reset')
	socket.clear()
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

function thermometerUpdates(property: keyof Thermometer & string) {
	return socket.filter<ThermometerUpdated>((message) => message.type === 'thermometer:update' && message.body.property === property)
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

		expect(await waitUntil(() => socket.messages.some((message) => message.type === 'thermometer:add'))).toBeTrue()

		const message = socket.find<ThermometerAdded>((message) => message.type === 'thermometer:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.parentId).toBe(getFocuser().id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('thermometer')
	})

	test('emits add and temperature updates when parent focuser connects', () => {
		const wsm = new WebSocketMessageHandler()
		const socket = new SocketMessager()
		wsm.open(socket)

		const focuserManager = new FocuserManager()
		const thermometerManager = new ThermometerManager(focuserManager)
		const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
		const focuserHandler = new FocuserHandler(wsm, focuserManager)
		const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new FocuserSimulator('Focuser Simulator', client)

		const focuser = focuserManager.get(client, 'Focuser Simulator')!
		focuserManager.connect(focuser)
		const thermometer = thermometerManager.get(client, 'Focuser Simulator')!

		expect(thermometer.connected).toBeTrue()
		expect(thermometer.hasThermometer).toBeTrue()
		expect(thermometer.temperature).toBeGreaterThan(0)

		expect(focuser.connected).toBeTrue()
		expect(focuser.hasThermometer).toBeTrue()
		expect(focuser.temperature).toBeGreaterThan(0)

		let add = socket.find<ThermometerAdded>((message) => message.type === 'thermometer:add')
		let updates = socket.filter<ThermometerUpdated>((message) => message.type === 'thermometer:update')

		expect(add).toBeDefined()
		expect(add!.body.device.id).toBe(thermometer.id)
		expect(updates.find((message) => message.body.property === 'hasThermometer')?.body.device.hasThermometer).toBeTrue()
		expect(updates.find((message) => message.body.property === 'temperature')?.body.device.temperature).toBe(thermometer.temperature)

		add = socket.find<ThermometerAdded>((message) => message.type === 'focuser:add')
		updates = socket.filter<ThermometerUpdated>((message) => message.type === 'focuser:update')

		expect(add).toBeDefined()
		expect(add!.body.device.id).toBe(focuser.id)
		expect(updates.find((message) => message.body.property === 'hasThermometer')?.body.device.hasThermometer).toBeTrue()
		expect(updates.find((message) => message.body.property === 'temperature')?.body.device.temperature).toBe(focuser.temperature)

		focuserSimulator.dispose()
		wsm.close(socket, 1000, 'done')
	})

	test('emits reset updates when parent focuser disconnects', () => {
		wsm.open(socket)
		const device = connectAndGetThermometer()

		socket.clear()
		focuserManager.disconnect(getFocuser())

		expect(device.connected).toBeFalse()
		expect(device.hasThermometer).toBeFalse()
		expect(device.temperature).toBe(0)
		expect(thermometerUpdates('temperature').at(-1)?.body.device.temperature).toBe(0)
	})

	test('emits remove event when the parent simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const focuserManager = new FocuserManager()
		const thermometerManager = new ThermometerManager(focuserManager)
		const thermometerHandler = new ThermometerHandler(wsm, thermometerManager)
		const handler = new IndiClientHandlerSet([focuserManager, thermometerManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new FocuserSimulator('Focuser Simulator', client)
		const socket = new SocketMessager()

		focuserManager.connect(focuserManager.get(client, 'Focuser Simulator')!)
		wsm.open(socket)
		socket.clear()
		focuserSimulator.dispose()

		const message = socket.find<ThermometerRemoved>((message) => message.type === 'thermometer:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Focuser Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
