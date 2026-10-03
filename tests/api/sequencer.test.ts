import { describe, expect, test } from 'bun:test'
import { localSiderealTime } from 'nebulosa/src/astronomy/observer/location'
import type { Device, Mount, PierSide } from 'nebulosa/src/devices/indi/device'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import { SequencerHandler } from 'src/api/sequencer'
import { compile, sequencerPlanNodes } from 'src/api/sequencer.compiler'
import type { SequencerGuidingServices } from 'src/api/sequencer.guiding'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { AnySequencerActionHandler } from 'src/api/sequencer.registry'
import { SequencerRuntime } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { makeTime } from 'src/api/util'
import type { Sequencer, SequencerDeviceRole } from '#/sequencer'
import type { SequencerSessionState } from '#/sequencer.state'
import { canonical, frame, guiding, services } from './sequencer.fixture'

function blockTypes() {
	const compilation = compile(canonical())
	const types = new Set<string>()

	if (compilation.ok) {
		for (const node of sequencerPlanNodes(compilation.plan.root)) {
			if (node.kind === 'action') types.add(node.type)
		}
	}

	return types
}

function handler(type: string, execute: AnySequencerActionHandler['execute']): AnySequencerActionHandler {
	return { type, version: 1, validate: (configuration) => ({ ok: true, configuration }), resources: () => [{ role: 'camera' }, { role: 'mount' }], execute }
}

function mount(hourAngle: number, pierSide: PierSide = 'WEST'): Mount & { hourAngle: number } {
	const geographicCoordinate = { longitude: 0, latitude: 0, elevation: 0 }
	const device = {
		type: 'mount',
		name: 'Mount Simulator',
		id: 'mount-1',
		connected: true,
		client: { id: 'indi-1' },
		tracking: true,
		trackMode: 'SIDEREAL',
		canFlip: true,
		hasPierSide: true,
		pierSide,
		hourAngle,
		geographicCoordinate,
		get equatorialCoordinate() {
			return { rightAscension: localSiderealTime(makeTime(Date.now(), geographicCoordinate), geographicCoordinate, true) - device.hourAngle, declination: -0.09 }
		},
	}

	return device as unknown as Mount & { hourAngle: number }
}

function brief(): Sequencer['capture'] {
	return { ...canonical().capture, repeat: 1, delay: 0, frames: [frame('lum', { count: 2 })] }
}

function environment(execute?: AnySequencerActionHandler['execute'], devices?: Partial<Record<SequencerDeviceRole, Device>>, guidingServices?: SequencerGuidingServices) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()
	const runtime = new SequencerRuntime({ store, registry, coordinator, ...services(), ...(guidingServices === undefined ? {} : { guiding: guidingServices }), resolve: (role, deviceId) => ({ key: `logical:${deviceId}`, device: devices?.[role] }) })

	for (const type of blockTypes()) registry.register(handler(type, execute ?? (() => Promise.resolve({ type: 'completed', value: undefined }))))

	return { arbiter, coordinator, registry, store, runtime, handler: new SequencerHandler({ store, runtime, registry }) }
}

describe('definitions', () => {
	test('validates a definition against the handlers that would execute it', () => {
		const { handler: instance, registry } = environment()

		expect(instance.validate(canonical()).ok).toBeTrue()

		const empty = new SequencerBlockRegistry()

		expect(registry.handler('capture.frame')).toBeDefined()
		expect(empty.handler('capture.frame')).toBeUndefined()

		const refused = new SequencerHandler({ store: new InMemorySequencerStore(), runtime: environment().runtime, registry: empty }).validate(canonical())

		expect(refused.ok).toBeFalse()
		expect(refused.diagnostics.some((diagnostic) => diagnostic.message.includes('no handler is registered'))).toBeTrue()
	})
})

