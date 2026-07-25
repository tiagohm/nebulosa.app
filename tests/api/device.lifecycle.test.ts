import { describe, expect, test } from 'bun:test'
import type { Camera, Device, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_GUIDE_OUTPUT } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import { DeviceLifecycle } from 'src/api/device.lifecycle'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationContext, OperationResult } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'

class TestDeviceManager<D extends Device> {
	readonly #devices = new Set<D>()
	readonly #handlers = new Set<DeviceHandler<D>>()

	addHandler(handler: DeviceHandler<D>) {
		this.#handlers.add(handler)
	}

	removeHandler(handler: DeviceHandler<D>) {
		this.#handlers.delete(handler)
	}

	list() {
		return this.#devices
	}

	add(device: D) {
		this.#devices.add(device)
		for (const handler of this.#handlers) handler.added(device)
	}

	update(device: D, property: keyof D & string) {
		for (const handler of this.#handlers) handler.updated?.(device, property)
	}

	remove(device: D) {
		for (const handler of this.#handlers) handler.removed(device)
		this.#devices.delete(device)
	}
}

function camera(): Camera {
	return {
		...structuredClone(DEFAULT_CAMERA),
		id: 'camera-1',
		name: 'camera-1',
		connected: true,
		client: { type: 'SIMULATOR', id: 'client-1' },
	} satisfies Camera
}

function guideOutput(): GuideOutput {
	return {
		...structuredClone(DEFAULT_GUIDE_OUTPUT),
		id: 'guide-output-1',
		name: 'guide-output-1',
		connected: true,
		client: { type: 'SIMULATOR', id: 'client-1' },
	}
}

function waitForAbort(context: OperationContext): Promise<OperationResult<void>> {
	return new Promise((resolve) => {
		context.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }), { once: true })
	})
}

describe('device lifecycle', () => {
	test('cancels the resource owner synchronously on disconnect', async () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = camera()
		const key = resourceKey(device)

		lifecycle.observe(manager)
		manager.add(device)
		expect(arbiter.availability(key)).toBe('available')

		const handle = coordinator.start('capture', [{ key, device }], waitForAbort)

		device.connected = false
		manager.update(device, 'connected')

		expect(handle.signal.aborted).toBeTrue()
		expect(arbiter.availability(key)).toBe('unavailable')
		expect(await handle.result).toEqual({ ok: false, reason: 'disconnected' })

		lifecycle.dispose()
	})

	test('keeps reconnecting devices unavailable until they are quiescent', () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = camera()
		const key = resourceKey(device)

		lifecycle.observe(manager)
		manager.add(device)

		device.connected = false
		manager.update(device, 'connected')
		expect(arbiter.availability(key)).toBe('unavailable')

		device.connected = true
		device.exposuring = true
		device.exposure.state = 'Busy'
		manager.update(device, 'connected')
		expect(arbiter.availability(key)).toBe('unavailable')

		device.exposuring = false
		device.exposure.state = 'Idle'
		manager.update(device, 'exposuring')
		expect(arbiter.availability(key)).toBe('available')

		lifecycle.dispose()
	})

	test('cancels the owner with removed before forgetting the device', async () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = camera()
		const key = resourceKey(device)

		lifecycle.observe(manager)
		manager.add(device)

		const handle = coordinator.start('capture', [{ key, device }], waitForAbort)
		manager.remove(device)

		expect(handle.signal.aborted).toBeTrue()
		expect(arbiter.availability(key)).toBe('unavailable')
		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })

		lifecycle.dispose()
	})

	test('cancels an owner of a distinct guide-output resource', async () => {
		const manager = new TestDeviceManager<GuideOutput>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = guideOutput()
		const key = resourceKey(device)

		lifecycle.observe(manager)
		manager.add(device)

		const handle = coordinator.start('guide-output', [{ key, device }], waitForAbort)
		manager.remove(device)

		expect(handle.signal.aborted).toBeTrue()
		expect(arbiter.availability(key)).toBe('unavailable')
		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })

		lifecycle.dispose()
	})

	test('ignores stale asynchronous verification after removal', async () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const verified = Promise.withResolvers<boolean>()
		const device = camera()
		const key = resourceKey(device)

		lifecycle.observe(manager, () => verified.promise)
		manager.add(device)
		manager.remove(device)
		verified.resolve(true)
		await verified.promise
		await Promise.resolve()

		expect(arbiter.availability(key)).toBe('unavailable')

		lifecycle.dispose()
	})
})
