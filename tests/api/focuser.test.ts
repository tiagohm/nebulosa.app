import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator, FocuserSimulator } from 'nebulosa/src/devices/indi/simulator'
import { FocuserHandler, focuserBus, focuser as focuserEndpoints } from 'src/api/focuser'
import { WebSocketMessageHandler } from 'src/api/message'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from 'src/shared/types'
import { json, noContent, SocketMessager, waitUntil } from './util'

focuserBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const focuserManager = new FocuserManager()
const focuserHandler = new FocuserHandler(wsm, focuserManager)
const endpoints = focuserEndpoints(focuserHandler)
const handler = new IndiClientHandlerSet([focuserManager])
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

function request(id = 'Focuser Simulator', body?: unknown, search = '') {
	return {
		url: `http://localhost/focusers/${encodeURIComponent(id)}${search}`,
		params: { id },
		json: () => body,
	} as unknown as Bun.BunRequest
}

function focuserUpdates(property: keyof Focuser & string) {
	return socket.filter<FocuserUpdated>((message) => message.type === 'focuser:update' && message.body.property === property)
}

describe('focuser handler', () => {
	test('lists and returns focusers through endpoints', async () => {
		const device = getFocuser()
		const list = await json<Focuser[]>(endpoints['/focusers'].GET(request()))
		const withId = await json<Focuser>(endpoints['/focusers/:id'].GET(request(device.id)))
		const listWithClient = await json<Focuser[]>(endpoints['/focusers'].GET(request('Focuser Simulator', undefined, `?client=${encodeURIComponent(client.id)}`)))

		expect(list).toHaveLength(1)
		expect(list[0].id).toBe(device.id)
		expect(withId.id).toBe(device.id)
		expect(listWithClient).toHaveLength(1)
		expect(listWithClient[0].id).toBe(device.id)
	})

	test('sends add event to a socket opened after discovery', async () => {
		const device = getFocuser()

		wsm.open(socket)

		expect(await waitUntil(() => socket.some((message) => message.type === 'focuser:add'))).toBeTrue()

		const message = socket.find<FocuserAdded>((message) => message.type === 'focuser:add')

		expect(message).toBeDefined()
		expect(message!.body.device.id).toBe(device.id)
		expect(message!.body.device.name).toBe(device.name)
		expect(message!.body.device.type).toBe('focuser')
	})

	test('emits connection, capability, and position metadata updates', () => {
		const device = getFocuser()

		wsm.open(socket)
		socket.clear()

		focuserManager.connect(device)

		expect(device.connected).toBeTrue()
		expect(device.canAbort).toBeTrue()
		expect(device.canReverse).toBeTrue()
		expect(device.canSync).toBeTrue()
		expect(device.canRelativeMove).toBeTrue()
		expect(device.canAbsoluteMove).toBeTrue()
		expect(focuserUpdates('connected').at(-1)?.body.device.connected).toBeTrue()
		expect(focuserUpdates('canAbort').at(-1)?.body.device.canAbort).toBeTrue()
		expect(focuserUpdates('canReverse').at(-1)?.body.device.canReverse).toBeTrue()
		expect(focuserUpdates('canSync').at(-1)?.body.device.canSync).toBeTrue()
		expect(focuserUpdates('canRelativeMove').at(-1)?.body.device.canRelativeMove).toBeTrue()
		expect(focuserUpdates('canAbsoluteMove').at(-1)?.body.device.canAbsoluteMove).toBeTrue()
		expect(focuserUpdates('position').at(-1)?.body.device.position!.max).toBe(device.position.max)

		focuserManager.disconnect(device)

		expect(focuserUpdates('connected').at(-1)?.body.device.connected).toBeFalse()
	})

	test('syncs position and reverses motion through endpoints', async () => {
		const device = getFocuser()

		wsm.open(socket)
		focuserManager.connect(device)
		socket.clear()

		await noContent(await endpoints['/focusers/:id/sync'].POST(request(device.id, 1234)))

		expect(device.position.value).toBe(1234)
		expect(focuserUpdates('position').at(-1)?.body.device.position!.value).toBe(1234)

		await noContent(await endpoints['/focusers/:id/reverse'].POST(request(device.id, true)))

		expect(device.reversed).toBeTrue()
		expect(focuserUpdates('reversed').at(-1)?.body.device.reversed).toBeTrue()

		await noContent(await endpoints['/focusers/:id/reverse'].POST(request(device.id, false)))

		expect(device.reversed).toBeFalse()
		expect(focuserUpdates('reversed').at(-1)?.body.device.reversed).toBeFalse()
	})

	test('moves and stops through endpoints', async () => {
		const device = getFocuser()

		wsm.open(socket)
		focuserManager.connect(device)
		focuserManager.syncTo(device, 2000)
		socket.clear()

		await noContent(await endpoints['/focusers/:id/moveto'].POST(request(device.id, 2100)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(focuserUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await noContent(endpoints['/focusers/:id/stop'].POST(request(device.id)))

		expect(device.moving).toBeFalse()
		expect(focuserUpdates('moving').at(-1)?.body.device.moving).toBeFalse()
		expect(focuserUpdates('moving').at(-1)?.body.state).toBe('Alert')
	})

	test('delegates endpoint actions to the focuser manager', async () => {
		const device = getFocuser()
		const moveTo = spyOn(focuserManager, 'moveTo')
		const moveIn = spyOn(focuserManager, 'moveIn')
		const moveOut = spyOn(focuserManager, 'moveOut')
		const syncTo = spyOn(focuserManager, 'syncTo')
		const reverse = spyOn(focuserManager, 'reverse')
		const stop = spyOn(focuserManager, 'stop')

		try {
			await noContent(await endpoints['/focusers/:id/moveto'].POST(request(device.id, 1000)))
			await noContent(await endpoints['/focusers/:id/movein'].POST(request(device.id, 10)))
			await noContent(await endpoints['/focusers/:id/moveout'].POST(request(device.id, 20)))
			await noContent(await endpoints['/focusers/:id/sync'].POST(request(device.id, 1200)))
			await noContent(await endpoints['/focusers/:id/reverse'].POST(request(device.id, true)))
			await noContent(endpoints['/focusers/:id/stop'].POST(request(device.id)))

			expect(moveTo).toHaveBeenCalledWith(device, 1000)
			expect(moveIn).toHaveBeenCalledWith(device, 10)
			expect(moveOut).toHaveBeenCalledWith(device, 20)
			expect(syncTo).toHaveBeenCalledWith(device, 1200)
			expect(reverse).toHaveBeenCalledWith(device, true)
			expect(stop).toHaveBeenCalledWith(device)
		} finally {
			stop.mockRestore()
			reverse.mockRestore()
			syncTo.mockRestore()
			moveOut.mockRestore()
			moveIn.mockRestore()
			moveTo.mockRestore()
		}
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const focuserManager = new FocuserManager()
		const focuserHandler = new FocuserHandler(wsm, focuserManager)
		const handler = new IndiClientHandlerSet([focuserManager])
		const client = new ClientSimulator('Client Simulator', handler)
		const focuserSimulator = new FocuserSimulator('Focuser Simulator', client)
		const socket = new SocketMessager()

		wsm.open(socket)
		socket.clear()
		focuserSimulator.dispose()

		const message = socket.find<FocuserRemoved>((message) => message.type === 'focuser:remove')

		expect(message).toBeDefined()
		expect(message!.body.device.name).toBe('Focuser Simulator')

		wsm.close(socket, 1000, 'done')
	})
})
