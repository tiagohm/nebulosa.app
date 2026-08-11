import { describe, expect, test } from 'bun:test'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { SequencerActionContext, SequencerActionHandler, SequencerActionResult } from 'src/api/sequencer.registry'
import { SequencerRuntime, SessionAdmissionGate, SessionTeardown } from 'src/api/sequencer.runtime'
import type { SequencerPlan } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'

describe('session admission gate', () => {
	test('admits the first session and refuses another one naming the holder', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')
		const second = gate.claim('session-2')

		expect(first).toMatchObject({ ok: true, kind: 'admitted' })
		expect(second).toEqual({ ok: false, kind: 'refused', reason: 'busy', sessionId: 'session-1' })
		expect(gate.sessionId).toBe('session-1')
	})

	test('reports a start of the same session as reentrant without a claim', () => {
		const gate = new SessionAdmissionGate()

		gate.claim('session-1')

		const again = gate.claim('session-1')

		expect(again).toEqual({ ok: true, kind: 'reentrant', sessionId: 'session-1' })
		expect(gate.sessionId).toBe('session-1')
	})

	test('admits the next session after the claim is released', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')

		expect(first.ok && first.kind === 'admitted').toBeTrue()

		if (!first.ok || first.kind !== 'admitted') return

		first.claim.release()

		expect(gate.sessionId).toBeUndefined()

		const second = gate.claim('session-2')

		expect(second).toMatchObject({ ok: true, kind: 'admitted' })
		expect(gate.sessionId).toBe('session-2')
	})

	test('ignores a stale release instead of evicting the session admitted after it', () => {
		const gate = new SessionAdmissionGate()
		const first = gate.claim('session-1')

		if (!first.ok || first.kind !== 'admitted') return

		first.claim.release()
		gate.claim('session-2')
		first.claim.release()

		expect(gate.sessionId).toBe('session-2')
	})
})

describe('session teardown', () => {
	test('unwinds bootstrap steps in reverse order and only once', () => {
		const order: string[] = []
		const teardown = new SessionTeardown()

		teardown.add(() => order.push('claim'))
		teardown.add(() => order.push('reservation'))
		teardown.add(() => order.push('scope'))

		expect(teardown.size).toBe(3)

		teardown.run()

		expect(order).toEqual(['scope', 'reservation', 'claim'])
		expect(teardown.size).toBe(0)

		teardown.run()

		expect(order).toEqual(['scope', 'reservation', 'claim'])
	})

	test('keeps unwinding past a failing step and reports it', () => {
		const order: string[] = []
		const errors: unknown[] = []
		const teardown = new SessionTeardown()

		teardown.add(() => order.push('claim'))
		teardown.add(() => {
			throw new Error('reservation release failed')
		})
		teardown.add(() => order.push('scope'))

		teardown.run((error) => errors.push(error))

		expect(order).toEqual(['scope', 'claim'])
		expect(errors).toHaveLength(1)
		expect((errors[0] as Error).message).toBe('reservation release failed')
	})

	test('leaves the process admissible when a bootstrap stage fails', () => {
		const gate = new SessionAdmissionGate()
		const teardown = new SessionTeardown()
		const admission = gate.claim('session-1')

		if (!admission.ok || admission.kind !== 'admitted') return

		teardown.add(admission.claim.release)

		// Role resolution succeeded and reservation failed, which is the stage the reversal exists for.
		let reserved = true
		teardown.add(() => (reserved = false))

		teardown.run()

		expect(reserved).toBeFalse()
		expect(gate.sessionId).toBeUndefined()
		expect(gate.claim('session-2')).toMatchObject({ ok: true, kind: 'admitted' })
	})
})

const CAMERA_KEY = 'logical:camera-1'

interface ExposeConfiguration {
	readonly exposureTime: number
}

function exposeHandler(execute: (context: SequencerActionContext, configuration: ExposeConfiguration) => Promise<SequencerActionResult<number>>, version: number = 1): SequencerActionHandler<ExposeConfiguration, number> {
	return {
		type: 'expose',
		version,
		validate: (configuration) => {
			const exposureTime = (configuration as Partial<ExposeConfiguration>).exposureTime
			return typeof exposureTime === 'number' ? { ok: true, configuration: { exposureTime } } : { ok: false, issues: [{ path: 'exposureTime', message: 'exposureTime must be a number of seconds' }] }
		},
		resources: () => [{ role: 'camera' }],
		execute,
	}
}

function plan(): SequencerPlan {
	return { definitionId: 'definition-1', definitionRevision: 1, devices: { camera: 'camera-1' }, action: { id: 'node-1', type: 'expose', configuration: { exposureTime: 2 } } }
}

