import { describe, expect, test } from 'bun:test'
import { SequencerCheckpointKeeper, sequencerCheckpointDue } from 'src/api/sequencer.checkpoint'
import { sequencerResumePoint } from 'src/api/sequencer.control'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'
import type { SequencerCheckpoint as SequencerCheckpointPolicy } from '#/sequencer'
import type { SequencerCheckpoint, SequencerGroupProgress } from '#/sequencer.state'

function policy(overrides?: Partial<SequencerCheckpointPolicy>): SequencerCheckpointPolicy {
	return { afterEveryAction: true, afterEveryFrame: true, afterEveryArtifact: true, interval: 60, ...overrides }
}

function checkpoint(overrides?: Partial<SequencerCheckpoint>): SequencerCheckpoint {
	return { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1000), definitionRevision: 3, handlerVersions: { wait: 1 }, ...overrides }
}

function group(accepted: number): SequencerGroupProgress {
	return { cursor: accepted, accepted, captured: accepted, rejected: 0, abandoned: 0, integration: accepted * 120, attemptWindowStart: 0 }
}

function keeper(overrides?: Partial<SequencerCheckpoint>) {
	return new SequencerCheckpointKeeper(checkpoint(overrides), 1000)
}

describe('write cadence', () => {
	test('a transition and an artifact are written whatever the policy declares', () => {
		const disabled = policy({ afterEveryAction: false, afterEveryFrame: false, afterEveryArtifact: false, interval: 0 })

		expect(sequencerCheckpointDue(disabled, 'transition', 0)).toBeTrue()
		expect(sequencerCheckpointDue(disabled, 'artifact', 0)).toBeTrue()
	})

	test('follows the declared cadence for actions and frames', () => {
		expect(sequencerCheckpointDue(policy(), 'action', 0)).toBeTrue()
		expect(sequencerCheckpointDue(policy(), 'frame', 0)).toBeTrue()
		expect(sequencerCheckpointDue(policy({ afterEveryAction: false }), 'action', 0)).toBeFalse()
		expect(sequencerCheckpointDue(policy({ afterEveryFrame: false }), 'frame', 0)).toBeFalse()
	})

	test('writes once the interval elapsed even when the cadence declined', () => {
		const sparse = policy({ afterEveryAction: false, afterEveryFrame: false, interval: 30 })

		expect(sequencerCheckpointDue(sparse, 'action', 29_999)).toBeFalse()
		expect(sequencerCheckpointDue(sparse, 'action', 30_000)).toBeTrue()
		expect(sequencerCheckpointDue(sparse, 'interval', 45_000)).toBeTrue()
	})

	test('a zero interval disables interval based writes', () => {
		expect(sequencerCheckpointDue(policy({ interval: 0 }), 'interval', 3_600_000)).toBeFalse()
	})

	test('a cadence that declines everything suppresses every cadence write and nothing else', () => {
		const off = policy({ afterEveryAction: false, afterEveryFrame: false, interval: 0 })

		expect(sequencerCheckpointDue(off, 'action', 0)).toBeFalse()
		expect(sequencerCheckpointDue(off, 'frame', 0)).toBeFalse()
		expect(sequencerCheckpointDue(off, 'interval', 3_600_000)).toBeFalse()
		expect(sequencerCheckpointDue(off, 'transition', 0)).toBeTrue()
	})
})

describe('checkpoint kept in memory', () => {
	test('is up to date before anything is written', () => {
		const keep = keeper()

		keep.enter('wait-1', ['root'])
		keep.attempt('wait-1', 2)

		expect(keep.checkpoint.cursor).toBe('wait-1')
		expect(keep.checkpoint.containers).toEqual(['root'])
		expect(keep.checkpoint.attempts).toEqual({ 'wait-1': 2 })
		expect(keep.writtenAt).toBe(1000)
	})

	test('the cadence never decides what the runtime keeps', () => {
		const keep = keeper()

		keep.capture({ 'target-1': { cycle: 2, groups: {} } })

		expect(keep.due(policy({ afterEveryFrame: false }), 'frame', 4000)).toBeFalse()
		expect(keep.checkpoint.capture['target-1']?.cycle).toBe(2)
	})

	test('replaces the value instead of editing the committed one', () => {
		const keep = keeper()
		const before = keep.checkpoint

		keep.complete('wait-1')

		expect(before.completed).toEqual([])
		expect(keep.checkpoint.completed).toEqual(['wait-1'])
	})

	test('completing the same node twice changes nothing', () => {
		const keep = keeper({ completed: ['wait-1'] })

		keep.complete('wait-1')

		expect(keep.checkpoint.completed).toEqual(['wait-1'])
		expect(keep.dirty).toBeFalse()
	})

	test('reopens the body of a loop starting another pass', () => {
		const keep = keeper({ cursor: 'capture-1', completed: ['startup-1', 'prepare-1', 'capture-1'], attempts: { 'prepare-1': 1, 'capture-1': 3 } })

		keep.reenter(['prepare-1', 'capture-1'])

		expect(keep.checkpoint.completed).toEqual(['startup-1'])
		expect(keep.checkpoint.attempts).toEqual({})
		expect(sequencerResumePoint(keep.checkpoint)).toEqual({ at: 'node', nodeId: 'capture-1', containers: [], attempt: 0 })
	})

	test('reopening nodes that were never settled changes nothing', () => {
		const keep = keeper({ completed: ['startup-1'] })

		keep.reenter(['prepare-1'])

		expect(keep.dirty).toBeFalse()
	})

	test('clears the cursor after the last node', () => {
		const keep = keeper({ cursor: 'wait-1' })

		keep.leave()

		expect(keep.checkpoint.cursor).toBeUndefined()
	})

	test('holds the session anchors and the per target progress together', () => {
		const keep = keeper()
		const anchors = { ...sequencerInitialTriggerAnchors(1000), targetStart: 4000, dither: { at: 4000, frames: 3 } }

		keep.anchors(anchors)
		keep.capture({ 'target-1': { cycle: 1, groups: { luminance: group(3) } } })

		expect(keep.checkpoint.anchors.dither).toEqual({ at: 4000, frames: 3 })
		expect(keep.checkpoint.anchors.targetStart).toBe(4000)
		expect(keep.checkpoint.capture['target-1']?.groups.luminance).toEqual(group(3))
	})
})

