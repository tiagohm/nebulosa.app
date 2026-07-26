import { describe, expect, spyOn, test } from 'bun:test'
import type { Camera, Mount } from 'nebulosa/src/devices/indi/device'
import { DEFAULT_CAMERA, DEFAULT_MOUNT } from 'nebulosa/src/devices/indi/device'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationContext, OperationResult } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import type { ResourceKey } from 'src/api/resource'

const CAMERA = 'client:camera:camera-1' as ResourceKey
const MOUNT = 'client:mount:mount-1' as ResourceKey

function waitForAbort(context: OperationContext): Promise<OperationResult<void>> {
	return new Promise((resolve) => {
		context.signal.addEventListener('abort', () => resolve({ ok: false, reason: 'aborted' }), { once: true })
	})
}

function waitForSignal(signal: AbortSignal): Promise<void> {
	if (signal.aborted) return Promise.resolve()

	return new Promise((resolve) => {
		signal.addEventListener('abort', () => resolve(), { once: true })
	})
}

function rejectUnknown(value: unknown): Promise<never> {
	const rejected = Promise.withResolvers<never>()
	rejected.reject(value)
	return rejected.promise
}

function device<D extends Camera | Mount>(template: D, id: string): D {
	return {
		...structuredClone(template),
		id,
		name: id,
		connected: true,
		client: { type: 'SIMULATOR', id: 'client-1' },
	}
}

