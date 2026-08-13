import { describe, expect, test } from 'bun:test'
import type { SequencerIntent, SequencerIntentKind } from 'src/api/sequencer.intent'
import { reduceSequencerIntents, SequencerIntentQueue } from 'src/api/sequencer.intent'

const KINDS: readonly SequencerIntentKind[] = ['pause', 'resume', 'stop', 'resourceLost', 'resourceRestored', 'actionCompleted', 'actionFailed', 'retryTimer']

function intent(kind: SequencerIntentKind, sequence: number, overrides?: Partial<SequencerIntent>): SequencerIntent {
	return { kind, sequence, at: 1_000 + sequence, ...overrides }
}

describe('queue', () => {
	test('accepts every command and stamps arrival order', () => {
		const queue = new SequencerIntentQueue()

		const first = queue.submit('pause', 10)
		const second = queue.submit('stop', 20, { detail: 'operator' })

		expect(first).toMatchObject({ kind: 'pause', sequence: 1, at: 10 })
		expect(second).toMatchObject({ kind: 'stop', sequence: 2, at: 20, detail: 'operator' })
		expect(queue.size).toBe(2)
		expect(queue.pending).toHaveLength(2)
	})

	test('accepts every command in a terminal session', () => {
		const queue = new SequencerIntentQueue()

		for (const kind of KINDS) queue.submit(kind, 1)

		const reduction = queue.drain('completed', 'running')

		expect(reduction.outcomes).toHaveLength(KINDS.length)
		expect(reduction.outcomes.every((o) => o.effect === 'none' && o.noop === 'terminal')).toBe(true)
		expect(reduction.desiredState).toBe('running')
		expect(queue.size).toBe(0)
	})

	test('drains before reducing so a command queued during the fold survives', () => {
		const queue = new SequencerIntentQueue()

		queue.submit('pause', 1)
		queue.drain('running', 'running')
		queue.submit('resume', 2)

		expect(queue.size).toBe(1)
		expect(queue.drain('paused', 'paused').outcomes[0]).toMatchObject({ effect: 'resume' })
	})

	test('keeps the arrival sequence increasing across drains', () => {
		const queue = new SequencerIntentQueue()

		queue.submit('pause', 1)
		queue.drain('running', 'running')

		expect(queue.submit('stop', 2).sequence).toBe(2)
	})
})

describe('operator commands', () => {
	test('pause converges to paused and a second one is a no-op', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('pause', 1), intent('pause', 2)])

		expect(reduction.outcomes[0]).toMatchObject({ effect: 'pause' })
		expect(reduction.outcomes[1]).toMatchObject({ effect: 'none', noop: 'alreadyPaused' })
		expect(reduction.desiredState).toBe('paused')
	})

	test('resume converges back to running', () => {
		const reduction = reduceSequencerIntents('paused', 'paused', [intent('resume', 1)])

		expect(reduction.outcomes[0]).toMatchObject({ effect: 'resume' })
		expect(reduction.desiredState).toBe('running')
	})

	test('resume at a session nobody paused is a no-op', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('resume', 1)])

		expect(reduction.outcomes[0]).toMatchObject({ effect: 'none', noop: 'notPaused' })
		expect(reduction.desiredState).toBe('running')
	})

	test('stop absorbs everything queued after it', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('stop', 1), intent('pause', 2), intent('resume', 3), intent('stop', 4), intent('actionCompleted', 5)])

		expect(reduction.outcomes.map((o) => o.effect)).toEqual(['stop', 'none', 'none', 'none', 'none'])
		expect(reduction.outcomes.slice(1).every((o) => o.noop === 'stopping')).toBe(true)
		expect(reduction.desiredState).toBe('stopped')
	})

	test('reduces concurrent pause and resume by arrival order', () => {
		const pauseThenResume = reduceSequencerIntents('running', 'running', [intent('pause', 1), intent('resume', 2)])
		const resumeThenPause = reduceSequencerIntents('running', 'running', [intent('resume', 1), intent('pause', 2)])

		expect(pauseThenResume.desiredState).toBe('running')
		expect(pauseThenResume.outcomes.map((o) => o.effect)).toEqual(['pause', 'resume'])
		expect(resumeThenPause.desiredState).toBe('paused')
		expect(resumeThenPause.outcomes.map((o) => o.effect)).toEqual(['none', 'pause'])
	})

	test('pause of a session that never started still converges', () => {
		expect(reduceSequencerIntents('created', 'running', [intent('pause', 1)])).toMatchObject({ desiredState: 'paused' })
	})
})

describe('no-op states', () => {
	test('a stop during finalization is recorded rather than refused', () => {
		const reduction = reduceSequencerIntents('finalizing', 'running', [intent('stop', 1, { detail: 'operator' })])

		expect(reduction.outcomes[0]).toMatchObject({ effect: 'none', noop: 'finalizing' })
		expect(reduction.outcomes[0].intent.detail).toBe('operator')
		expect(reduction.desiredState).toBe('running')
	})

	test('a terminal session tells its no-op apart from a finalizing one', () => {
		expect(reduceSequencerIntents('failed', 'stopped', [intent('resume', 1)]).outcomes[0].noop).toBe('terminal')
		expect(reduceSequencerIntents('stopped', 'stopped', [intent('resume', 1)]).outcomes[0].noop).toBe('terminal')
		expect(reduceSequencerIntents('finalizing', 'stopped', [intent('resume', 1)]).outcomes[0].noop).toBe('finalizing')
	})

	test('a restored resource does nothing because nothing waits for one', () => {
		expect(reduceSequencerIntents('running', 'running', [intent('resourceRestored', 1)]).outcomes[0]).toMatchObject({ effect: 'none', noop: 'nothingWaiting' })
	})
})

describe('runtime commands', () => {
	test('a lost resource fails the session with the cause that took it', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('resourceLost', 1, { reason: 'disconnected', detail: 'camera' })])

		expect(reduction.outcomes[0]).toMatchObject({ effect: 'fail' })
		expect(reduction.failure).toEqual({ reason: 'disconnected', detail: 'camera' })
		expect(reduction.desiredState).toBe('stopped')
	})

	test('keeps the first failure when several resources are lost at once', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('resourceLost', 1, { reason: 'disconnected', detail: 'camera' }), intent('resourceLost', 2, { reason: 'removed', detail: 'mount' })])

		expect(reduction.failure).toEqual({ reason: 'disconnected', detail: 'camera' })
		expect(reduction.outcomes[1]).toMatchObject({ effect: 'none', noop: 'stopping' })
	})

	test('settled work and elapsed retry timers only advance the plan', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('actionCompleted', 1), intent('actionFailed', 2, { reason: 'timeout' }), intent('retryTimer', 3)])

		expect(reduction.outcomes.every((o) => o.effect === 'advance')).toBe(true)
		expect(reduction.desiredState).toBe('running')
		expect(reduction.failure).toBeUndefined()
	})

	test('an action that settles while a pause is pending keeps the pause', () => {
		const reduction = reduceSequencerIntents('running', 'running', [intent('pause', 1), intent('actionCompleted', 2)])

		expect(reduction.outcomes[1]).toMatchObject({ effect: 'advance' })
		expect(reduction.desiredState).toBe('paused')
	})
})
