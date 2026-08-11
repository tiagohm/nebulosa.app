import { describe, expect, test } from 'bun:test'
import { sequencerCommittedArtifact, sequencerCommittedSlot, sequencerPendingArtifact, sequencerPendingArtifacts, sequencerReconciledArtifact, sequencerRejectedArtifact, sequencerTerminalArtifacts } from 'src/api/sequencer.artifact'
import { sequencerSlotAttempt } from 'src/api/sequencer.identity'
import { InMemorySequencerStore } from 'src/api/sequencer.store'
import type { SequencerArtifact, SequencerArtifactDraft, SequencerSessionState } from '#/sequencer.state'

function artifact(logicalSlotId: string, attempt: number, status: SequencerArtifact['status'], path?: string): SequencerArtifact {
	return { logicalSlotId, attempt, status, path, sessionId: 'session-1', createdAt: 1000, updatedAt: 1000 }
}

function stored(drafts: readonly SequencerArtifactDraft[], state?: SequencerSessionState) {
	const instance = new InMemorySequencerStore(() => 1000)
	const session = instance.createSession({ definitionId: 'definition-1', definitionRevision: 1, handlerVersions: {} })
	let revision = 0

	for (const draft of drafts) {
		const result = instance.commit({ sessionId: session.id, expectedRevision: revision, artifacts: [draft] })
		expect(result.ok).toBeTrue()
		revision++
	}

	if (state !== undefined) {
		const artifacts = sequencerTerminalArtifacts(instance.artifacts(session.id))
		expect(instance.commit({ sessionId: session.id, expectedRevision: revision, state, artifacts }).ok).toBeTrue()
	}

	return instance.artifacts(session.id)
}

describe('artifact drafts', () => {
	test('registers an attempt before its exposure and confirms it with its path', () => {
		expect(sequencerPendingArtifact('node-1#lum#0#0', 0)).toEqual({ logicalSlotId: 'node-1#lum#0#0', attempt: 0, status: 'pending' })
		expect(sequencerCommittedArtifact('node-1#lum#0#0', 0, '/data/m42-lum-0.fit')).toEqual({ logicalSlotId: 'node-1#lum#0#0', attempt: 0, status: 'committed', path: '/data/m42-lum-0.fit' })
		expect(sequencerRejectedArtifact('node-1#lum#0#0', 0)).toEqual({ logicalSlotId: 'node-1#lum#0#0', attempt: 0, status: 'rejected' })
	})

	test('carries no path on a rejected attempt', () => {
		expect(sequencerRejectedArtifact('node-1#lum#0#0', 1).path).toBeUndefined()
	})
})

describe('registry reads', () => {
	test('answers the committed artifact of a slot and nothing for a slot still owing one', () => {
		const artifacts = [artifact('slot-a', 0, 'rejected'), artifact('slot-a', 1, 'committed', '/data/a.fit'), artifact('slot-b', 0, 'pending')]

		expect(sequencerCommittedSlot(artifacts, 'slot-a')?.attempt).toBe(1)
		expect(sequencerCommittedSlot(artifacts, 'slot-a')?.path).toBe('/data/a.fit')
		expect(sequencerCommittedSlot(artifacts, 'slot-b')).toBeUndefined()
		expect(sequencerCommittedSlot(artifacts, 'slot-c')).toBeUndefined()
		expect(sequencerCommittedSlot([], 'slot-a')).toBeUndefined()
	})

	test('lists the attempts that were registered and never closed', () => {
		const artifacts = [artifact('slot-a', 0, 'committed', '/data/a.fit'), artifact('slot-b', 0, 'pending'), artifact('slot-c', 0, 'rejected'), artifact('slot-d', 2, 'pending')]

		expect(sequencerPendingArtifacts(artifacts).map((entry) => entry.logicalSlotId)).toEqual(['slot-b', 'slot-d'])
		expect(sequencerPendingArtifacts([])).toBeEmpty()
	})
})

describe('terminal resolution', () => {
	test('keeps a confirmed artifact confirmed in every terminal state', () => {
		const durable = sequencerCommittedArtifact('slot-a', 0, '/data/a.fit')

		for (const state of ['completed', 'stopped', 'failed'] as const) {
			const artifacts = stored([durable], state)

			expect(artifacts).toHaveLength(1)
			expect(artifacts[0]).toMatchObject({ logicalSlotId: 'slot-a', attempt: 0, status: 'committed', path: '/data/a.fit' })
		}
	})

	test('closes every open attempt when the session ends', () => {
		const artifacts = stored([sequencerCommittedArtifact('slot-a', 0, '/data/a.fit'), sequencerPendingArtifact('slot-b', 0), sequencerPendingArtifact('slot-c', 3)], 'failed')

		expect(artifacts.map((entry) => [entry.logicalSlotId, entry.status, entry.attempt])).toEqual([
			['slot-a', 'committed', 0],
			['slot-b', 'rejected', 0],
			['slot-c', 'rejected', 3],
		])
	})

	test('frees the slot of a closed attempt so the recapture is the next one', () => {
		const artifacts = stored([sequencerPendingArtifact('slot-b', 0)], 'stopped')

		expect(sequencerSlotAttempt(artifacts, 'slot-b')).toBe(1)
	})

	test('resolves nothing when no attempt is open', () => {
		expect(sequencerTerminalArtifacts([artifact('slot-a', 0, 'committed', '/data/a.fit'), artifact('slot-b', 0, 'rejected')])).toBeEmpty()
		expect(sequencerTerminalArtifacts([])).toBeEmpty()
	})
})

describe('reconciliation of an open attempt', () => {
	test('confirms an attempt whose frame survived the crash', () => {
		expect(sequencerReconciledArtifact('validFinal', 'slot-a', 0, '/data/a.fit')).toEqual({ logicalSlotId: 'slot-a', attempt: 0, status: 'committed', path: '/data/a.fit' })
	})

	test('closes an attempt whose file the classification removed', () => {
		expect(sequencerReconciledArtifact('invalidFinal', 'slot-a', 0, '/data/a.fit')).toEqual({ logicalSlotId: 'slot-a', attempt: 0, status: 'rejected' })
		expect(sequencerReconciledArtifact('orphanTemporary', 'slot-a', 0, '/data/a.fit')).toEqual({ logicalSlotId: 'slot-a', attempt: 0, status: 'rejected' })
	})

	test('leaves the open attempt open when nothing was written', () => {
		expect(sequencerReconciledArtifact('missing', 'slot-a', 0, '/data/a.fit')).toBeUndefined()
		expect(sequencerSlotAttempt([artifact('slot-a', 0, 'pending')], 'slot-a')).toBe(0)
	})

	test('repeats the same attempt after a missing frame and advances it after a removed one', () => {
		const open = artifact('slot-a', 0, 'pending')
		const reconciled = sequencerReconciledArtifact('invalidFinal', 'slot-a', open.attempt, '/data/a.fit')

		expect(sequencerSlotAttempt(stored([open, reconciled!]), 'slot-a')).toBe(1)
	})
})