describe('dirty tracking', () => {
	test('an unchanged checkpoint is never due', () => {
		const keep = keeper()

		expect(keep.dirty).toBeFalse()
		expect(keep.due(policy(), 'transition', 5000)).toBeFalse()
	})

	test('becomes due after a change and stops being due once written', () => {
		const keep = keeper()

		keep.attempt('wait-1', 1)

		expect(keep.due(policy(), 'action', 2000)).toBeTrue()

		keep.written(2000)

		expect(keep.dirty).toBeFalse()
		expect(keep.writtenAt).toBe(2000)
		expect(keep.due(policy(), 'action', 3000)).toBeFalse()
	})

	test('measures the interval from the last write', () => {
		const keep = keeper()
		const sparse = policy({ afterEveryAction: false, afterEveryFrame: false, interval: 30 })

		keep.attempt('wait-1', 1)
		keep.written(2000)
		keep.attempt('wait-1', 2)

		expect(keep.due(sparse, 'action', 31_000)).toBeFalse()
		expect(keep.due(sparse, 'action', 32_000)).toBeTrue()
	})

	test('a change that never reached the store stays pending for the next write', () => {
		const keep = keeper()

		keep.attempt('wait-1', 1)
		keep.complete('wait-1')

		expect(keep.dirty).toBeTrue()
		expect(keep.due(policy(), 'frame', 3000)).toBeTrue()
	})
})

describe('atomic commit unit', () => {
	test('the checkpoint reaches the store together with the artifact row', () => {
		const store = new InMemorySequencerStore(() => 5000)
		const created = store.createSession({ definitionId: 'definition-1', definitionRevision: 3, handlerVersions: { wait: 1 } })
		const keep = new SequencerCheckpointKeeper(created.checkpoint, created.createdAt)

		keep.capture({ 'target-1': { cycle: 1, groups: { luminance: group(1) } } })

		expect(keep.due(policy(), 'artifact', 5000)).toBeTrue()

		const result = store.commit({
			sessionId: created.id,
			expectedRevision: created.revision,
			checkpoint: keep.checkpoint,
			artifacts: [{ logicalSlotId: 'target-1:luminance:0', attempt: 0, status: 'committed', path: '/data/frame-1.fits' }],
			events: [{ type: 'artifactCommitted', nodeId: 'capture-1' }],
		})

		expect(result.ok).toBeTrue()
		keep.written(5000)

		const stored = store.session(created.id)

		expect(stored?.revision).toBe(1)
		expect(stored?.checkpoint.capture['target-1']?.groups.luminance).toEqual(group(1))
		expect(store.artifacts(created.id)).toHaveLength(1)
	})

	test('a refused commit leaves the checkpoint dirty and nothing stored', () => {
		const store = new InMemorySequencerStore(() => 5000)
		const created = store.createSession({ definitionId: 'definition-1', definitionRevision: 3, handlerVersions: { wait: 1 } })
		const keep = new SequencerCheckpointKeeper(created.checkpoint, created.createdAt)

		keep.capture({ 'target-1': { cycle: 1, groups: { luminance: group(1) } } })

		const result = store.commit({
			sessionId: created.id,
			expectedRevision: created.revision + 1,
			checkpoint: keep.checkpoint,
			artifacts: [{ logicalSlotId: 'target-1:luminance:0', attempt: 0, status: 'committed', path: '/data/frame-1.fits' }],
		})

		expect(result.ok).toBeFalse()
		expect(keep.dirty).toBeTrue()
		expect(store.session(created.id)?.checkpoint.capture).toEqual({})
		expect(store.artifacts(created.id)).toBeEmpty()
	})

	test('the committed value does not follow the keeper afterwards', () => {
		const store = new InMemorySequencerStore(() => 5000)
		const created = store.createSession({ definitionId: 'definition-1', definitionRevision: 3, handlerVersions: { wait: 1 } })
		const keep = new SequencerCheckpointKeeper(created.checkpoint, created.createdAt)

		keep.capture({ 'target-1': { cycle: 1, groups: { luminance: group(1) } } })
		store.commit({ sessionId: created.id, expectedRevision: created.revision, checkpoint: keep.checkpoint })
		keep.written(5000)
		keep.capture({ 'target-1': { cycle: 1, groups: { luminance: group(2) } } })

		expect(store.session(created.id)?.checkpoint.capture['target-1']?.groups.luminance).toEqual(group(1))
	})
})
