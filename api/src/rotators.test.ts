import { afterEach, expect, test } from 'bun:test'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { type OperationEvent, OperationRegistry } from './operations'
import { RotatorCommands } from './rotators'

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

// Simulator connection with its rotator connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const commands = new RotatorCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(commands)
	const rotatorId = manager.devices.list(client).find((d) => d.type === 'rotator')!.id
	manager.devices.switch(client, rotatorId, true)
	const rotator = manager.devices.device(client, 'rotator', rotatorId)!
	await waitUntil(() => rotator.connected && rotator.angle.max > 0 && operations.available(rotator))
	return { id, client, manager, commands, operations, events, rotator, rotatorId }
}

// Resolves once the operation reported its outcome and returns its final record.
async function outcome(events: readonly OperationEvent[], operationId: string) {
	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'), 30000)
	return events.findLast((event) => event.operation.operationId === operationId)!.operation
}

test('moves to an angle and by an angle from where it stands', async () => {
	const { id, commands, events, rotator, rotatorId } = await setup()

	const to = (await commands.moveTo(id, rotatorId, { token: 'to', angle: 40 }).json()) as CommandAccepted
	expect(await outcome(events, to.operationId)).toMatchObject({ kind: 'rotator.move', state: 'succeeded' })
	expect(rotator.angle.value).toBeCloseTo(40, 1)

	const by = (await commands.moveBy(id, rotatorId, { token: 'by', delta: -15 }).json()) as CommandAccepted
	expect(await outcome(events, by.operationId)).toMatchObject({ state: 'succeeded' })
	expect(rotator.angle.value).toBeCloseTo(25, 1)
}, 40000)

test('stop ends a move, and sync and reverse follow the capabilities', async () => {
	const { id, commands, events, rotator, rotatorId } = await setup()

	const far = (await commands.moveTo(id, rotatorId, { token: 'far', angle: (rotator.angle.value + 180) % 360 }).json()) as CommandAccepted
	await waitUntil(() => rotator.moving)
	expect(commands.moveBy(id, rotatorId, { token: 'other', delta: 1 }).status).toBe(409)
	expect((await commands.stop(id, rotatorId)).status).toBe(204)
	expect(await outcome(events, far.operationId)).toMatchObject({ state: 'failed', reason: 'aborted' })

	expect((await commands.sync(id, rotatorId, { angle: 90 })).status).toBe(rotator.canSync ? 204 : 422)
	expect((await commands.reverse(id, rotatorId, { enabled: true })).status).toBe(rotator.canReverse ? 204 : 422)
	expect(commands.home(id, rotatorId, { token: 'home' }).status).toBe(rotator.canHome ? 202 : 422)
}, 40000)
