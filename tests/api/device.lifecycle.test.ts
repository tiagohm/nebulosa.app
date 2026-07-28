import { describe, expect, spyOn, test } from 'bun:test'
import type { Camera, Cover, Device, GuideOutput, Mount, SubDevice } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_COVER, DEFAULT_GUIDE_OUTPUT, DEFAULT_MOUNT } from 'nebulosa/src/devices/indi/device'
import type { DeviceHandler } from 'nebulosa/src/devices/indi/manager'
import { DeviceLifecycle, isDeviceQuiescent } from 'src/api/device.lifecycle'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationContext } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import type { OperationResult } from '#/orchestration'

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

function mount(): Mount {
	return {
		...structuredClone(DEFAULT_MOUNT),
		id: 'mount-1',
		name: 'mount-1',
		connected: true,
		client: { type: 'SIMULATOR', id: 'client-1' },
	}
}

function guideOutputProxy(parent: Mount): SubDevice<GuideOutput, Mount> {
	return {
		...structuredClone(DEFAULT_GUIDE_OUTPUT),
		id: 'guide-output-1',
		parentId: parent.id,
		parent,
		name: parent.name,
		connected: true,
		client: parent.client,
	}
}

function cover(): Cover {
	return {
		...structuredClone(DEFAULT_COVER),
		id: 'cover-1',
		name: 'cover-1',
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

	test('tracks external busy and quiescent state updates', () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = camera()
		const key = resourceKey(device)

		lifecycle.observe(manager)
		manager.add(device)
		expect(arbiter.availability(key)).toBe('available')

		device.exposuring = true
		device.exposure.state = 'Busy'
		manager.update(device, 'exposuring')
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
		const executorStopped = Promise.withResolvers<void>()

		lifecycle.observe(manager)
		manager.add(device)

		const handle = coordinator.start('capture', [{ key, device }], async (context) => {
			const result = await waitForAbort(context)
			await executorStopped.promise
			return result
		})
		manager.remove(device)

		expect(handle.signal.aborted).toBeTrue()
		expect(arbiter.availability(key)).toBe('unavailable')
		expect(arbiter.ownersOfClient('client-1')).toEqual([])

		executorStopped.resolve()
		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })

		lifecycle.dispose()
	})

	test('cancels an owner of a standalone guide-output resource', async () => {
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

	test('aggregates parent and subdevice busy states under one physical resource', () => {
		const mountManager = new TestDeviceManager<Mount>()
		const guideOutputManager = new TestDeviceManager<GuideOutput>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const parent = mount()
		const proxy = guideOutputProxy(parent)
		const key = resourceKey(parent)

		lifecycle.observe(mountManager)
		lifecycle.observe(guideOutputManager)
		mountManager.add(parent)
		guideOutputManager.add(proxy)

		expect(resourceKey(proxy)).toBe(key)
		expect(arbiter.availability(key)).toBe('available')

		parent.slewing = true
		mountManager.update(parent, 'slewing')
		expect(arbiter.availability(key)).toBe('unavailable')

		parent.slewing = false
		mountManager.update(parent, 'slewing')
		expect(arbiter.availability(key)).toBe('available')

		proxy.pulsing = true
		guideOutputManager.update(proxy, 'pulsing')
		expect(arbiter.availability(key)).toBe('unavailable')

		proxy.pulsing = false
		guideOutputManager.update(proxy, 'pulsing')
		expect(arbiter.availability(key)).toBe('available')

		lifecycle.dispose()
	})

	test('cancels on proxy removal while retaining the parent lifecycle view', async () => {
		const mountManager = new TestDeviceManager<Mount>()
		const guideOutputManager = new TestDeviceManager<GuideOutput>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const parent = mount()
		const proxy = guideOutputProxy(parent)
		const key = resourceKey(parent)

		lifecycle.observe(mountManager)
		lifecycle.observe(guideOutputManager)
		mountManager.add(parent)
		guideOutputManager.add(proxy)

		const handle = coordinator.start('guide-output', [{ key, device: proxy }], waitForAbort)
		guideOutputManager.remove(proxy)

		expect(handle.signal.aborted).toBeTrue()
		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })
		expect(arbiter.availability(key)).toBe('available')

		parent.slewing = true
		mountManager.update(parent, 'slewing')
		expect(arbiter.availability(key)).toBe('unavailable')

		mountManager.remove(parent)
		expect(arbiter.ownersOfClient(parent.client.id)).toEqual([])

		lifecycle.dispose()
	})

	test('ignores stale subdevice verification after retaining its parent', async () => {
		const mountManager = new TestDeviceManager<Mount>()
		const guideOutputManager = new TestDeviceManager<GuideOutput>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const verified = Promise.withResolvers<boolean>()
		const parent = mount()
		const proxy = guideOutputProxy(parent)
		const key = resourceKey(parent)

		lifecycle.observe(mountManager)
		lifecycle.observe(guideOutputManager, { verify: () => verified.promise })
		mountManager.add(parent)
		guideOutputManager.add(proxy)
		expect(arbiter.availability(key)).toBe('unavailable')

		guideOutputManager.remove(proxy)
		expect(arbiter.availability(key)).toBe('available')

		verified.resolve(false)
		await verified.promise
		await Promise.resolve()

		expect(arbiter.availability(key)).toBe('available')

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

		lifecycle.observe(manager, { verify: () => verified.promise })
		manager.add(device)
		manager.remove(device)
		verified.resolve(true)
		await verified.promise
		await Promise.resolve()

		expect(arbiter.availability(key)).toBe('unavailable')

		lifecycle.dispose()
	})

	test('stops observing a manager through its own registration', () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const device = camera()
		const key = resourceKey(device)

		const stop = lifecycle.observe(manager)
		manager.add(device)
		expect(arbiter.availability(key)).toBe('available')

		stop()
		stop()

		device.exposuring = true
		device.exposure.state = 'Busy'
		manager.update(device, 'exposuring')

		expect(arbiter.availability(key)).toBe('available')

		lifecycle.dispose()
	})

	test('forgets device views when the lifecycle is disposed', () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const stale = camera()
		const key = resourceKey(stale)
		const manager = new TestDeviceManager<Camera>()

		lifecycle.observe(manager)
		manager.add(stale)
		stale.exposuring = true
		stale.exposure.state = 'Busy'
		manager.update(stale, 'exposuring')
		expect(arbiter.availability(key)).toBe('unavailable')

		lifecycle.dispose()

		// A later observation of a quiescent instance must not aggregate the busy view left behind.
		const replacement = camera()
		const next = new TestDeviceManager<Camera>()

		lifecycle.observe(next)
		next.add(replacement)

		expect(arbiter.availability(key)).toBe('available')

		lifecycle.dispose()
	})

	test('skips verification for updates that cannot change quiescence', async () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const verified = Promise.withResolvers<boolean>()
		const device = camera()
		const key = resourceKey(device)
		let checks = 0

		lifecycle.observe(manager, {
			verify: () => {
				checks++
				return verified.promise
			},
		})
		manager.add(device)
		expect(checks).toBe(1)

		manager.update(device, 'temperature')
		manager.update(device, 'coolerPower')
		expect(checks).toBe(1)

		// The in-flight verification survives unrelated traffic and still applies its verdict.
		verified.resolve(true)
		await verified.promise
		await Bun.sleep(1)
		expect(arbiter.availability(key)).toBe('available')

		manager.update(device, 'exposuring')
		expect(checks).toBe(2)

		lifecycle.dispose()
	})

	test('reports a verifier that cannot decide and keeps the device blocked', async () => {
		const manager = new TestDeviceManager<Camera>()
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const lifecycle = new DeviceLifecycle(arbiter, coordinator)
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const device = camera()
		const key = resourceKey(device)

		try {
			lifecycle.observe(manager, {
				verify: () => {
					throw new Error('cannot read device state')
				},
			})
			manager.add(device)

			expect(arbiter.availability(key)).toBe('unavailable')
			expect(error).toHaveBeenCalled()

			error.mockClear()
			lifecycle.observe(manager, { verify: () => Promise.reject(new Error('transport lost')) })
			manager.add(device)
			await Bun.sleep(1)

			expect(arbiter.availability(key)).toBe('unavailable')
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
			lifecycle.dispose()
		}
	})

	test('treats a parking cover as busy', () => {
		const device = cover()

		device.parking = true
		expect(isDeviceQuiescent(device)).toBeFalse()

		device.parking = false
		expect(isDeviceQuiescent(device)).toBeTrue()
	})
})
