import { describe, expect, test } from 'bun:test'
import { IndiClientHandlerSet } from 'nebulosa/src/devices/indi/client'
import type { Device } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA } from 'nebulosa/src/devices/indi/device'
import { FocuserManager, GuideOutputManager, MountManager, RotatorManager } from 'nebulosa/src/devices/indi/manager'
import type { DeviceProvider } from 'nebulosa/src/devices/indi/manager'
import { ConnectionHandler } from 'src/api/connection'
import { WebSocketMessageHandler } from 'src/api/message'
import { NotificationHandler } from 'src/api/notification'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import { failedOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'

class TestIndiHandler extends IndiClientHandlerSet implements DeviceProvider<Device> {
	get(): Device | undefined {
		return undefined
	}
}

async function connectionFixture(disconnectCleanupTimeout?: number) {
	Bun.env.appDir ??= process.cwd()
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const wsm = new WebSocketMessageHandler()
	const handler = new ConnectionHandler(wsm, new NotificationHandler(wsm), coordinator, disconnectCleanupTimeout)
	const status = await handler.connect({ type: 'SIMULATOR', host: '', port: -1, secured: false }, new TestIndiHandler(), new MountManager(), new FocuserManager(), new RotatorManager(), new GuideOutputManager({ get: () => undefined }))

	if (status === undefined) throw new Error('simulator connection failed')

	return { arbiter, coordinator, handler, status }
}

function camera(clientId: string): Device {
	return {
		...structuredClone(DEFAULT_CAMERA),
		id: 'camera-1',
		name: 'camera-1',
		connected: true,
		client: { type: 'SIMULATOR', id: clientId },
	}
}

describe('connection handler', () => {
	test('waits for client operation cleanup before disposing an expected disconnect', async () => {
		const { arbiter, coordinator, handler, status } = await connectionFixture()
		const clientId = status.id
		const device = camera(clientId)
		const key = resourceKey(device)
		const executorStarted = Promise.withResolvers<void>()
		const cleanupStarted = Promise.withResolvers<void>()
		const cleanupGate = Promise.withResolvers<void>()
		const handle = coordinator.start('capture', [{ key, device }], (context) => {
			context.onCleanup(async () => {
				cleanupStarted.resolve()
				await cleanupGate.promise
			})
			executorStarted.resolve()

			return new Promise<OperationResult<void>>((resolve) => {
				context.signal.addEventListener('abort', () => resolve(failedOperationResult('disconnected')), { once: true })
			})
		})

		await executorStarted.promise
		const disconnected = handler.disconnect(clientId)
		await cleanupStarted.promise

		expect(handle.signal.aborted).toBeTrue()
		expect(handler.list()).toEqual([status])
		expect(arbiter.availability(key)).toBe('unavailable')

		cleanupGate.resolve()
		await disconnected

		expect(handler.list()).toEqual([])
		expect(await handle.result).toEqual(failedOperationResult('disconnected'))
	})

	test('bounds cleanup before disposing an unresponsive client operation', async () => {
		const { coordinator, handler, status } = await connectionFixture(5)
		const device = camera(status.id)
		const executor = Promise.withResolvers<OperationResult<void>>()
		const handle = coordinator.start('capture', [{ key: resourceKey(device), device }], () => executor.promise)

		await handler.disconnect(status.id)

		expect(handle.signal.aborted).toBeTrue()
		expect(handler.list()).toEqual([])

		executor.resolve(failedOperationResult('disconnected'))
		expect(await handle.result).toEqual(failedOperationResult('disconnected'))
	})
})
