import { describe, expect, spyOn, test } from 'bun:test'
import { join } from 'path'
import type { Camera, GuideOutput } from 'nebulosa/src/devices/indi/device'
import { localGuiderCameraKey, localGuiderOutputKey, remoteGuiderKey } from 'src/api/guider.session'
import { OperationCoordinator } from 'src/api/operation'
import type { OperationContext, OperationHandle } from 'src/api/operation'
import { ResourceArbiter, resourceKey } from 'src/api/resource'
import type { ReservationToken } from 'src/api/resource'
import { sequencerNodeId } from 'src/api/sequencer.compiler'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import type { SequencerPreparationServices } from 'src/api/sequencer.prepare'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { SequencerActionContext, SequencerActionHandler, SequencerActionResult, SequencerAuxiliaryTarget } from 'src/api/sequencer.registry'
import { SequencerRuntime, SessionAdmissionGate, SessionTeardown } from 'src/api/sequencer.runtime'
import type { SequencerDeviceResolver, SequencerRuntimePlanDraft } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { failedOperationResult, successfulOperationResult } from '#/orchestration'
import type { OperationResult } from '#/orchestration'
import type { SequencerDevices, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerPlan, SequencerPlanAction, SequencerPlanGuider, SequencerPlanSequence, SequencerPlanStorage } from '#/sequencer.plan'

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

const RETRY: SequencerRetryPolicy = { maxAttempts: 1, delay: 0, backoff: 1, maximumDelay: 0, retryOn: [], onExhausted: 'fail' }

const SERVICES = { preparation: {} as SequencerPreparationServices, guiding: {} as SequencerGuidingServices }

function compiled(overrides?: {
	readonly devices?: SequencerDevices
	readonly storage?: Partial<SequencerPlanStorage>
	readonly configuration?: unknown
	readonly execution?: Partial<SequencerPlan['execution']>
	readonly nodes?: number
	readonly guider?: SequencerPlan['guider']
	readonly startup?: SequencerPlan['startup']
	readonly finalize?: SequencerPlan['finalize']
}): SequencerPlan {
	const configuration = overrides?.configuration ?? { exposureTime: 2 }
	const actions: SequencerPlanAction[] = []

	for (let i = 1; i <= (overrides?.nodes ?? 1); i++) actions.push({ kind: 'action', id: `node-${i}`, type: 'expose', configuration })

	const target: SequencerPlanSequence = { kind: 'sequence', id: sequencerNodeId.target('m42'), children: actions }
	const children: SequencerPlanSequence[] = []

	if (overrides?.startup !== undefined) children.push({ kind: 'sequence', id: sequencerNodeId.pipeline('startup'), children: [{ kind: 'action', id: 'startup-1', type: 'expose', configuration: { exposureTime: 2, required: true, timeout: 30, retry: RETRY } }] })

	children.push(target)

	if (overrides?.finalize !== undefined) children.push({ kind: 'sequence', id: sequencerNodeId.pipeline('finalize'), children: [{ kind: 'action', id: 'finalize-1', type: 'expose', configuration }] })

	return {
		definitionId: 'definition-1',
		definitionRevision: 1,
		name: 'M42',
		target: { id: 'm42', name: 'Orion Nebula' },
		execution: { start: { type: 'manual' }, end: { type: 'afterSequence' }, pauseMode: 'afterCurrentExposure', stopMode: 'graceful', defaultRetry: RETRY, checkpoint: { afterEveryAction: true, afterEveryFrame: true, afterEveryArtifact: true, interval: 60 }, ...overrides?.execution },
		devices: overrides?.devices ?? { camera: 'camera-1' },
		roles: ['camera'],
		root: { kind: 'sequence', id: sequencerNodeId.root(), children },
		groups: [],
		handlers: { expose: 1 },
		storage: { root: '/data/nebulosa', fileNameTemplate: '{target}', directoryTemplate: '{target}', autoSubFolderMode: 'noon', ...overrides?.storage },
		guider: overrides?.guider,
		startup: overrides?.startup,
		finalize: overrides?.finalize,
	}
}

function guiderPlan(connection: SequencerPlanGuider['connection']): SequencerPlanGuider {
	return { connection, calibrateBeforeStart: false, recalibrateAfterMeridianFlip: false, settle: { tolerance: 1.5, time: 10, timeout: 120 }, retry: RETRY }
}

