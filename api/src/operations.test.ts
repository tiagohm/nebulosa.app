import { afterEach, expect, test } from 'bun:test'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { type OperationContext, type OperationResult, successfulOperationResult } from 'nebulosa/src/devices/orchestration/operation'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { ConnectionManager } from './connection'
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

async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const mountId = manager.devices.list(client).find((d) => d.type === 'mount')!.id
	manager.devices.switch(client, mountId, true)
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => mount.connected && operations.arbiter.availability(resourceKey(mount)) === 'available')
	return { manager, id, client, operations, events, mount, mountId }
}

// Starts an operation holding a device until its signal aborts.
function hold(operations: OperationRegistry, device: Device) {
	return operations.coordinator.start('test.hold', [{ key: resourceKey(device), device }], (context: OperationContext) => {
		const { promise, resolve } = Promise.withResolvers<OperationResult<undefined>>()
		context.signal.addEventListener('abort', () => resolve(successfulOperationResult(undefined)))
		return promise
	})
}

test('one device is granted to one operation at a time, whichever service starts it', async () => {
	const { operations, mount } = await setup()

	const first = hold(operations, mount)
	const second = hold(operations, mount)

	expect(await second.result).toMatchObject({ ok: false, reason: 'busy' })
	expect(operations.arbiter.availability(resourceKey(mount))).toBe('leased')

	await first.cancel()
	expect(operations.arbiter.availability(resourceKey(mount))).toBe('available')
})

test('lists running operations and publishes their outcome', async () => {
	const { id, operations, events, mount, mountId } = await setup()

	const handle = hold(operations, mount)
	const record = operations.track('mount.slew', [{ connectionId: id, deviceId: mountId }], handle.result)

	expect(record).toMatchObject({ kind: 'mount.slew', state: 'running', devices: [{ connectionId: id, deviceId: mountId }] })
	expect(operations.running()).toEqual([record])
	expect(events).toEqual([{ type: 'operation:updated', operation: record }])

	await handle.cancel()
	await waitUntil(() => events.length === 2)
	expect(events[1].operation).toEqual({ ...record, state: 'failed', reason: 'aborted' })
	expect(operations.running()).toBeEmpty()
})

test('disconnecting a device cancels the operation holding it', async () => {
	const { id, client, manager, operations, events, mount, mountId } = await setup()

	const handle = hold(operations, mount)
	operations.track('mount.slew', [{ connectionId: id, deviceId: mountId }], handle.result)
	manager.devices.switch(client, mountId, false)

	await waitUntil(() => events.length === 2)
	expect(events[1].operation).toMatchObject({ state: 'failed', reason: 'disconnected' })
})

test('a rejected result fails the operation', async () => {
	const { operations, events } = await setup()

	operations.track('mount.slew', [], Promise.reject(new Error('lost')))

	await waitUntil(() => events.length === 2)
	expect(events[1].operation).toMatchObject({ state: 'failed', reason: 'commandFailed', error: 'lost' })
})

test('a repeated command token answers its first operation without starting another', async () => {
	const { id, operations, events, mount, mountId } = await setup()

	expect(operations.available(mount)).toBeTrue()
	let starts = 0
	const handle = hold(operations, mount)
	const start = () => {
		starts++
		return handle.result
	}

	const first = operations.run('mount.slew', [{ connectionId: id, deviceId: mountId }], 'token', start)
	const second = operations.run('mount.slew', [{ connectionId: id, deviceId: mountId }], 'token', start)

	expect(second).toBe(first)
	expect(operations.started('token')).toBe(first)
	expect(operations.started('other')).toBeUndefined()
	expect(starts).toBe(1)
	expect(operations.available(mount)).toBeFalse()

	await handle.cancel()
	await waitUntil(() => events.length === 2)
	expect(operations.run('mount.slew', [], 'token', start)).toBe(first)
	expect(starts).toBe(1)
})
