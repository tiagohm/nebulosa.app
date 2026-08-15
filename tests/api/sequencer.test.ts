import { describe, expect, test } from 'bun:test'
import { OperationCoordinator } from 'src/api/operation'
import { ResourceArbiter } from 'src/api/resource'
import { SequencerHandler } from 'src/api/sequencer'
import { compile, sequencerPlanNodes } from 'src/api/sequencer.compiler'
import { SequencerBlockRegistry } from 'src/api/sequencer.registry'
import type { AnySequencerActionHandler } from 'src/api/sequencer.registry'
import { SequencerRuntime } from 'src/api/sequencer.runtime'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import type { Sequencer } from '#/sequencer'
import type { SequencerSessionState } from '#/sequencer.state'
import { canonical, services } from './sequencer.fixture'

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
	return { type, version: 1, validate: (configuration) => ({ ok: true, configuration }), resources: () => [{ role: 'camera' }], execute }
}

function environment(execute?: AnySequencerActionHandler['execute']) {
	const arbiter = new ResourceArbiter()
	const coordinator = new OperationCoordinator(arbiter)
	const registry = new SequencerBlockRegistry()
	const store = new InMemorySequencerStore()
	const runtime = new SequencerRuntime({ store, registry, coordinator, ...services(), resolve: (_, deviceId) => ({ key: `logical:${deviceId}` }) })

	for (const type of blockTypes()) registry.register(handler(type, execute ?? (() => Promise.resolve({ type: 'completed', value: undefined }))))

	return { arbiter, coordinator, registry, store, runtime, handler: new SequencerHandler({ store, runtime, registry }) }
}

function stored(instance: SequencerHandler, overrides?: Partial<Sequencer>) {
	return instance.create({ ...canonical(), ...overrides })!
}

describe('definitions', () => {
	test('assigns the identity and reports the stored revisions', () => {
		const { handler: instance } = environment()
		const created = stored(instance)

		expect(created.revision).toBe(1)
		expect(created.definition.id).toBe(created.id)
		expect(instance.definitions()).toEqual([created])

		const updated = instance.update(created.id, { ...canonical(), name: 'M43' })!

		expect(updated.revision).toBe(2)
		expect(instance.definition(created.id)?.definition.name).toBe('M43')
		expect(instance.update('missing', canonical())).toBeUndefined()
	})

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

	test('refuses to remove a definition a live session still names', () => {
		const { handler: instance } = environment()
		const created = stored(instance)
		const session = instance.createSession(created.id)

		expect(session.ok).toBeTrue()
		expect(instance.remove(created.id)).toEqual({ ok: false, reason: 'inUse', sessionId: session.ok ? session.session.id : '' })
	})

	test('removes a definition once the session that named it was discarded', async () => {
		const { handler: instance } = environment()
		const created = stored(instance)
		const session = instance.createSession(created.id)

		expect(session.ok).toBeTrue()

		if (!session.ok) return

		// A session that never started ends on the spot: nothing is running, so there is nothing to wait for.
		const stop = await instance.stop(session.session.id)

		expect(stop).toMatchObject({ ok: true, effect: 'stop' })
		expect(stop.ok && stop.session.state).toBe('stopped')
		expect(stop.ok && stop.session.startedAt).toBeUndefined()
		expect(stop.ok && stop.session.endedAt).toBeDefined()
		expect(instance.snapshot(session.session.id)?.converging).toBeFalse()
		expect(instance.remove(created.id)).toEqual({ ok: true })
	})
})

describe('sessions', () => {
	test('creates a session and keeps the lowering it will run', () => {
		const { handler: instance } = environment()
		const created = stored(instance)
		const result = instance.createSession(created.id)

		expect(result.ok).toBeTrue()

		if (!result.ok) return

		const snapshot = result.session

		expect(snapshot.state).toBe('created')
		expect(snapshot.definitionId).toBe(created.id)
		expect(snapshot.definitionRevision).toBe(1)
		expect(snapshot.target).toEqual({ id: 'm42', name: 'Orion Nebula' })
		expect(snapshot.capture.requiredSlots).toBe(20)

		const plan = instance.plan(snapshot.id)

		expect(plan?.plan.definitionId).toBe(created.id)
		expect(plan?.preflight.repeat).toBe(2)
		expect(plan?.preflight.requiredSlots).toBe(40)
		expect(instance.plan('missing')).toBeUndefined()
		expect(instance.sessions()).toHaveLength(1)
	})

	test('reports the lowering that refused a definition instead of storing a session', () => {
		const { handler: instance } = environment()
		const created = stored(instance, { capture: { ...canonical().capture, repeat: 0 } })

		expect(instance.createSession('missing')).toEqual({ ok: false, reason: 'unknownDefinition' })

		const refused = instance.createSession(created.id)

		expect(refused.ok).toBeFalse()

		if (refused.ok) return

		expect(refused.reason).toBe('invalidDefinition')
		expect(refused.preflight?.diagnostics).not.toBeEmpty()
		expect(instance.sessions()).toBeEmpty()
	})

	test('delegates the admission to the gate instead of deciding it', async () => {
		const started = Promise.withResolvers<void>()
		const { handler: instance } = environment(() => started.promise.then(() => ({ type: 'completed', value: undefined })))
		const first = instance.createSession(stored(instance).id)
		const second = instance.createSession(stored(instance, { id: 'definition-2' }).id)

		expect(first.ok).toBeTrue()
		expect(second.ok).toBeTrue()

		if (!first.ok || !second.ok) return

		const admitted = instance.start(first.session.id)
		const refused = instance.start(second.session.id)

		expect(admitted).toMatchObject({ ok: true, reentrant: false })
		expect(refused).toMatchObject({ ok: false, reason: 'busy', sessionId: first.session.id })
		expect(instance.snapshot(first.session.id)?.state).toBe('running')

		started.resolve()

		await instance.stop(first.session.id)

		expect(instance.snapshot(first.session.id)?.state).toBe('stopped')
	})

	test('records a pause without ending the session and a stop that does', async () => {
		const started = Promise.withResolvers<void>()
		const { handler: instance } = environment(() => started.promise.then(() => ({ type: 'completed', value: undefined })))
		const created = instance.createSession(stored(instance).id)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		instance.start(id)

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

		const { handler: instance } = environment(async (context) => {
			if (context.nodeId === 'finalize.action[park]') {
				observed = instance.snapshot(id)?.state
				refused = await instance.pause(id)
			}

			return { type: 'completed', value: undefined }
		})
		const created = instance.createSession(stored(instance).id)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		instance.start(id)

		await instance.stop(id)

		expect(observed).toBe('finalizing')
		expect(refused).toMatchObject({ ok: true, effect: 'none', noop: 'finalizing' })
		expect(instance.snapshot(id)?.state).toBe('stopped')
		expect(instance.events(id).filter((event) => event.type === 'stateChanged' && event.state === 'finalizing')).toHaveLength(1)
	})

	test('recovers only the events beyond a sequence the caller already has', async () => {
		const { handler: instance } = environment()
		const created = instance.createSession(stored(instance).id)

		expect(created.ok).toBeTrue()

		if (!created.ok) return

		const id = created.session.id

		instance.start(id)

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
