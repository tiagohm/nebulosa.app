import { afterEach, expect, test } from 'bun:test'
import { resourceKey } from 'nebulosa/src/devices/orchestration/resource'
import { CameraCommands } from './cameras'
import type { CommandError } from './commands'
import { ConnectionManager } from './connection'
import { OperationRegistry } from './operations'

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

// Simulator connection with its camera connected.
async function setup() {
	const manager = new ConnectionManager()
	disposables.push(manager)
	const { id } = await manager.connect({ type: 'SIMULATOR' })
	const client = manager.client(id)!
	const operations = new OperationRegistry(manager.devices, () => {})
	disposables.push(operations)
	const commands = new CameraCommands(manager.devices, (connectionId) => manager.client(connectionId), operations)
	const cameraId = manager.devices.list(client).find((d) => d.type === 'camera')!.id
	manager.devices.switch(client, cameraId, true)
	const camera = manager.devices.camera(client, cameraId)!
	await waitUntil(() => camera.connected && camera.hasCoolerControl && camera.canSetTemperature && operations.available(camera))
	return { id, client, manager, commands, operations, camera, cameraId }
}

test('switches the cooler and sets its target, reported by the capabilities', async () => {
	const { id, client, manager, commands, camera, cameraId } = await setup()

	expect((await commands.setCooler(id, cameraId, { enabled: true })).status).toBe(204)
	await waitUntil(() => camera.cooler)
	expect((await commands.setTemperature(id, cameraId, { value: -10 })).status).toBe(204)
	expect(manager.devices.cameraCapabilities(client, cameraId)).toMatchObject({ canSetTemperature: true, cooler: { enabled: true } })
	expect((await commands.setCooler(id, cameraId, { enabled: false })).status).toBe(204)
	await waitUntil(() => !camera.cooler)
})

test('cooling changes are refused while an operation holds the camera', async () => {
	const { id, commands, operations, camera, cameraId } = await setup()
	const capture = operations.coordinator.start('test.capture', [{ key: resourceKey(camera), device: camera }], (context) => {
		const { promise, resolve } = Promise.withResolvers<{ readonly ok: true; readonly value: undefined }>()
		context.signal.addEventListener('abort', () => resolve({ ok: true, value: undefined }))
		return promise
	})

	const refused = await commands.setTemperature(id, cameraId, { value: -5 })
	expect(refused.status).toBe(409)
	expect(((await refused.json()) as CommandError).code).toBe('busy')
	expect((await commands.setCooler(id, cameraId, { enabled: true })).status).toBe(409)
	await capture.cancel()
	expect((await commands.setCooler('other', cameraId, { enabled: true })).status).toBe(404)
})