function plan(overrides?: Parameters<typeof compiled>[0]): SequencerRuntimePlanDraft {
	return { compiled: compiled(overrides) }
}

function runtime(handler: SequencerActionHandler<ExposeConfiguration, number>, now?: () => number, overrides?: { readonly resolve?: SequencerDeviceResolver; readonly guiding?: SequencerGuidingServices }) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()

	registry.register(handler)

	return { arbiter, coordinator, registry, store, runtime: new SequencerRuntime({ store, registry, coordinator, now, ...SERVICES, ...overrides, resolve: overrides?.resolve ?? ((_, deviceId) => ({ key: `logical:${deviceId}` })) }) }
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
		expect(session?.desiredState).toBe('stopped')
		expect(session?.endedAt).toBeDefined()
		expect(session?.checkpoint.completed).toEqual(['node-1'])
		expect(session?.checkpoint.cursor).toBeUndefined()
		expect(store.events(created.id).map((event) => event.type)).toEqual(['stateChanged', 'artifactCommitted', 'stateChanged', 'stateChanged'])
		expect(store.events(created.id).map((event) => event.state)).toEqual(['running', undefined, 'finalizing', 'completed'])
		expect(store.events(created.id)[1]).toMatchObject({ nodeId: 'node-1', detail: 'slot-1' })
		expect(store.artifacts(created.id)).toMatchObject([{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed' }])

		// The reservation and the claim are gone only after the action and its cleanups finished.
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('reserves the logical key of the remote guider the plan declares', async () => {
		let connected: unknown
		let availability: string | undefined

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(() => {
				availability = arbiter.availability(remoteGuiderKey('localhost', 4400))
				return Promise.resolve({ type: 'completed', value: 1 })
			}),
			undefined,
			{
				guiding: {
					guiderCommander: {
						connect: (request: unknown) => {
							connected = request
							return Promise.resolve(successfulOperationResult({ id: 'guider-1' }))
						},
					},
				} as unknown as SequencerGuidingServices,
			},
		)

		const created = instance.create(plan({ guider: guiderPlan({ mode: 'remote', host: 'localhost', port: 4400 }) }))!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(connected).toEqual({ mode: 'remote', host: 'localhost', port: 4400 })
		expect(availability).not.toBe('available')
		expect(arbiter.availability(remoteGuiderKey('localhost', 4400))).toBe('available')
	})

	test('reserves the devices and the logical keys of the local guider the plan declares', async () => {
		const camera = { id: 'guide-camera-1', type: 'camera', hardwareId: 'hw-guide-camera', connected: true, client: { id: 'client-1' } } as unknown as Camera
		const guideOutput = { id: 'guide-output-1', canPulseGuide: true, hardwareId: 'hw-guide-output', connected: true, client: { id: 'client-1' } } as unknown as GuideOutput
		let connected: unknown
		const held: string[] = []

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(() => {
				for (const key of [localGuiderCameraKey(camera), localGuiderOutputKey(guideOutput), 'hw-guide-camera', 'hw-guide-output']) {
					if (arbiter.availability(key) !== 'available') held.push(key)
				}

				return Promise.resolve({ type: 'completed', value: 1 })
			}),
			undefined,
			{
				resolve: (role, deviceId) => {
					if (role === 'guideCamera') return { key: resourceKey(camera), device: camera }
					if (role === 'guideOutput') return { key: resourceKey(guideOutput), device: guideOutput }
					return { key: `logical:${deviceId}` }
				},
				guiding: {
					guiderCommander: {
						connect: (request: unknown) => {
							connected = request
							return Promise.resolve(successfulOperationResult({ id: 'guider-1' }))
						},
					},
				} as unknown as SequencerGuidingServices,
			},
		)

		const created = instance.create(
			plan({
				devices: { camera: 'camera-1', guideCamera: 'guide-camera-1', guideOutput: 'guide-output-1' },
				guider: guiderPlan({ mode: 'local', focalLength: 200, capture: { exposureTime: 2, frameType: 'LIGHT', binX: 1, binY: 1, gain: 0, offset: 0, subframe: { enabled: false, x: 0, y: 0, width: 0, height: 0 }, transferFormat: 'FITS', compressed: false } }),
			}),
		)!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(connected).toEqual({ mode: 'local', focalLength: 200, camera: 'guide-camera-1', guideOutput: 'guide-output-1' })
		expect(held).toEqual([localGuiderCameraKey(camera), localGuiderOutputKey(guideOutput), 'hw-guide-camera', 'hw-guide-output'])
	})

	test('fails the session through the finalize pipeline when the guider the plan declares cannot be opened', async () => {
		const executed: string[] = []

		const { runtime: instance, arbiter } = runtime(
			exposeHandler((context) => {
				executed.push(context.nodeId)
				return Promise.resolve({ type: 'completed', value: 1 })
			}),
			undefined,
			{
				guiding: {
					guiderCommander: {
						connect: () => Promise.resolve(failedOperationResult('disconnected', 'the guider is unreachable')),
					},
				} as unknown as SequencerGuidingServices,
			},
		)

		const created = instance.create(plan({ guider: guiderPlan({ mode: 'remote', host: 'localhost', port: 4400 }), finalize: { continueOnFailure: true, runOn: ['failed'] } }))!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(executed).toEqual(['finalize-1'])
		expect(session?.state).toBe('failed')
		expect(session?.failure).toEqual({ reason: 'disconnected', detail: 'the guider is unreachable' })
		expect(arbiter.availability(remoteGuiderKey('localhost', 4400))).toBe('available')
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
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

	test('executes the plan as it was at creation, not as the caller left it', async () => {
		const seen: number[] = []

		const { runtime: instance } = runtime(
			exposeHandler((_, configuration) => {
				seen.push(configuration.exposureTime)
				return Promise.resolve({ type: 'completed', value: configuration.exposureTime })
			}),
		)

		const configuration = { exposureTime: 2 }
		const mutable = plan({ configuration, devices: { camera: 'camera-1' } })
		const created = instance.create(mutable)!

		configuration.exposureTime = 600
		;(mutable.compiled.devices as { camera: string }).camera = 'camera-2'

		instance.start(created.id)

		expect((await instance.settled(created.id))?.state).toBe('completed')
		expect(seen).toEqual([2])
	})

	test('completes the session when the progress observer throws', async () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const registry = new SequencerBlockRegistry()
		const store = new InMemorySequencerStore()
		const reported: number[] = []

		registry.register(
			exposeHandler((context, configuration) => {
				context.progress({ fraction: 0.5, detail: 'exposing' })
				return Promise.resolve({ type: 'completed', value: configuration.exposureTime })
			}),
		)

		const instance = new SequencerRuntime({
			store,
			registry,
			coordinator,
			...SERVICES,
			resolve: (_, deviceId) => ({ key: `logical:${deviceId}` }),
			progress: (_, __, progress) => {
				reported.push(progress.fraction!)
				throw new Error('websocket fanout failed')
			},
		})

		const created = instance.create(plan())!

		instance.start(created.id)

		expect((await instance.settled(created.id))?.state).toBe('completed')
		expect(reported).toEqual([0.5])
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

		const instance = new SequencerRuntime({ store, registry, coordinator, ...SERVICES, resolve: () => undefined })
		const created = instance.create(plan())!

		expect(instance.start(created.id)).toEqual({ ok: false, reason: 'roleUnresolved', detail: 'device camera-1 of role camera is not available' })
		expect(instance.activeSessionId).toBeUndefined()
		expect(store.session(created.id)?.state).toBe('created')
	})

	test('refuses to start when a required role the session does not carry is commanded', () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const registry = new SequencerBlockRegistry()
		const store = new InMemorySequencerStore()
		const handler = exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 }))

		registry.register({ ...handler, resources: () => [{ role: 'camera' }, { role: 'wheel' }] })

		const instance = new SequencerRuntime({ store, registry, coordinator, ...SERVICES, resolve: (_, deviceId) => ({ key: `logical:${deviceId}` }) })
		const created = instance.create(plan())!

		expect(instance.start(created.id)).toEqual({ ok: false, reason: 'roleUnresolved', detail: 'role wheel is not available' })
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('refuses to start when an optional role the session carries cannot be resolved', () => {
		const arbiter = new ResourceArbiter()
		const coordinator = new OperationCoordinator(arbiter)
		const registry = new SequencerBlockRegistry()
		const store = new InMemorySequencerStore()
		const handler = exposeHandler(() => Promise.resolve({ type: 'completed', value: 1 }))

		registry.register({ ...handler, resources: () => [{ role: 'camera' }, { role: 'wheel', optional: true }] })

		const instance = new SequencerRuntime({ store, registry, coordinator, ...SERVICES, resolve: (role, deviceId) => (role === 'wheel' ? undefined : { key: `logical:${deviceId}` }) })
		const created = instance.create(plan({ devices: { camera: 'camera-1', wheel: 'wheel-1' } }))!

		expect(instance.start(created.id)).toEqual({ ok: false, reason: 'roleUnresolved', detail: 'device wheel-1 of role wheel is not available' })
		expect(instance.activeSessionId).toBeUndefined()
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
	})

	test('starts without an optional role the session does not carry', async () => {
		let wheel: unknown = 'unread'
		const handler = exposeHandler((context) => {
			wheel = context.request('wheel')
			return Promise.resolve({ type: 'completed', value: 1 })
		})
		const { runtime: instance } = runtime({ ...handler, resources: () => [{ role: 'camera' }, { role: 'wheel', optional: true }] })
		const created = instance.create(plan())!

		expect(instance.start(created.id)).toMatchObject({ ok: true })
		expect((await instance.settled(created.id))?.state).toBe('completed')
		expect(wheel).toBeUndefined()
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

	test('announces only the artifacts whose last draft is committed', async () => {
		const { runtime: instance, store } = runtime(
			exposeHandler((context) => {
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' })
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' })
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'rejected' })
				context.artifact({ logicalSlotId: 'slot-2', attempt: 1, status: 'committed', path: '/data/frame-2.fits' })

				return Promise.resolve({ type: 'completed', value: 1 })
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(store.artifacts(created.id)).toMatchObject([
			{ logicalSlotId: 'slot-1', attempt: 1, status: 'rejected' },
			{ logicalSlotId: 'slot-2', attempt: 1, status: 'committed' },
		])
		expect(store.events(created.id).filter((event) => event.type === 'artifactCommitted')).toMatchObject([{ nodeId: 'node-1', detail: 'slot-2' }])
	})

	test('persists a pending artifact before the action returns', async () => {
		const observed: string[][] = []

		const harness = runtime(
			exposeHandler((context) => {
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' })
				observed.push(harness.store.artifacts(context.sessionId).map((artifact) => artifact.status))

				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' })
				observed.push(harness.store.artifacts(context.sessionId).map((artifact) => artifact.status))

				return Promise.resolve({ type: 'completed', value: 1 })
			}),
		)

		const created = harness.runtime.create(plan())!

		harness.runtime.start(created.id)

		const session = await harness.runtime.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(observed).toEqual([['pending'], ['pending']])
		expect(harness.store.artifacts(created.id)).toMatchObject([{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' }])
	})

	test('fails the action when the pending artifact cannot be persisted', async () => {
		const harness = runtime(
			exposeHandler((context) => {
				context.artifact({ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' })
				return Promise.resolve({ type: 'completed', value: 1 })
			}),
		)

		const accepted = harness.store.commit.bind(harness.store)

		spyOn(harness.store, 'commit').mockImplementation((commit) => (commit.artifacts === undefined ? accepted(commit) : { ok: false, reason: 'revisionMismatch' }))

		const created = harness.runtime.create(plan())!

		harness.runtime.start(created.id)

		const session = await harness.runtime.settled(created.id)

		expect(session?.state).toBe('failed')
		expect(session?.failure?.reason).toBe('commandFailed')
		expect(harness.store.artifacts(created.id)).toBeEmpty()
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

		const created = instance.create(plan({ execution: { stopMode: 'immediate' } }))!

		instance.start(created.id)

		await running.promise

		const session = await instance.stop(created.id)

		expect(cleaned).toEqual(['expose'])
		expect(session?.state).toBe('stopped')
		expect(session?.desiredState).toBe('stopped')
		expect(session?.failure).toBeUndefined()
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('lets a graceful stop finish the running action and ends before the next node', async () => {
		const running = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const executed: string[] = []
		const aborted: boolean[] = []

		const { runtime: instance } = runtime(
			exposeHandler(async (context, configuration) => {
				executed.push(context.nodeId)

				if (executed.length === 1) {
					running.resolve()
					await release.promise
					aborted.push(context.signal.aborted)
				}

				return { type: 'completed', value: configuration.exposureTime }
			}),
		)

		const created = instance.create(plan({ nodes: 2 }))!

		instance.start(created.id)

		await running.promise

		const stopped = instance.stop(created.id)

		release.resolve()

		const session = await stopped

		expect(aborted).toEqual([false])
		expect(executed).toEqual(['node-1'])
		expect(session?.state).toBe('stopped')
		expect(session?.failure).toBeUndefined()
	})

	test('cancels the running action on an immediate pause and runs it again on the resume', async () => {
		const running = Promise.withResolvers<void>()
		const executed: string[] = []

		const {
			runtime: instance,
			store,
			arbiter,
		} = runtime(
			exposeHandler(async (context, configuration) => {
				executed.push(context.nodeId)

				if (executed.length > 1) {
					const handle = context.scope.start('expose', [context.request('camera')!], () => successfulOperationResult(configuration.exposureTime))
					const result = await handle.result

					return result.ok ? { type: 'completed', value: result.value } : { type: 'fatalFailure', reason: result.reason }
				}

				running.resolve()

				await new Promise<void>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(), { once: true })
				})

				return { type: 'fatalFailure', reason: 'aborted' }
			}),
		)

		const created = instance.create(plan({ execution: { pauseMode: 'immediate' } }))!

		instance.start(created.id)

		await running.promise
		await instance.control(created.id, 'pause')

		while (store.session(created.id)?.state !== 'paused') await Bun.sleep(1)

		expect(arbiter.availability(CAMERA_KEY)).toBe('reserved')

		await instance.control(created.id, 'resume')

		const session = await instance.settled(created.id)

		expect(executed).toEqual(['node-1', 'node-1'])
		expect(session?.state).toBe('completed')
	})

	test('keeps the guiding session open across an immediate pause of the target block', async () => {
		const running = Promise.withResolvers<void>()
		const executed: string[] = []
		const opened: { coordinator?: OperationCoordinator; session?: OperationHandle<void> } = {}

		const { runtime: instance, coordinator } = runtime(
			exposeHandler(async (context, configuration) => {
				executed.push(context.nodeId)

				if (executed.length > 1) return { type: 'completed', value: configuration.exposureTime }

				running.resolve()

				await new Promise<void>((resolve) => {
					context.signal.addEventListener('abort', () => resolve(), { once: true })
				})

				return { type: 'fatalFailure', reason: 'aborted' }
			}),
			undefined,
			{
				guiding: {
					guiderCommander: {
						connect: (_: unknown, token: ReservationToken) => {
							const executor = (operation: OperationContext) =>
								new Promise<OperationResult<void>>((resolve) => {
									operation.signal.addEventListener('abort', () => resolve(failedOperationResult('aborted')), { once: true })
								})

							const handle = opened.coordinator!.tokenScope(token).start<void>('guiderSession', [], executor)

							opened.session = handle

							return Promise.resolve(successfulOperationResult({ id: handle.id }))
						},
					},
				} as unknown as SequencerGuidingServices,
			},
		)

		opened.coordinator = coordinator

		const created = instance.create(plan({ execution: { pauseMode: 'immediate' }, guider: guiderPlan({ mode: 'remote', host: 'localhost', port: 4400 }) }))!

		instance.start(created.id)

		await running.promise
		await instance.control(created.id, 'pause')

		expect(opened.session?.signal.aborted).toBeFalse()

		await instance.control(created.id, 'resume')

		const stored = await instance.settled(created.id)

		expect(executed).toEqual(['node-1', 'node-1'])
		expect(stored?.state).toBe('completed')
		expect(opened.session?.signal.aborted).toBeTrue()
	})

	test('cancels no startup operation on an immediate pause the phase cannot attribute', async () => {
		const running = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const executed: string[] = []

		const { runtime: instance } = runtime(
			exposeHandler(async (context, configuration) => {
				executed.push(context.nodeId)

				if (context.nodeId !== 'startup-1') return { type: 'completed', value: configuration.exposureTime }

				const handle = context.scope.start('expose', [context.request('camera')!], async (operation) => {
					running.resolve()

					await new Promise<void>((resolve) => {
						operation.signal.addEventListener('abort', () => resolve(), { once: true })
						void release.promise.then(resolve)
					})

					return operation.signal.aborted ? failedOperationResult('aborted') : successfulOperationResult(configuration.exposureTime)
				})

				const result = await handle.result

				return result.ok ? { type: 'completed', value: result.value } : { type: 'fatalFailure', reason: result.reason }
			}),
		)

		const created = instance.create(plan({ execution: { pauseMode: 'immediate' }, startup: { continueOnFailure: false } }))!

		instance.start(created.id)

		await running.promise
		await instance.control(created.id, 'pause')

		release.resolve()

		await instance.control(created.id, 'resume')

		const session = await instance.settled(created.id)

		expect(executed).toEqual(['startup-1', 'node-1'])
		expect(session?.state).toBe('completed')
	})

	test('takes the whole effect of an immediate pause before folding the resume that follows it', async () => {
		const running = Promise.withResolvers<void>()
		const observed: (string | undefined)[] = []
		const executed: string[] = []
		let sessionId = ''

		const { runtime: instance, store } = runtime(
			exposeHandler(async (context, configuration) => {
				executed.push(context.nodeId)

				if (executed.length > 1) return { type: 'completed', value: configuration.exposureTime }

				const handle = context.scope.start('expose', [context.request('camera')!], async (operation) => {
					operation.onCleanup(async () => {
						await Bun.sleep(5)
						observed.push(store.session(sessionId)?.desiredState)
					})

					running.resolve()

					await new Promise<void>((resolve) => {
						operation.signal.addEventListener('abort', () => resolve(), { once: true })
					})

					return failedOperationResult('aborted')
				})

				await handle.result

				return { type: 'fatalFailure', reason: 'aborted' }
			}),
		)

		const created = instance.create(plan({ execution: { pauseMode: 'immediate' } }))!

		sessionId = created.id

		instance.start(created.id)

		await running.promise

		const commanded = Promise.all([instance.control(created.id, 'pause'), instance.control(created.id, 'resume')])

		expect(await commanded).toMatchObject([{ ok: true }, { ok: true }])

		const session = await instance.settled(created.id)

		expect(observed).toEqual(['paused'])
		expect(executed).toEqual(['node-1', 'node-1'])
		expect(session?.state).toBe('completed')
	})

	test('holds the walk when a handler asks to pause without an operator command', async () => {
		let held = false

		const {
			runtime: instance,
			store,
			arbiter,
		} = runtime(
			exposeHandler((context, configuration) => {
				if (held) return Promise.resolve({ type: 'completed', value: configuration.exposureTime })

				held = true

				return Promise.resolve({ type: 'pause' })
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		while (store.session(created.id)?.state !== 'paused') await Bun.sleep(1)

		expect(store.session(created.id)?.desiredState).toBe('paused')
		expect(arbiter.availability(CAMERA_KEY)).toBe('reserved')

		await instance.control(created.id, 'resume')

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(
			store
				.events(created.id)
				.filter((event) => event.type === 'stateChanged')
				.map((event) => event.state),
		).toEqual(['running', 'paused', 'running', 'finalizing', 'completed'])
	})

	test('holds a paused session without releasing anything and runs the node again on the resume', async () => {
		let held = false

		const {
			runtime: instance,
			store,
			arbiter,
		} = runtime(
			exposeHandler(async (context, configuration) => {
				if (held) return { type: 'completed', value: configuration.exposureTime }

				held = true

				await instance.control(context.sessionId, 'pause')

				return { type: 'pause' }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		while (store.session(created.id)?.state !== 'paused') await Bun.sleep(1)

		expect(arbiter.availability(CAMERA_KEY)).toBe('reserved')

		await instance.control(created.id, 'resume')

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(
			store
				.events(created.id)
				.filter((event) => event.type === 'stateChanged')
				.map((event) => event.state),
		).toEqual(['running', 'paused', 'running', 'finalizing', 'completed'])
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
	})

	test('ends a held session when the operator stops it instead of resuming it', async () => {
		const {
			runtime: instance,
			store,
			arbiter,
		} = runtime(
			exposeHandler(async (context) => {
				await instance.control(context.sessionId, 'pause')
				return { type: 'pause' }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		while (store.session(created.id)?.state !== 'paused') await Bun.sleep(1)

		const session = await instance.stop(created.id)

		expect(session?.state).toBe('stopped')
		expect(session?.desiredState).toBe('stopped')
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('converges the desired state of a session that stops while finalizing', async () => {
		const cleaning = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(async (context) => {
				const handle = context.scope.start('expose', [context.request('camera')!], (operation) => {
					operation.onCleanup(async () => {
						cleaning.resolve()
						await release.promise
					})

					return { ok: true, value: 1 }
				})

				await handle.result

				return { type: 'completed', value: 1 }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		// The stop request lands while finalization is awaiting the cleanups of the operations it cancelled.
		await cleaning.promise

		const stopped = instance.stop(created.id)

		release.resolve()

		const session = await stopped

		expect(session?.state).toBe('completed')
		expect(session?.desiredState).toBe('stopped')
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

		const created = instance.create(plan({ execution: { stopMode: 'immediate' } }))!

		instance.start(created.id)

		await running.promise

		const session = await instance.stop(created.id)

		expect(session?.state).toBe('stopped')
		expect(session?.desiredState).toBe('stopped')
		expect(arbiter.availability(CAMERA_KEY)).toBe('available')
		expect(instance.activeSessionId).toBeUndefined()
	})

	test('reserves one auxiliary destination per image with an ordinal of its own kind', async () => {
		const targets: (SequencerAuxiliaryTarget | undefined)[] = []

		// The session is prepared before midnight and started after it, so the night it writes into is the one it
		// observes and not the one it was configured in.
		let clock = new Date(2026, 7, 12, 23, 50).getTime()

		const { runtime: instance } = runtime(
			exposeHandler((context, configuration) => {
				targets.push(context.auxiliary('centering', 'fits'), context.auxiliary('autofocus', 'fits'), context.auxiliary('centering', 'fits'))
				return Promise.resolve({ type: 'completed', value: configuration.exposureTime })
			}),
			() => clock,
		)

		const created = instance.create(plan({ storage: { autoSubFolderMode: 'midnight' } }))!

		clock = new Date(2026, 7, 13, 0, 10).getTime()

		instance.start(created.id)

		const session = await instance.settled(created.id)

		expect(session?.state).toBe('completed')
		expect(targets.map((target) => target?.fileName)).toEqual(['centering-00001.fits', 'autofocus-00001.fits', 'centering-00002.fits'])
		expect(targets[0]?.directory).toEndWith(join('2026-08-13', created.id, '.auxiliary', 'centering'))
		expect(targets[0]?.path).toBe(join(targets[0]!.directory, 'centering-00001.fits'))
	})

	test('ends the running session before releasing its reservation and admits no other one', async () => {
		const running = Promise.withResolvers<void>()
		const order: string[] = []

		const {
			runtime: instance,
			arbiter,
			store,
		} = runtime(
			exposeHandler(async (context) => {
				const handle = context.scope.start('expose', [context.request('camera')!], async (operation) => {
					operation.onCleanup(() => {
						order.push(`cleanup:${arbiter.availability(CAMERA_KEY)}`)
					})

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
		await instance.shutdown()

		order.push(`released:${arbiter.availability(CAMERA_KEY)}`)

		const session = store.session(created.id)!
		const other = instance.create(plan())!

		expect(order).toEqual(['cleanup:leased', 'released:available'])
		expect(session.state).toBe('interrupted')
		expect(session.desiredState).toBe('stopped')
		expect(session.endedAt).toBeUndefined()
		expect(store.events(created.id).at(-1)).toMatchObject({ type: 'stateChanged', state: 'interrupted', detail: 'the process is shutting down' })
		expect(instance.activeSessionId).toBeUndefined()
		expect(instance.start(other.id)).toEqual({ ok: false, reason: 'shuttingDown', detail: 'the process is shutting down' })
		expect(await instance.shutdown()).toBeUndefined()
	})

	test('waits for a finalization already in flight instead of returning past its cleanups', async () => {
		const cleaning = Promise.withResolvers<void>()
		const release = Promise.withResolvers<void>()
		const order: string[] = []

		const { runtime: instance, arbiter } = runtime(
			exposeHandler(async (context) => {
				const handle = context.scope.start('expose', [context.request('camera')!], (operation) => {
					operation.onCleanup(async () => {
						cleaning.resolve()
						await release.promise
						order.push('cleanup')
					})

					return { ok: true, value: 1 }
				})

				await handle.result

				return { type: 'completed', value: 1 }
			}),
		)

		const created = instance.create(plan())!

		instance.start(created.id)

		await cleaning.promise

		const closed = instance.shutdown().then(() => order.push(`shutdown:${arbiter.availability(CAMERA_KEY)}`))

		release.resolve()

		await closed

		expect(order).toEqual(['cleanup', 'shutdown:available'])
		expect(instance.activeSessionId).toBeUndefined()
	})
})
