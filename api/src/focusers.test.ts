import { afterEach, expect, test } from 'bun:test'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { FocuserCommands } from './focusers'
import { type OperationEvent, OperationRegistry } from './operations'

const disposables: Disposable[] = []

afterEach(() => {
	for (const disposable of disposables.splice(0).toReversed()) disposable[Symbol.dispose]()
})

async function waitUntil(condition: () => boolean, timeout = 10000) {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error('timeout')
		await Bun.sleep(20)
	}
}

// Simulator connection with its focuser connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const commands = new FocuserCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(commands)
	const focuserId = manager.devices.list(client).find((d) => d.type === 'focuser')!.id
	manager.devices.switch(client, focuserId, true)
	const focuser = manager.devices.device(client, 'focuser', focuserId)!
	await waitUntil(() => focuser.connected && focuser.canAbsoluteMove && operations.available(focuser))
	return { id, client, manager, commands, operations, events, focuser, focuserId }
}

// Resolves once the operation reported its outcome and returns its final record.
async function outcome(events: readonly OperationEvent[], operationId: string) {
	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'), 30000)
	return events.findLast((event) => event.operation.operationId === operationId)!.operation
}

test('moves to a position and by steps, confirmed by the reported position', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	const start = focuser.position.value

	const to = (await commands.moveTo(id, focuserId, { token: 'to', position: start + 1000 }).json()) as CommandAccepted
	expect(await outcome(events, to.operationId)).toMatchObject({ kind: 'focuser.move', state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 1000)

	const inward = (await commands.move(id, focuserId, { token: 'in', direction: 'IN', steps: 300 }).json()) as CommandAccepted
	expect(await outcome(events, inward.operationId)).toMatchObject({ state: 'succeeded' })
	expect(focuser.position.value).toBe(start + 700)
}, 40000)

test('a relative move repeated with its token moves only once', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()
	const start = focuser.position.value
	const request = { token: 'once', direction: 'OUT', steps: 200 } as const

	const first = (await commands.move(id, focuserId, request).json()) as CommandAccepted
	const second = (await commands.move(id, focuserId, request).json()) as CommandAccepted
	expect(second.operationId).toBe(first.operationId)
	await outcome(events, first.operationId)
	expect((await commands.move(id, focuserId, request).json()) as CommandAccepted).toEqual(first)
	expect(focuser.position.value).toBe(start + 200)
}, 40000)

test('a second move is busy, stop ends the first, and sync redefines the position', async () => {
	const { id, commands, events, focuser, focuserId } = await setup()

	const far = (await commands.moveTo(id, focuserId, { token: 'far', position: focuser.position.max }).json()) as CommandAccepted
	await waitUntil(() => focuser.moving)
	expect(commands.moveTo(id, focuserId, { token: 'other', position: 0 }).status).toBe(409)
	expect((await commands.stop(id, focuserId)).status).toBe(204)
	expect(await outcome(events, far.operationId)).toMatchObject({ state: 'failed', reason: 'aborted' })
	expect(focuser.moving).toBeFalse()

	expect((await commands.sync(id, focuserId, { position: 12345 })).status).toBe(204)
	await waitUntil(() => focuser.position.value === 12345)
	expect((await commands.reverse(id, focuserId, { enabled: true })).status).toBe(204)
	await waitUntil(() => focuser.reversed)
}, 40000)

test('refuses unknown and disconnected focusers', async () => {
	const { id, client, manager, commands, focuserId } = await setup()
	expect(commands.moveTo(id, 'missing', { token: 't', position: 1 }).status).toBe(404)
	expect(commands.state('other', focuserId).status).toBe(404)
	expect(commands.state(id, focuserId).status).toBe(200)

	manager.devices.switch(client, focuserId, false)
	await waitUntil(() => !manager.devices.device(client, 'focuser', focuserId)!.connected)
	expect(commands.moveTo(id, focuserId, { token: 't', position: 1 }).status).toBe(409)
	expect((await commands.sync(id, focuserId, { position: 1 })).status).toBe(409)
})