function runtime(handler: SequencerActionHandler<ExposeConfiguration, number>) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()

	registry.register(handler)

	return { arbiter, coordinator, registry, store, runtime: new SequencerRuntime({ store, registry, coordinator, resolve: (_, deviceId) => ({ key: `logical:${deviceId}` }) }) }
}

describe('sequencer runtime', () => {
	test('takes a one action session from start to completed and releases everything', async () => {
		const acquired: string[] = []

		const {
			runtime: instance,
			store,
			arbiter,
		} = runtime(
			exposeHandler(async (context, configuration) => {
				const request = context.request('camera')!
				const handle = context.scope.start('expose', [request], (operation) => {
					acquired.push(...arbiter.resourcesOf(operation))
					return { ok: true, value: configuration.exposureTime }
				})

				await handle.result
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' })

				return { type: 'completed', value: configuration.exposureTime }
			}),
		)

		const created = instance.create(plan())!
		const started = instance.start(created.id)

		expect(started).toMatchObject({ ok: true, reentrant: false })
		expect(instance.activeSessionId).toBe(created.id)

		const session = await instance.settled(created.id)

		expect(acquired).toEqual([CAMERA_KEY])
		expect(session?.state).toBe('completed')
		expect(session?.endedAt).toBeDefined()
		expect(session?.checkpoint.completed).toEqual(['node-1'])
		expect(session?.checkpoint.cursor).toBeUndefined()
		expect(store.events(created.id).map((event) => event.type)).toEqual(['stateChanged', 'stateChanged', 'artifactCommitted', 'stateChanged'])
		expect(store.events(created.id).map((event) => event.state)).toEqual(['running', 'finalizing', undefined, 'completed'])
		expect(store.events(created.id)[2]).toMatchObject({ nodeId: 'node-1', detail: 'slot-1' })
		expect(store.artifacts(created.id)).toMatchObject([{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed' }])

		// The reservation and the claim are gone only after the action and its cleanups finished.
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('runs the action inside the reservation while refusing an operation outside it', async () => {
		const outside = Promise.withResolvers<string>()

		const { runtime: instance, coordinator } = runtime(
			exposeHandler(async (context) => {
				const request = context.request('camera')!

				const external = coordinator.start('manual', [request], () => ({ ok: true, value: 1 }))
				const result = await external.result

				outside.resolve(result.ok ? 'acquired' : (result.error ?? result.reason))

				const handle = context.scope.start('expose', [request], () => ({ ok: true, value: 2 }))

				return (await handle.result).ok ? { type: 'completed', value: 2 } : { type: 'fatalFailure', reason: 'busy' }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(await outside.promise).toContain('is reserved by sequencer')
		expect(session?.state).toBe('completed')
	})

	test('refuses a second session while one is active and admits it afterwards', async () => {
		const release = Promise.withResolvers<void>()

		const { runtime: instance } = runtime(
			exposeHandler(async () => {
				await release.promise
				return { type: 'completed', value: 1 }
			}),
		)

		const first = instance.create(plan())!
		const second = instance.create(plan())!

		instance.start(first.id)

		expect(instance.start(second.id)).toEqual({ ok: false, reason: 'busy', sessionId: first.id, detail: `session ${first.id} is already active` })
		expect(instance.start(first.id)).toMatchObject({ ok: true, reentrant: true })

		release.resolve()

		await instance.settled(first.id)

		expect(instance.start(second.id)).toMatchObject({ ok: true, reentrant: false })
	})

	test('refuses to start an unknown session and a session that already ran', async () => {
		const { runtime: instance } = runtime(exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 })))

		expect(instance.start('session-404')).toEqual({ ok: false, reason: 'unknownSession' })

		const created = instance.create(plan())!

		instance.start(created.id)

		await instance.settled(created.id)

		// The plan is dropped at finalization, and the terminal state is still what refuses the restart.
		expect(instance.start(created.id)).toEqual({ ok: false, reason: 'notStartable', detail: 'session is completed' })
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('releases the claim when a bootstrap stage throws', async () => {
		const handler = exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 }))
		let broken = true

		const { runtime: instance, arbiter } = runtime({
			...handler,
			resources: (configuration) => {
				if (broken) throw new Error('resource declaration exploded')
				return handler.resources(configuration)
			},
		})

		const created = instance.create(plan())!

		expect(() => instance.start(created.id)).toThrowError('resource declaration exploded')
		expect(instance.activeSessionId).toBeUndefined()
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')

		broken = false

		const next = instance.create(plan())!

		expect(instance.start(next.id)).toMatchObject({ ok: true, reentrant: false })
		expect((await instance.settled(next.id))?.state).toBe('completed')
	})

	test('refuses to start when the recorded handler version no longer matches', () => {
		const { runtime: instance, registry, arbiter } = runtime(exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 })))
		const created = instance.create(plan())!

		// The handler is replaced by another version between creating the session and starting it.
		const registered = registry.handler('expose')!
		Object.defineProperty(registered, 'version', { value: 2 })

		const started = instance.start(created.id)

		expect(started).toMatchObject({ ok: false, reason: 'handlerUnresolved' })
		expect(instance.activeSessionId).toBeUndefined()
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.start(created.id)).toMatchObject({ ok: false, reason: 'handlerUnresolved' })
	})

	test('refuses to start when a commanded role cannot be resolved', () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const registry = new SequencerBlockRegistry()
		const store = new InMemorySequencerStore()

		registry.register(exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 })))

		const instance = new SequencerRuntime({ store, registry, coordinator, resolve: () => undefined })
		const created = instance.create(plan())!

		expect(instance.start(created.id)).toEqual({ ok: false, reason: 'roleUnresolved', detail: 'role camera is not available' })
		expect(instance.activeSessionId).toBeUndefined()
		expect(store.session(created.id)?.state).toBe('created')
	})

	test('refuses to start when the resources are reserved by someone else', () => {
		const { runtime: instance, arbiter } = runtime(exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 })))
		const created = instance.create(plan())!

		arbiter.reserve({ id: 'other', kind: 'guider' }, [{ key: CAMERA_KEY }])

		expect(instance.start(created.id)).toMatchObject({ ok: false, reason: 'resourcesUnavailable', detail: `${CAMERA_KEY} is held by guider other` })
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('fails the session with the reported cause and still releases the reservation', async () => {
		const { runtime: instance, arbiter } = runtime(exposeHandler(() => Promise.resolve({ type: 'fatalFailure', reason: 'commandFailed', detail: 'camera did not respond' })))
		const created = instance.create(plan())!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('failed')
		expect(session?.failure).toEqual({ reason: 'commandFailed', detail: 'camera did not respond' })
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('fails the session when the handler throws instead of reporting', async () => {
		const { runtime: instance, arbiter } = runtime(
			exposeHandler(() => {
				throw new Error('driver exploded')
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('failed')
		expect(session?.failure).toEqual({ reason: 'commandFailed', detail: 'driver exploded' })
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
	})

	test('releases everything when the store refuses the finalizing commit', async () => {
		const {
			runtime: instance,
			arbiter,
			store,
		} = runtime(
			exposeHandler((context) => {
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' })
				context.artifact({ logicalSlotId: 'slot-1', attempt: 2, status: 'committed', path: '/data/frame-2.fits' })

				return Promise.resolve({ type: 'completed', value: 1 })
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(store.artifacts(created.id)).toEqual([])
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()

		expect(instance.start(instance.create(plan())!.id)).toMatchObject({ ok: true })
	})

	test('stops a running session, aborting the action and its operations', async () => {
		const running = Promise.withResolvers<void>()
		const cleaned: string[] = []

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(async (context) => {
				const request = context.request('camera')!

				const handle = context.scope.start('expose', [request], async (operation) => {
					operation.onCleanup(() => void cleaned.push('expose'))
					running.resolve()
					await new Promise<void>((resolve) => {
						operation.signal.addEventListener('abort', () => resolve(), { once: true })
					})
					return { ok: false, reason: 'aborted' }
				})

				await handle.result

				return { type: 'fatalFailure', reason: 'aborted' }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		await running.promise

		const session = await instance.stop(created.id)

		expect(cleaned).toEqual(['expose'])
		expect(session?.state).toBe('failed')
		expect(session?.desiredState).toBe('stopped')
		expect(session?.failure?.reason).toBe('aborted')
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('stops a running session even when the store refuses the stop intent', async () => {
		const running = Promise.withResolvers<void>()

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(async (context) => {
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' })
				context.artifact({ logicalSlotId: 'slot-1', attempt: 2, status: 'committed', path: '/data/frame-2.fits' })
				running.resolve()

				await new Promise<void>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(), { once: true })
				})

				return { type: 'fatalFailure', reason: 'aborted' }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		await running.promise

		const session = await instance.stop(created.id)

		expect(session?.state).toBe('failed')
		expect(session?.desiredState).toBe('stopped')
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})
})
