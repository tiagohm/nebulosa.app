import { describe, expect, test } from 'bun:test'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import type { SequencerCheckpoint } from '#/sequencer.state'
import { canonical } from './sequencer.fixture'

function store(start: number = 1000) {
	let now = start
	return { store: new InMemorySequencerStore(() => now), tick: (step: number = 1) => (now += step) }
}

function session(instance: InMemorySequencerStore) {
	return instance.createSession({ definitionId: 'definition-1', definitionRevision: 3, handlerVersions: { wait: 1 } })
}

function checkpoint(cursor: string): SequencerCheckpoint {
	return { cursor, containers: ['root'], attempts: { [cursor]: 1 }, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1000), definitionRevision: 3, handlerVersions: { wait: 1 } }
}

describe('in memory sequencer store', () => {
	test('creates a session in created with an empty checkpoint', () => {
		const { store: instance } = store()
		const created = session(instance)

		expect(created.revision).toBe(0)
		expect(created.state).toBe('created')
		expect(created.desiredState).toBe('running')
		expect(created.createdAt).toBe(1000)
		expect(created.startedAt).toBeUndefined()
		expect(created.endedAt).toBeUndefined()
		expect(created.checkpoint).toEqual({ containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1000), definitionRevision: 3, handlerVersions: { wait: 1 } })
		expect(instance.session(created.id)).toEqual(created)
		expect(instance.sessions()).toEqual([created])
	})

	test('applies state, checkpoint, events, and artifacts as one unit', () => {
		const { store: instance, tick } = store()
		const created = session(instance)

		tick(5)

		const committed = instance.commit({
			sessionId: created.id,
			expectedRevision: 0,
			state: 'running',
			checkpoint: checkpoint('node-1'),
			events: [
				{ type: 'stateChanged', state: 'running' },
				{ type: 'policyApplied', nodeId: 'node-1', detail: 'retry 1' },
			],
			artifacts: [{ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' }],
		})

		expect(committed.ok).toBeTrue()

		if (!committed.ok) return

		expect(committed.session.revision).toBe(1)
		expect(committed.session.state).toBe('running')
		expect(committed.session.startedAt).toBe(1005)
		expect(committed.session.checkpoint.cursor).toBe('node-1')
		expect(committed.events).toEqual([
			{ type: 'stateChanged', state: 'running', sessionId: created.id, sequence: 1, timestamp: 1005 },
			{ type: 'policyApplied', nodeId: 'node-1', detail: 'retry 1', sessionId: created.id, sequence: 2, timestamp: 1005 },
		])
		expect(instance.events(created.id)).toEqual(committed.events)
		expect(instance.artifacts(created.id)).toEqual([{ logicalSlotId: 'slot-1', attempt: 1, status: 'pending', sessionId: created.id, createdAt: 1005, updatedAt: 1005 }])
	})

	test('anchors the elapsed triggers at the instant the session started running', () => {
		const { store: instance, tick } = store()
		const created = session(instance)

		tick(3_600_000)

		const started = instance.commit({ sessionId: created.id, expectedRevision: 0, state: 'running', checkpoint: checkpoint('node-1') })

		expect(started.ok).toBeTrue()

		if (!started.ok) return

		expect(started.session.startedAt).toBe(3_601_000)
		expect(started.session.checkpoint.anchors.sessionStart).toBe(3_601_000)

		tick(5000)

		const running = instance.commit({ sessionId: created.id, expectedRevision: 1, state: 'running', checkpoint: checkpoint('node-2') })

		expect(running.ok).toBeTrue()

		if (!running.ok) return

		expect(running.session.checkpoint.anchors.sessionStart).toBe(1000)
	})

	test('refuses a stale revision without writing anything', () => {
		const { store: instance } = store()
		const created = session(instance)
		const first = instance.commit({ sessionId: created.id, expectedRevision: 0, state: 'running', events: [{ type: 'stateChanged', state: 'running' }] })
		const stale = instance.commit({ sessionId: created.id, expectedRevision: 0, state: 'paused', events: [{ type: 'stateChanged', state: 'paused' }], artifacts: [{ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' }] })

		expect(first.ok).toBeTrue()
		expect(stale.ok).toBeFalse()

		if (stale.ok) return

		expect(stale.reason).toBe('revisionMismatch')
		expect(stale.session?.revision).toBe(1)
		expect(instance.session(created.id)?.state).toBe('running')
		expect(instance.events(created.id)).toHaveLength(1)
		expect(instance.artifacts(created.id)).toBeEmpty()
	})

	test('refuses a commit for an unknown session', () => {
		const { store: instance } = store()

		expect(instance.commit({ sessionId: 'missing', expectedRevision: 0 })).toEqual({ ok: false, reason: 'unknownSession' })
		expect(instance.events('missing')).toBeEmpty()
		expect(instance.artifacts('missing')).toBeEmpty()
	})

	test('continues the event sequence across commits and reads after a cursor', () => {
		const { store: instance } = store()
		const created = session(instance)

		instance.commit({ sessionId: created.id, expectedRevision: 0, events: [{ type: 'stateChanged', state: 'running' }] })
		instance.commit({
			sessionId: created.id,
			expectedRevision: 1,
			events: [
				{ type: 'triggerFired', nodeId: 'node-1' },
				{ type: 'artifactCommitted', nodeId: 'node-1' },
			],
		})

		expect(instance.events(created.id).map((event) => event.sequence)).toEqual([1, 2, 3])
		expect(instance.events(created.id, 1).map((event) => event.type)).toEqual(['triggerFired', 'artifactCommitted'])
		expect(instance.events(created.id, 3)).toBeEmpty()
		expect(instance.lastEventSequence(created.id)).toBe(3)
	})

	test('reports the last sequence of a session without events and of an unknown one', () => {
		const { store: instance } = store()
		const created = session(instance)

		expect(instance.lastEventSequence(created.id)).toBe(0)
		expect(instance.lastEventSequence('missing')).toBe(0)
	})

	test('stores the checkpoint independently of the value handed in', () => {
		const { store: instance } = store()
		const created = session(instance)
		const working = checkpoint('node-1')

		instance.commit({ sessionId: created.id, expectedRevision: 0, checkpoint: working })

		const mutated = { ...working, attempts: { 'node-1': 2 } }

		expect(instance.session(created.id)?.checkpoint.attempts).toEqual({ 'node-1': 1 })
		expect(mutated.attempts).toEqual({ 'node-1': 2 })
	})

	test('promotes an artifact in place and refuses a second committed one for the same slot', () => {
		const { store: instance, tick } = store()
		const created = session(instance)

		instance.commit({ sessionId: created.id, expectedRevision: 0, artifacts: [{ logicalSlotId: 'slot-1', attempt: 1, status: 'pending' }] })
		tick(10)
		instance.commit({ sessionId: created.id, expectedRevision: 1, artifacts: [{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' }] })

		expect(instance.artifacts(created.id)).toEqual([{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits', sessionId: created.id, createdAt: 1000, updatedAt: 1010 }])

		const conflicted = instance.commit({
			sessionId: created.id,
			expectedRevision: 2,
			events: [{ type: 'artifactCommitted' }],
			artifacts: [{ logicalSlotId: 'slot-1', attempt: 2, status: 'committed', path: '/data/frame-1-retry.fits' }],
		})

		expect(conflicted.ok).toBeFalse()

		if (conflicted.ok) return

		expect(conflicted.reason).toBe('artifactConflict')
		expect(instance.artifacts(created.id)).toHaveLength(1)
		expect(instance.events(created.id)).toBeEmpty()
		expect(instance.session(created.id)?.revision).toBe(2)
	})

	test('keeps a rejected attempt beside the committed recapture', () => {
		const { store: instance } = store()
		const created = session(instance)

		const committed = instance.commit({
			sessionId: created.id,
			expectedRevision: 0,
			artifacts: [
				{ logicalSlotId: 'slot-1', attempt: 1, status: 'rejected' },
				{ logicalSlotId: 'slot-1', attempt: 2, status: 'committed', path: '/data/frame-1.fits' },
			],
		})

		expect(committed.ok).toBeTrue()
		expect(instance.artifacts(created.id).map((artifact) => artifact.status)).toEqual(['rejected', 'committed'])
	})

	test('accepts a recapture that rejects the committed attempt it replaces', () => {
		const { store: instance } = store()
		const created = session(instance)

		instance.commit({ sessionId: created.id, expectedRevision: 0, artifacts: [{ logicalSlotId: 'slot-1', attempt: 1, status: 'committed', path: '/data/frame-1.fits' }] })

		const recaptured = instance.commit({
			sessionId: created.id,
			expectedRevision: 1,
			artifacts: [
				{ logicalSlotId: 'slot-1', attempt: 1, status: 'rejected' },
				{ logicalSlotId: 'slot-1', attempt: 2, status: 'committed', path: '/data/frame-1-retry.fits' },
			],
		})

		expect(recaptured.ok).toBeTrue()
		expect(instance.artifacts(created.id).map((artifact) => artifact.status)).toEqual(['rejected', 'committed'])

		// The slot is filled again, so a third attempt still conflicts.
		expect(instance.commit({ sessionId: created.id, expectedRevision: 2, artifacts: [{ logicalSlotId: 'slot-1', attempt: 3, status: 'committed' }] })).toMatchObject({ ok: false, reason: 'artifactConflict' })
	})

	test('stamps the terminal instant once and records the failure', () => {
		const { store: instance, tick } = store()
		const created = session(instance)

		instance.commit({ sessionId: created.id, expectedRevision: 0, state: 'running' })
		tick(20)
		const failed = instance.commit({ sessionId: created.id, expectedRevision: 1, state: 'failed', failure: { reason: 'commandFailed', detail: 'camera did not respond' } })

		expect(failed.ok).toBeTrue()

		if (!failed.ok) return

		expect(failed.session.endedAt).toBe(1020)
		expect(failed.session.failure).toEqual({ reason: 'commandFailed', detail: 'camera did not respond' })

		tick(20)
		const late = instance.commit({ sessionId: created.id, expectedRevision: 2, events: [{ type: 'stateChanged', state: 'failed' }] })

		expect(late.ok && late.session.endedAt).toBe(1020)
		expect(late.ok && late.session.failure?.reason).toBe('commandFailed')
	})
})

describe('definition storage', () => {
	test('assigns an id to a definition that never was stored and starts it at revision 1', () => {
		const { store: instance } = store()
		const created = instance.createDefinition({ ...canonical(), id: undefined, revision: 99 })

		expect(created).toBeDefined()

		if (created === undefined) return

		expect(created.id).not.toBeEmpty()
		expect(created.revision).toBe(1)
		expect(created.definition.id).toBe(created.id)
		expect(created.definition.revision).toBe(1)
		expect(created.createdAt).toBe(1000)
		expect(created.updatedAt).toBe(1000)
		expect(instance.definition(created.id)).toEqual(created)
		expect(instance.definitions()).toEqual([created])
	})

	test('refuses to create a definition over an id that is already stored', () => {
		const { store: instance } = store()

		expect(instance.createDefinition(canonical())).toBeDefined()
		expect(instance.createDefinition(canonical())).toBeUndefined()
		expect(instance.definitions()).toHaveLength(1)
	})

	test('assigns the next revision on every update and ignores the one the payload carries', () => {
		const { store: instance, tick } = store()

		instance.createDefinition(canonical())
		tick(50)

		const updated = instance.updateDefinition('definition-1', { ...canonical(), name: 'M31', revision: 7 })

		expect(updated?.revision).toBe(2)
		expect(updated?.definition.revision).toBe(2)
		expect(updated?.definition.name).toBe('M31')
		expect(updated?.createdAt).toBe(1000)
		expect(updated?.updatedAt).toBe(1050)
		expect(instance.updateDefinition('definition-2', canonical())).toBeUndefined()
	})

	test('stores an independent copy of the definition', () => {
		const { store: instance } = store()
		const definition = canonical()
		const created = instance.createDefinition(definition)

		expect(created).toBeDefined()

		if (created === undefined) return

		expect(created.definition).not.toBe(definition)
		expect(created.definition.capture.frames).not.toBe(definition.capture.frames)
	})

	test('refuses to remove a definition a non-terminal session executes', () => {
		const { store: instance } = store()

		instance.createDefinition(canonical())

		const created = instance.createSession({ definitionId: 'definition-1', definitionRevision: 1, handlerVersions: {} })

		expect(instance.deleteDefinition('definition-1')).toEqual({ ok: false, reason: 'inUse', sessionId: created.id })

		instance.commit({ sessionId: created.id, expectedRevision: 0, state: 'completed' })

		expect(instance.deleteDefinition('definition-1')).toEqual({ ok: true })
		expect(instance.definition('definition-1')).toBeUndefined()
		expect(instance.deleteDefinition('definition-1')).toEqual({ ok: false, reason: 'unknownDefinition' })
	})
})
