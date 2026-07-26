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

	test('answers ownership questions from inside the operation', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const owned = Promise.withResolvers<readonly boolean[]>()
		const handle = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			owned.resolve([context.owns(CAMERA), context.owns(MOUNT)])
			return waitForAbort(context)
		})

		expect(await owned.promise).toEqual([true, false])

		await handle.cancel()

		// Ownership ends with the lease, so a released resource is no longer claimed.
		expect(arbiter.owns(handle, CAMERA)).toBeFalse()
	})

	test('reports a cleanup registered after finalization began', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const error = spyOn(console, 'error').mockImplementation(() => {})
		const cleanupStarted = Promise.withResolvers<OperationContext>()
		const gate = Promise.withResolvers<void>()
		let late = false

		try {
			const handle = coordinator.start('late-cleanup', [{ key: CAMERA }], (context) => {
				context.onCleanup(async () => {
					cleanupStarted.resolve(context)
					await gate.promise
				})
				return { ok: true, value: undefined }
			})

			const context = await cleanupStarted.promise
			const unregister = context.onCleanup(() => {
				late = true
			})
			unregister()
			gate.resolve()

			expect(await handle.result).toEqual({ ok: true, value: undefined })
			expect(late).toBeFalse()
			expect(error).toHaveBeenCalled()
		} finally {
			error.mockRestore()
		}
	})

	test('cancels the owner holding one affected resource', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const handle = coordinator.start('composite', [{ key: CAMERA }, { key: MOUNT }], waitForAbort)

		const cancellation = coordinator.cancelByResource(MOUNT, 'removed')

		expect(handle.signal.aborted).toBeTrue()
		await cancellation

		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })
		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(MOUNT)).toBe('available')
		await coordinator.cancelByResource(MOUNT)
	})

	test('cancels every active operation during shutdown', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const cleaned: string[] = []
		const start = (kind: string, key: ResourceKey) =>
			coordinator.start(kind, [{ key }], (context) => {
				context.onCleanup(() => {
					cleaned.push(kind)
				})
				return waitForAbort(context)
			})

		const capture = start('capture', CAMERA)
		const slew = start('slew', MOUNT)

		await coordinator.cancelAll('disconnected')

		expect(await capture.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(await slew.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(cleaned.toSorted()).toEqual(['capture', 'slew'])
		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(MOUNT)).toBe('available')

		// Shutdown is idempotent once nothing is left to cancel.
		await coordinator.cancelAll()
	})

	test('resolves and cancels an operation by id while it is retained', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const handle = coordinator.start('capture', [{ key: CAMERA }], waitForAbort)

		expect(coordinator.get(handle.id)).toBe(handle)
		await coordinator.cancel('unknown-operation')

		await coordinator.cancel(handle.id, 'removed')

		expect(await handle.result).toEqual({ ok: false, reason: 'removed' })
		expect(coordinator.get(handle.id)).toBeUndefined()
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('reuses the tree ownership when a nested scope requests the same resource', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const child = Promise.withResolvers<OperationResult<string>>()
		const parent = coordinator.start('composite', [{ key: CAMERA }, { key: MOUNT }], async (context) => {
			const nested = context.start('capture', [{ key: CAMERA }], () => ({ ok: true, value: 'frame' }))
			child.resolve(await nested.result)
			return waitForAbort(context)
		})

		expect(await child.promise).toEqual({ ok: true, value: 'frame' })

		// The nested lease ended, but the tree still owns the camera through the enclosing scope.
		expect(arbiter.availability(CAMERA)).toBe('leased')

		await parent.cancel()

		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(MOUNT)).toBe('available')
	})

	test('releases a resource acquired only by a nested scope when it ends', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const nested = Promise.withResolvers<void>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], async (context) => {
			const child = context.start('slew', [{ key: MOUNT }], () => ({ ok: true, value: undefined }))
			await child.result
			nested.resolve()
			return waitForAbort(context)
		})

		await nested.promise

		expect(arbiter.availability(MOUNT)).toBe('available')
		expect(arbiter.availability(CAMERA)).toBe('leased')

		await parent.cancel()
	})

	test('cancels a nested scope without disturbing its parent', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const started = Promise.withResolvers<ReturnType<OperationContext['start']>>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			started.resolve(context.start('capture', [{ key: CAMERA }], waitForAbort))
			return waitForAbort(context)
		})

		const child = await started.promise
		await child.cancel('removed')

		expect(await child.result).toEqual({ ok: false, reason: 'removed' })
		expect(parent.signal.aborted).toBeFalse()

		await parent.cancel()
	})

	test('aborts nested scopes synchronously when an ancestor is canceled', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const started = Promise.withResolvers<AbortSignal>()
		const parent = coordinator.start<void>('composite', [{ key: CAMERA }], async (context) => {
			const child = context.start<void>('capture', [{ key: CAMERA }], (nested) => {
				started.resolve(nested.start('frame', [], waitForAbort).signal)
				return waitForAbort(nested)
			})
			return await child.result
		})

		const grandchildSignal = await started.promise
		const cancellation = parent.cancel('disconnected')

		// A parent blocked on a nested result must abort the whole subtree before anything is awaited.
		expect(grandchildSignal.aborted).toBeTrue()

		await cancellation
		expect(await parent.result).toEqual({ ok: false, reason: 'disconnected' })
	})

	test('waits for a detached nested scope before releasing the tree lease', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const events: string[] = []
		const cleanupGate = Promise.withResolvers<void>()
		const nested = Promise.withResolvers<void>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			context.onCleanup(() => {
				events.push('parent')
			})

			// A nested scope the executor never awaits still has to stop before the tree releases the camera.
			context.start('capture', [{ key: CAMERA }], (child) => {
				child.onCleanup(async () => {
					events.push('child:start')
					await cleanupGate.promise
					events.push('child:end')
				})
				nested.resolve()
				return waitForAbort(child)
			})

			return { ok: true, value: undefined }
		})

		await nested.promise
		await Bun.sleep(1)

		expect(events).toEqual(['child:start'])
		expect(arbiter.availability(CAMERA)).toBe('leased')

		cleanupGate.resolve()
		await parent.result

		expect(events).toEqual(['child:start', 'child:end', 'parent'])
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('cancels the whole tree from a resource a nested scope acquired', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const started = Promise.withResolvers<void>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			context.start('slew', [{ key: MOUNT }], (child) => {
				started.resolve()
				return waitForAbort(child)
			})
			return waitForAbort(context)
		})

		await started.promise
		await coordinator.cancelByResource(MOUNT, 'removed')

		// Lifecycle knows only the root owner, so a disconnect anywhere in the tree ends the whole operation.
		expect(await parent.result).toEqual({ ok: false, reason: 'removed' })
		expect(arbiter.availability(CAMERA)).toBe('available')
		expect(arbiter.availability(MOUNT)).toBe('available')
	})

	test('refuses a nested scope started after its parent was canceled', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const running = Promise.withResolvers<void>()
		const gate = Promise.withResolvers<void>()
		let invoked = false

		const parent = coordinator.start<OperationResult<void>>('composite', [{ key: CAMERA }], async (context) => {
			running.resolve()
			await gate.promise

			// A feature loop that starts its next step without re-reading the signal must still be stopped:
			// a nested scope owns a fresh controller and would not inherit the abort.
			const late = context.start<void>('capture', [{ key: CAMERA }], () => {
				invoked = true
				return { ok: true, value: undefined }
			})

			return { ok: true, value: await late.result }
		})

		await running.promise
		const cancellation = parent.cancel('disconnected')
		gate.resolve()
		await cancellation

		expect(invoked).toBeFalse()
		expect(await parent.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('refuses a nested scope started after its parent began finalizing', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const cleanupStarted = Promise.withResolvers<OperationContext>()
		const gate = Promise.withResolvers<void>()

		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			context.onCleanup(async () => {
				cleanupStarted.resolve(context)
				await gate.promise
			})
			return { ok: false, reason: 'alert', error: 'device reported alert' }
		})

		const context = await cleanupStarted.promise
		let invoked = false
		const late = context.start('capture', [{ key: CAMERA }], () => {
			invoked = true
			return { ok: true, value: undefined }
		})

		expect(await late.result).toEqual({ ok: false, reason: 'aborted', error: 'parent operation is no longer running' })
		expect(invoked).toBeFalse()

		gate.resolve()
		expect(await parent.result).toEqual({ ok: false, reason: 'alert', error: 'device reported alert' })
	})

	test('cancels only roots during shutdown and still unwinds nested scopes', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const cleaned: string[] = []
		const started = Promise.withResolvers<void>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			context.onCleanup(() => {
				cleaned.push('parent')
			})
			context.start('capture', [{ key: CAMERA }], (child) => {
				child.onCleanup(() => {
					cleaned.push('child')
				})
				started.resolve()
				return waitForAbort(child)
			})
			return waitForAbort(context)
		})

		await started.promise
		await coordinator.cancelAll('disconnected')

		expect(await parent.result).toEqual({ ok: false, reason: 'disconnected' })
		expect(cleaned).toEqual(['child', 'parent'])
		expect(arbiter.availability(CAMERA)).toBe('available')
	})

	test('refuses a resource a sibling scope is already holding', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const conflicted = Promise.withResolvers<OperationResult<void>>()
		let invoked = false
		let holderId = ''
		const parent = coordinator.start('composite', [{ key: CAMERA }], (context) => {
			const first = context.start('capture', [{ key: CAMERA }], waitForAbort)
			holderId = first.id

			conflicted.resolve(
				context.start<void>('capture', [{ key: CAMERA }], () => {
					invoked = true
					return { ok: true, value: undefined }
				}).result,
			)

			return first.result
		})

		expect(await conflicted.promise).toEqual({ ok: false, reason: 'busy', error: `${CAMERA} is owned by capture ${holderId}` })
		expect(invoked).toBeFalse()

		// The refused scope never acquired anything, so the sibling keeps the camera.
		expect(arbiter.availability(CAMERA)).toBe('leased')

		await parent.cancel()
	})

	test('reports ownership only for the scope holding a resource and its ancestors', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const answers = Promise.withResolvers<Record<string, readonly boolean[]>>()
		const parent = coordinator.start('composite', [{ key: CAMERA }], async (context) => {
			const nested = context.start('slew', [{ key: MOUNT }], (child) => {
				answers.resolve({
					// The nested scope inherits the camera from its parent and holds the mount itself.
					child: [child.owns(CAMERA), child.owns(MOUNT)],
					// The parent never acquired the mount, so a resource held only below it is not its own.
					parent: [context.owns(CAMERA), context.owns(MOUNT)],
				})
				return waitForAbort(child)
			})

			await nested.cancel()
			return { ok: true, value: context.owns(MOUNT) }
		})

		expect(await answers.promise).toEqual({ child: [true, true], parent: [true, false] })

		// The nested lease ended, so nothing in the tree claims the mount anymore.
		expect(await parent.result).toEqual({ ok: true, value: false })
	})

	test('restores the enclosing holder after a nested scope releases', async () => {
		const coordinator = new OperationCoordinator(new ResourceArbiter())
		const parent = coordinator.start('composite', [{ key: CAMERA }], async (context) => {
			const nested = context.start('capture', [{ key: CAMERA }], () => ({ ok: true, value: undefined }))
			await nested.result

			// A sibling started after the first one released is no longer blocked by it.
			const sibling = context.start('capture', [{ key: CAMERA }], (child) => ({ ok: true, value: child.owns(CAMERA) }))
			return await sibling.result
		})

		expect(await parent.result).toEqual({ ok: true, value: true })
	})

	test('cancels a busy operation without disturbing the active owner', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const active = coordinator.start('active', [{ key: CAMERA }], waitForAbort)
		const busy = coordinator.start('busy', [{ key: CAMERA }], () => ({ ok: true, value: undefined }))

		await busy.cancel()

		expect(await busy.result).toMatchObject({ ok: false, reason: 'busy' })
		expect(coordinator.get(busy.id)).toBeUndefined()
		expect(active.signal.aborted).toBeFalse()
		expect(arbiter.availability(CAMERA)).toBe('leased')

		await active.cancel()
	})
})