describe('sessions', () => {
	test('creates a session and keeps the lowering it will run', () => {
		const { handler: instance } = environment()
		const result = instance.createSession(canonical())

		expect(result.ok).toBeTrue()

		if (!result.ok) return

		const snapshot = result.session

		expect(snapshot.state).toBe('created')
		expect(snapshot.definitionId).toBe('definition-1')
		expect(snapshot.definitionRevision).toBe(7)
		expect(snapshot.target).toEqual({ id: 'm42', name: 'Orion Nebula' })
		expect(snapshot.capture.requiredSlots).toBe(20)

		const plan = instance.plan(snapshot.id)

		expect(plan?.plan.definitionId).toBe('definition-1')
		expect(plan?.preflight.repeat).toBe(2)
		expect(plan?.preflight.requiredSlots).toBe(40)
		expect(instance.plan('missing')).toBeUndefined()
		expect(instance.sessions()).toHaveLength(1)
	})

	test('reports the lowering that refused a definition instead of storing a session', async () => {
		const { handler: instance } = environment()
		const refused = await instance.start({ ...canonical(), capture: { ...canonical().capture, repeat: 0 } })

		expect(refused.ok).toBeFalse()

		if (refused.ok) return

		expect(refused.reason).toBe('invalidDefinition')
		expect(refused.preflight?.diagnostics).not.toBeEmpty()
		expect(instance.sessions()).toBeEmpty()
	})

	test('delegates the admission to the gate instead of deciding it', async () => {
		const started = Promise.withResolvers<void>()
		const { handler: instance } = environment(() => started.promise.then(() => ({ type: 'completed', value: undefined })))
		const first = await instance.start(canonical())
		const second = await instance.start({ ...canonical(), id: 'definition-2' })

		expect(first.ok).toBeTrue()
		expect(second).toMatchObject({ ok: false, reason: 'busy' })

		if (!first.ok) return

		expect(first).toMatchObject({ ok: true, reentrant: false })
		expect(second).toMatchObject({ ok: false, reason: 'busy', sessionId: first.session.id })
		expect(instance.snapshot(first.session.id)?.state).toBe('running')

		started.resolve()

		await instance.stop(first.session.id)

		expect(instance.snapshot(first.session.id)?.state).toBe('stopped')
	})

	test('records a pause without ending the session and a stop that does', async () => {
		const started = Promise.withResolvers<void>()
		const { handler: instance } = environment(() => started.promise.then(() => ({ type: 'completed', value: undefined })))
		const created = await instance.start(canonical())

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		const paused = await instance.pause(id)

		expect(paused).toMatchObject({ ok: true, effect: 'pause' })

		const snapshot = instance.snapshot(id)!

		expect(snapshot.state).toBe('running')
		expect(snapshot.desiredState).toBe('paused')
		expect(snapshot.converging).toBeTrue()

		const again = await instance.pause(id)

		expect(again).toMatchObject({ ok: true, effect: 'none', noop: 'alreadyPaused' })

		started.resolve()

		const stopped = await instance.stop(id)

		expect(stopped).toMatchObject({ ok: true, effect: 'stop' })
		expect(instance.snapshot(id)?.desiredState).toBe('stopped')
		expect(await instance.pause(id)).toMatchObject({ ok: true, effect: 'none', noop: 'terminal' })
		expect(await instance.pause('missing')).toEqual({ ok: false, reason: 'unknownSession' })
	})

	test('publishes the session as finalizing while the terminal pipeline runs', async () => {
		let observed: SequencerSessionState | undefined
		let refused: unknown
		let id = ''

		const { handler: instance } = environment(async (context) => {
			if (context.nodeId === 'finalize.action[parkMount]') {
				observed = instance.snapshot(id)?.state
				refused = await instance.pause(id)
			}

			return { type: 'completed', value: undefined }
		})
		const created = await instance.start(canonical())

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		id = created.session.id

		await instance.stop(id)

		expect(observed).toBe('finalizing')
		expect(refused).toMatchObject({ ok: true, effect: 'none', noop: 'finalizing' })
		expect(instance.snapshot(id)?.state).toBe('stopped')
		expect(instance.events(id).filter((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toHaveLength(1)
	})

	test('commands the meridian flip once the mount reports the target past the boundary', async () => {
		const nodes: string[] = []
		const device = mount(-0.05, 'WEST')
		const { handler: instance, runtime } = environment(
			(context) => {
				nodes.push(context.nodeId)
				if (context.frame !== undefined) device.hourAngle = 0.05
				return Promise.resolve({ type: 'completed', value: undefined })
			},
			{ mount: device },
		)
		const created = await instance.start({ ...canonical(), capture: brief() })

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		await runtime.settled(created.session.id)

		expect(nodes.some((nodeId) => nodeId.endsWith('.trigger.meridianFlip'))).toBeTrue()
	})

	test('commands no meridian flip while the mount reports the target east of the meridian', async () => {
		const nodes: string[] = []
		const { handler: instance, runtime } = environment(
			(context) => {
				nodes.push(context.nodeId)
				return Promise.resolve({ type: 'completed', value: undefined })
			},
			{ mount: mount(-0.05, 'EAST') },
		)
		const created = await instance.start({ ...canonical(), capture: brief() })

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		await runtime.settled(created.session.id)

		expect(nodes.some((nodeId) => nodeId.endsWith('.trigger.meridianFlip'))).toBeFalse()
	})

	test('binds the already-connected guider and hands it to every action', async () => {
		const guiders = new Set<string | undefined>()
		const { handler: instance, runtime } = environment(
			(context) => {
				guiders.add(context.guider)
				return Promise.resolve({ type: 'completed', value: undefined })
			},
			{ mount: mount(-0.05, 'EAST') },
		)
		const created = await instance.start({ ...canonical(), capture: brief() })

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		expect((await runtime.settled(created.session.id))?.state).toBe('completed')
		expect(guiders).toEqual(new Set(['guider-1']))
	})

	test('refuses to start when the guider is not connected', async () => {
		let executed = 0
		const { handler: instance } = environment(
			() => {
				executed++
				return Promise.resolve({ type: 'completed', value: undefined })
			},
			undefined,
			guiding(() => undefined),
		)
		const created = await instance.start({ ...canonical(), capture: brief() })

		expect(created.ok).toBeFalse()
		if (created.ok) return
		expect(created.reason).toBe('disconnected')
		expect(created.detail).toBe('guider guider-1 is not connected')
		expect(executed).toBe(0)
	})

	test('recovers only the events beyond a sequence the caller already has', async () => {
		const { handler: instance } = environment()
		const created = await instance.start(canonical())

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		await instance.stop(id)

		const events = instance.events(id)

		expect(events.length).toBeGreaterThan(1)
		expect(instance.events(id, events[0].sequence)).toEqual(events.slice(1))
		expect(instance.events(id, events.at(-1)!.sequence)).toBeEmpty()
		expect(instance.snapshot(id)?.lastEventSequence).toBe(events.at(-1)!.sequence)
		expect(instance.artifacts(id)).toBeEmpty()
		expect(instance.snapshot('missing')).toBeUndefined()
	})
})
