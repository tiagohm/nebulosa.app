import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Focuser } from 'nebulosa/src/devices/indi/device'
import { FocuserManager } from 'nebulosa/src/devices/indi/manager'
import { ClientSimulator } from 'nebulosa/src/devices/indi/simulator/client'
import { FocuserSimulator } from 'nebulosa/src/devices/indi/simulator/focuser'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { FocuserHandler, focuserBus, focuser as focuserEndpoints } from 'src/api/focuser'
import { FocuserCommander } from 'src/api/focuser.commander'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { resourceKey, ResourceArbiter } from 'src/api/resource'
import type { FocuserAdded, FocuserRemoved, FocuserUpdated } from '#/focuser'
import type { Notification } from '#/notification'
import { failedOperationResult } from '#/orchestration'
import { json, noContent, SocketMessager, waitUntil } from './util'

focuserBus.forceSync = true

const wsm = new WebSocketMessageHandler()
const focuserManager = new FocuserManager()
const resourceArbiter = new ResourceArbiter()
const operationCoordinator = new OperationCoordinator(resourceArbiter)
const focuserCommander = new FocuserCommander(focuserManager)
const focuserHandler = new FocuserHandler(wsm, focuserManager, new NotificationHandler(wsm), focuserCommander, operationCoordinator)
const deviceLifecycle = new DeviceLifecycle(resourceArbiter, operationCoordinator)
deviceLifecycle.observe(focuserManager)
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

async function succeeded(response: Response) {
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ ok: true })
}

function free(focuser: Focuser) {
	return resourceArbiter.availability(resourceKey(focuser)) === 'available'
}

function focuserUpdates(property: keyof Focuser & string) {
	return socket.filter<FocuserUpdated>((message) => message.type === 'focuser:update' && message.body.property === property)
}

