import { afterEach, expect, test } from 'bun:test'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { type OperationEvent, OperationRegistry } from './operations'
import { WheelCommands } from './wheels'

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

// Simulator connection with its filter wheel connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const commands = new WheelCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(commands)
	const wheelId = manager.devices.list(client).find((d) => d.type === 'wheel')!.id
	manager.devices.switch(client, wheelId, true)
	const wheel = manager.devices.device(client, 'wheel', wheelId)!
	await waitUntil(() => wheel.connected && wheel.count > 0 && operations.available(wheel))
	return { id, client, manager, commands, operations, events, wheel, wheelId }
}

test('changes to a 0-based slot and resolves once the wheel stands at it', async () => {
	const { id, client, manager, commands, events, wheel, wheelId } = await setup()
	const target = (wheel.position + 3) % wheel.count

	const response = commands.move(id, wheelId, { token: 'move', slot: target })
	expect(response.status).toBe(202)
	const { operationId } = (await response.json()) as CommandAccepted
	expect(commands.move(id, wheelId, { token: 'other', slot: 0 }).status).toBe(409)

	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'), 30000)
	expect(events.at(-1)?.operation).toMatchObject({ kind: 'wheel.move', state: 'succeeded' })
	expect(wheel.position).toBe(target)
	expect(manager.devices.state(client, 'wheel', wheelId)).toMatchObject({ position: target, count: 8, names: expect.arrayContaining(['L']) as string[] })
}, 40000)

test('refuses a slot the wheel does not have and renames the slots', async () => {
	const { id, commands, wheel, wheelId } = await setup()

	expect(commands.move(id, wheelId, { token: 'a', slot: wheel.count }).status).toBe(422)
	expect(commands.move(id, wheelId, { token: 'b', slot: -1 }).status).toBe(422)

	const names = Array.from({ length: wheel.count }, (_, i) => `F${i + 1}`)
	expect((await commands.setNames(id, wheelId, { names })).status).toBe(204)
	await waitUntil(() => wheel.names[0] === 'F1')
})