describe('operation coordinator', () => {
	test('returns busy without invoking the conflicting executor', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const active = coordinator.start('active', [{ key: CAMERA }], waitForAbort)
		let invoked = false
		const busy = coordinator.start('busy', [{ key: CAMERA }, { key: MOUNT }], () => {
			invoked = true
			return { ok: true, value: undefined }
		})

		expect(await busy.result).toMatchObject({ ok: false, reason: 'busy' })
		expect(invoked).toBeFalse()
		expect(arbiter.availability(MOUNT)).toBe('available')

		await active.cancel()
	})

	test('keeps the lease until asynchronous LIFO cleanup completes', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const cleanupGate = Promise.withResolvers<void>()
		const cleanupStarted = Promise.withResolvers<void>()
		const events: string[] = []
		const handle = coordinator.start('capture', [{ key: CAMERA }], (context) => {
			context.onCleanup(() => {
				events.push('first')
			})
			context.onCleanup(async () => {
				events.push('second:start')
				cleanupStarted.resolve()
				await cleanupGate.promise
				events.push('second:end')
			})
			return waitForAbort(context)
		})

		const firstCancel = handle.cancel()
		const secondCancel = handle.cancel()

		expect(handle.signal.aborted).toBeTrue()
		await cleanupStarted.promise
		expect(arbiter.availability(CAMERA)).toBe('leased')
		expect(events).toEqual(['second:start'])

		cleanupGate.resolve()
		await Promise.all([firstCancel, secondCancel])

		expect(events).toEqual(['second:start', 'second:end', 'first'])
		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(await handle.result).toEqual({ ok: false, reason: 'aborted' })
	})

	test('keeps the lease until a canceled executor settles', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const abortObserved = Promise.withResolvers<void>()
		const executorGate = Promise.withResolvers<void>()
		const handle = coordinator.start('capture', [{ key: CAMERA }], async (context) => {
			await waitForSignal(context.signal)
			abortObserved.resolve()
			await executorGate.promise
			return { ok: false, reason: 'aborted' }
		})

		const cancellation = handle.cancel()

		await abortObserved.promise
		expect(arbiter.availability(CAMERA)).toBe('leased')

		const contender = coordinator.start('contender', [{ key: CAMERA }], () => ({ ok: true, value: undefined }))
		expect(await contender.result).toMatchObject({ ok: false, reason: 'busy' })

		executorGate.resolve()
		await cancellation
		expect(await handle.result).toEqual({ ok: false, reason: 'aborted' })
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('aborts a completed executor while its cleanup is still running', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const cleanupStarted = Promise.withResolvers<void>()
		const handle = coordinator.start('capture', [{ key: CAMERA }], (context) => {
			context.onCleanup(async () => {
				cleanupStarted.resolve()
				await waitForSignal(context.signal)
			})
			return { ok: true, value: 'captured' }
		})

		await cleanupStarted.promise
		expect(arbiter.availability(CAMERA)).toBe('leased')

		const cancellation = handle.cancel()

		expect(handle.signal.aborted).toBeTrue()
		await cancellation
		expect(await handle.result).toEqual({ ok: true, value: 'captured' })
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('unregisters the exact cleanup registration when callbacks repeat', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const events: string[] = []
		const sharedCleanup = () => {
			events.push('shared')
		}
		const handle = coordinator.start('cleanup-registration', [], (context) => {
			const unregisterFirst = context.onCleanup(sharedCleanup)
			context.onCleanup(() => {
				events.push('middle')
			})
			context.onCleanup(sharedCleanup)
			unregisterFirst()
			return { ok: true, value: undefined }
		})

		expect(await handle.result).toEqual({ ok: true, value: undefined })
		expect(events).toEqual(['shared', 'middle'])
	})

	test('preserves an operational failure while appending cleanup errors', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const handle = coordinator.start('failing', [{ key: CAMERA }], (context) => {
			context.onCleanup(() => rejectUnknown(Symbol('cleanup detail')))
			return { ok: false, reason: 'timeout', error: 'primary failure' }
		})

		expect(await handle.result).toEqual({
			ok: false,
			reason: 'timeout',
			error: 'primary failure; cleanup failed: Symbol(cleanup detail)',
		})
	})

	test('preserves successful payloads containing an ok field', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const payload = { ok: true, settled: false }
		const handle = coordinator.start('raw-payload', [], () => ({ ok: true, value: payload }))

		expect(await handle.result).toEqual({ ok: true, value: payload })
	})

	test('preserves an expected failure returned by the executor', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const handle = coordinator.start('timeout', [], () => ({ ok: false, reason: 'timeout', error: 'device did not settle' }))

		expect(await handle.result).toEqual({ ok: false, reason: 'timeout', error: 'device did not settle' })
	})

	test('aborts the operation scope after an unexpected executor failure', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const cleanupStarted = Promise.withResolvers<AbortSignal>()

		try {
			const handle = coordinator.start('unexpected', [{ key: CAMERA }], (context) => {
				context.onCleanup(async () => {
					cleanupStarted.resolve(context.signal)
					await waitForSignal(context.signal)
				})
				throw new Error('unexpected failure')
			})

			const signal = await cleanupStarted.promise
			expect(signal.aborted).toBeTrue()
			expect(await handle.result).toEqual({ ok: false, reason: 'commandFailed', error: 'unexpected failure' })
			expect(arbiter.availability(CAMERA)).toBe('available')
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})

	test('degrades a successful operation whose cleanup failed unexpectedly', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const error = spyOn(console, 'error').mockImplementation(() => {})

		try {
			const handle = coordinator.start('cleanup-defect', [{ key: CAMERA }], (context) => {
				context.onCleanup(() => {
					throw new Error('device did not release')
				})
				return { ok: true, value: 'done' }
			})

			expect(await handle.result).toEqual({ ok: false, reason: 'commandFailed', error: 'cleanup failed: device did not release' })
		} finally {
			error.mockRestore()
		}
	})

	test('keeps the executor detail when cancellation wins', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const running = Promise.withResolvers<void>()
		const handle = coordinator.start<void>('canceled-detail', [{ key: CAMERA }], async (context) => {
			running.resolve()
			await waitForSignal(context.signal)
			return { ok: false, reason: 'alert', error: 'device reported alert' }
		})

		await running.promise
		await handle.cancel('disconnected')

		expect(await handle.result).toEqual({ ok: false, reason: 'disconnected', error: 'device reported alert' })
	})

	test('cancels every owner associated with a client', async () => {
		const camera = device(DEFAULT_CAMERA, 'camera-1')
		const mount = device(DEFAULT_MOUNT, 'mount-1')
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const cameraHandle = coordinator.start('camera', [{ key: resourceKey(camera), device: camera }], waitForAbort)
		const mountHandle = coordinator.start('mount', [{ key: resourceKey(mount), device: mount }], waitForAbort)

		const cancellation = coordinator.cancelByClient('client-1', 'disconnected')

		expect(cameraHandle.signal.aborted).toBeTrue()
		expect(mountHandle.signal.aborted).toBeTrue()

		await cancellation

		expect(await cameraHandle.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(await mountHandle.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(arbiter.availability(resourceKey(camera))).toBe('available')
		expect(arbiter.availability(resourceKey(mount))).toBe('available')
	})
})
