import { afterEach, expect, test } from 'bun:test'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import type { CommandAccepted } from './commands'
import { ConnectionManager } from './connection'
import { GuideOutputCommands } from './guideoutputs'
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

// Simulator connection with its mount connected, and the guide output the mount provides.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const events: OperationEvent[] = []
	const operations = new OperationRegistry(manager.devices, (event) => events.push(event))
	disposables.push(operations)
	const commands = new GuideOutputCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	disposables.push(commands)
	const mountId = manager.devices.list(client).find((d) => d.type === 'mount')!.id
	manager.devices.switch(client, mountId, true)
	const mount = manager.devices.mount(client, mountId)!
	await waitUntil(() => mount.connected && operations.available(mount))
	await waitUntil(() => manager.devices.list(client).some((d) => d.type === 'guideOutput' && d.hardwareId === mount.hardwareId))
	const outputId = manager.devices.list(client).find((d) => d.type === 'guideOutput' && d.hardwareId === mount.hardwareId)!.id
	const output = manager.devices.device(client, 'guideOutput', outputId)!
	await waitUntil(() => output.canPulseGuide)
	return { id, client, manager, commands, operations, events, mount, outputId, output }
}

test('a pulse runs as an operation of the mount and ends when the output reports it ended', async () => {
	const { id, commands, operations, events, mount, outputId } = await setup()

	const response = commands.pulse(id, outputId, { token: 'p1', direction: 'NORTH', duration: 300 })
	expect(response.status).toBe(202)
	const { operationId } = (await response.json()) as CommandAccepted
	expect(operations.arbiter.availability(resourceKey(mount))).not.toBe('available')
	expect(commands.pulse(id, outputId, { token: 'p2', direction: 'SOUTH', duration: 300 }).status).toBe(409)

	await waitUntil(() => events.some((event) => event.operation.operationId === operationId && event.operation.state !== 'running'))
	expect(events.at(-1)?.operation).toMatchObject({ kind: 'guideOutput.pulse', state: 'succeeded', devices: [{ connectionId: id, deviceId: outputId }] })
	expect(commands.state(id, outputId).status).toBe(200)
})

test('stopping the pulses never cancels another operation of the mount', async () => {
	const { id, commands, operations, mount, outputId } = await setup()
	const hold = operations.coordinator.start('test.hold', [{ key: resourceKey(mount), device: mount }], (context) => {
		const { promise, resolve } = Promise.withResolvers<{ readonly ok: true; readonly value: undefined }>()
		context.signal.addEventListener('abort', () => resolve({ ok: true, value: undefined }))
		return promise
	})

	expect(commands.pulse(id, outputId, { token: 'busy', direction: 'EAST', duration: 100 }).status).toBe(409)
	expect((await commands.stop(id, outputId)).status).toBe(204)
	expect(hold.signal.aborted).toBeFalse()
	await hold.cancel()
})

test('refuses unknown outputs, including the one of a mount that disconnected', async () => {
	const { id, client, manager, commands, mount, outputId } = await setup()
	expect(commands.pulse(id, 'missing', { token: 't', direction: 'NORTH', duration: 10 }).status).toBe(404)
	expect(commands.pulse('other', outputId, { token: 't', direction: 'NORTH', duration: 10 }).status).toBe(404)

	manager.devices.switch(client, mount.id, false)
	// The guide output is an interface the mount defines while connected, so it disappears with it.
	await waitUntil(() => !mount.connected)
	expect(commands.pulse(id, outputId, { token: 't', direction: 'NORTH', duration: 10 }).status).toBe(404)
})