async function connected() {
	const device = getFocuser()

	focuserManager.connect(device)

	expect(device.connected).toBeTrue()

	focuserManager.syncTo(device, 50000)

	expect(await waitUntil(() => device.position.value === 50000 && free(device))).toBeTrue()

	return device
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
		const device = await connected()

		wsm.open(socket)
		socket.clear()

		await succeeded(await endpoints['/focusers/:id/sync'].POST(request(device.id, 1234)))

		expect(device.position.value).toBe(1234)
		expect(focuserUpdates('position').at(-1)?.body.device.position!.value).toBe(1234)

		await succeeded(await endpoints['/focusers/:id/reverse'].POST(request(device.id, true)))

		expect(device.reversed).toBeTrue()
		expect(focuserUpdates('reversed').at(-1)?.body.device.reversed).toBeTrue()

		await succeeded(await endpoints['/focusers/:id/reverse'].POST(request(device.id, false)))

		expect(device.reversed).toBeFalse()
		expect(focuserUpdates('reversed').at(-1)?.body.device.reversed).toBeFalse()
	})

	test('moves in and out through endpoints', async () => {
		const device = await connected()

		await noContent(await endpoints['/focusers/:id/movein'].POST(request(device.id, 500)))

		expect(await waitUntil(() => device.position.value === 49500 && free(device))).toBeTrue()

		await noContent(await endpoints['/focusers/:id/moveout'].POST(request(device.id, 500)))

		expect(await waitUntil(() => device.position.value === 50000 && free(device))).toBeTrue()
	})

	test('moves and stops through endpoints', async () => {
		const device = await connected()

		wsm.open(socket)
		socket.clear()

		await noContent(await endpoints['/focusers/:id/moveto'].POST(request(device.id, device.position.max)))

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(focuserUpdates('moving').at(-1)?.body.device.moving).toBeTrue()

		await succeeded(await endpoints['/focusers/:id/stop'].POST(request(device.id)))

		expect(device.moving).toBeFalse()
		expect(device.position.value).toBeLessThan(device.position.max)
		expect(focuserUpdates('moving').at(-1)?.body.device.moving).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()
	}, 10000)

	test('notifies a detached move that was rejected', async () => {
		const device = getFocuser()

		wsm.open(socket)
		socket.clear()

		await noContent(await endpoints['/focusers/:id/moveto'].POST(request(device.id, 1000)))

		expect(await waitUntil(() => socket.some<Notification>((message) => message.type === 'notification'))).toBeTrue()

		const message = socket.find<Notification>((message) => message.type === 'notification')

		expect(message!.body.title).toBe('FOCUSER')
		expect(message!.body.color).toBe('danger')
		expect(message!.body.description).toContain('failed to move to position 1000')
	})

	test('emits remove event when the simulator is disposed', () => {
		const wsm = new WebSocketMessageHandler()
		const focuserManager = new FocuserManager()
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const focuserHandler = new FocuserHandler(wsm, focuserManager, new NotificationHandler(wsm), new FocuserCommander(focuserManager), coordinator)
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

describe('focuser commander', () => {
	test('moves to a position and resolves after the focuser stops there', async () => {
		const device = await connected()
		const target = device.position.value + 500
		const result = await focuserCommander.moveTo(operationCoordinator, device, target)

		expect(result.ok).toBeTrue()
		expect(device.moving).toBeFalse()
		expect(device.position.value).toBe(target)
		expect(await waitUntil(() => free(device))).toBeTrue()
	})

	test('resolves without waiting when the focuser already stands at the position', async () => {
		const device = await connected()
		const result = await focuserCommander.moveTo(operationCoordinator, device, device.position.value)

		expect(result.ok).toBeTrue()
		expect(device.moving).toBeFalse()
	})

	test('moves inward and outward by relative steps', async () => {
		const device = await connected()

		expect(await focuserCommander.moveIn(operationCoordinator, device, 500)).toMatchObject({ ok: true })
		expect(device.position.value).toBe(49500)

		expect(await focuserCommander.moveOut(operationCoordinator, device, 1500)).toMatchObject({ ok: true })
		expect(device.position.value).toBe(51000)
	})

	test('inverts the relative direction while the focuser is reversed', async () => {
		const device = await connected()

		expect(await focuserCommander.reverse(operationCoordinator, device, true)).toMatchObject({ ok: true })

		try {
			expect(await focuserCommander.moveIn(operationCoordinator, device, 500)).toMatchObject({ ok: true })
			expect(device.position.value).toBe(50500)
		} finally {
			await focuserCommander.reverse(operationCoordinator, device, false)
		}
	})

	test('commands only the steps left before the range limit', async () => {
		const device = await connected()

		focuserManager.syncTo(device, device.position.min + 100)

		expect(await waitUntil(() => device.position.value === device.position.min + 100)).toBeTrue()
		expect(await focuserCommander.moveIn(operationCoordinator, device, 500)).toMatchObject({ ok: true })
		expect(device.position.value).toBe(device.position.min)
	})

	test('rejects a relative move without a direction to express it', async () => {
		const device = await connected()
		const moveIn = spyOn(focuserManager, 'moveIn')

		try {
			expect(await focuserCommander.moveIn(operationCoordinator, device, 0)).toMatchObject(failedOperationResult('unexpectedState'))
			expect(moveIn).not.toHaveBeenCalled()
		} finally {
			moveIn.mockRestore()
		}
	})

	test('refuses a move while the focuser is disconnected', async () => {
		const device = getFocuser()
		const moveTo = spyOn(focuserManager, 'moveTo')

		try {
			expect(await focuserCommander.moveTo(operationCoordinator, device, 1000)).toMatchObject(failedOperationResult('busy'))
			expect(await focuserCommander.stopMotion(device)).toMatchObject(failedOperationResult('disconnected'))
			expect(moveTo).not.toHaveBeenCalled()
		} finally {
			moveTo.mockRestore()
		}
	})

	test('stopping by device cancels the move and leaves the focuser stopped', async () => {
		const device = await connected()
		const moving = focuserCommander.moveTo(operationCoordinator, device, device.position.max)

		expect(await waitUntil(() => device.moving)).toBeTrue()

		const stopped = await focuserHandler.stop(device)

		expect(stopped).toMatchObject({ ok: true })
		expect(await moving).toMatchObject(failedOperationResult('aborted'))
		expect(device.moving).toBeFalse()
		expect(await waitUntil(() => free(device))).toBeTrue()
	}, 10000)

	test('refuses a second command while another operation owns the focuser', async () => {
		const device = await connected()
		const moving = focuserCommander.moveTo(operationCoordinator, device, device.position.max)

		expect(await waitUntil(() => device.moving)).toBeTrue()
		expect(await focuserCommander.syncTo(operationCoordinator, device, 1000)).toMatchObject(failedOperationResult('busy'))

		await focuserHandler.stop(device)
		await moving
	}, 10000)
})
