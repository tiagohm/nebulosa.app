import { describe, expect, test } from 'bun:test'
import type { SequencerPolicyFailure } from 'src/api/sequencer.policy'
import { sequencerFailurePolicy } from 'src/api/sequencer.policy'
import type { SequencerRetryPolicy } from '#/sequencer'

function retry(overrides?: Partial<SequencerRetryPolicy>): SequencerRetryPolicy {
	return { maxAttempts: 3, delay: 2, backoff: 2, maximumDelay: 30, retryOn: ['timeout'], onExhausted: 'fail', ...overrides }
}

function failure(overrides?: Partial<SequencerPolicyFailure>): SequencerPolicyFailure {
	return { reason: 'timeout', attempt: 1, retry: retry(), ...overrides }
}

describe('retry', () => {
	test('retries a declared reason while the budget holds', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 1 }))).toEqual({ kind: 'retry', attempt: 2, delay: 2000 })
		expect(sequencerFailurePolicy(failure({ attempt: 2 }))).toEqual({ kind: 'retry', attempt: 3, delay: 4000 })
	})

	test('takes the terminal decision when the last attempt fails', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 3 }))).toEqual({ kind: 'fail', reason: 'timeout', detail: undefined })
	})

	test('maxAttempts of one disables retries', () => {
		expect(sequencerFailurePolicy(failure({ retry: retry({ maxAttempts: 1, onExhausted: 'skip' }) }))).toEqual({ kind: 'skip' })
	})

	test('obeys retryOn literally instead of a default table', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'busy', retry: retry({ retryOn: ['timeout'], onExhausted: 'stop' }) }))).toEqual({ kind: 'stop' })
		expect(sequencerFailurePolicy(failure({ reason: 'busy', retry: retry({ retryOn: ['busy'] }) }))).toMatchObject({ kind: 'retry' })
	})

	test('an empty retryOn retries nothing', () => {
		expect(sequencerFailurePolicy(failure({ retry: retry({ retryOn: [], onExhausted: 'pause' }) }))).toEqual({ kind: 'pause' })
	})

	test('caps the growing delay at the declared maximum', () => {
		const policy = retry({ maxAttempts: 10, delay: 5, backoff: 3, maximumDelay: 20 })

		expect(sequencerFailurePolicy(failure({ attempt: 1, retry: policy }))).toMatchObject({ delay: 5000 })
		expect(sequencerFailurePolicy(failure({ attempt: 2, retry: policy }))).toMatchObject({ delay: 15000 })
		expect(sequencerFailurePolicy(failure({ attempt: 3, retry: policy }))).toMatchObject({ delay: 20000 })
		expect(sequencerFailurePolicy(failure({ attempt: 9, retry: policy }))).toMatchObject({ delay: 20000 })
	})

	test('a backoff of one spaces every attempt equally', () => {
		const policy = retry({ maxAttempts: 5, delay: 7, backoff: 1 })

		expect(sequencerFailurePolicy(failure({ attempt: 4, retry: policy }))).toMatchObject({ delay: 7000 })
	})

	test('a zero delay retries without waiting', () => {
		expect(sequencerFailurePolicy(failure({ retry: retry({ delay: 0 }) }))).toMatchObject({ kind: 'retry', delay: 0 })
	})
})

describe('terminal decision', () => {
	test('onFailure decides wherever both it and onExhausted exist', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 3, onFailure: 'continue', retry: retry({ onExhausted: 'fail' }) }))).toEqual({ kind: 'continue', guiding: true })
		expect(sequencerFailurePolicy(failure({ attempt: 3, onFailure: 'stop', retry: retry({ onExhausted: 'skip' }) }))).toEqual({ kind: 'stop' })
	})

	test('onExhausted decides where the feature declares no onFailure', () => {
		for (const onExhausted of ['skip', 'pause', 'stop', 'fail'] as const) {
			expect(sequencerFailurePolicy(failure({ attempt: 3, retry: retry({ onExhausted }) })).kind).toBe(onExhausted)
		}
	})

	test('continueUnguided continues without guiding', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 3, onFailure: 'continueUnguided' }))).toEqual({ kind: 'continue', guiding: false })
	})

	test('onFailure does not shorten the attempt budget', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 1, onFailure: 'continue' }))).toMatchObject({ kind: 'retry', attempt: 2 })
	})

	test('a suspend that reached the runtime fails instead of pausing', () => {
		expect(sequencerFailurePolicy(failure({ attempt: 3, onFailure: 'suspend', detail: 'wheel' }))).toEqual({ kind: 'fail', reason: 'timeout', detail: 'wheel' })
	})

	test('carries the cause and the diagnostic of the failing operation forward', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'commandFailed', attempt: 3, detail: 'slew refused' }))).toEqual({ kind: 'fail', reason: 'commandFailed', detail: 'slew refused' })
	})
})

describe('aborted', () => {
	test('a commanded abort is an intentional shutdown', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'aborted', commanded: true }))).toEqual({ kind: 'stop' })
	})

	test('an abort with no matching command is a failure', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'aborted' }))).toEqual({ kind: 'fail', reason: 'aborted', detail: undefined })
	})

	test('preserves the cause of an uncommanded cancellation', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'aborted', abortedBy: 'disconnected', detail: 'camera' }))).toEqual({ kind: 'fail', reason: 'disconnected', detail: 'camera' })
	})

	test('is never retried, whatever the policy declares', () => {
		const policy = retry({ retryOn: ['aborted', 'timeout'], maxAttempts: 5 })

		expect(sequencerFailurePolicy(failure({ reason: 'aborted', retry: policy }))).toMatchObject({ kind: 'fail' })
		expect(sequencerFailurePolicy(failure({ reason: 'aborted', commanded: true, retry: policy }))).toEqual({ kind: 'stop' })
	})

	test('an uncommanded abort ignores the terminal decision of the action', () => {
		expect(sequencerFailurePolicy(failure({ reason: 'aborted', onFailure: 'continue', retry: retry({ onExhausted: 'skip' }) }))).toMatchObject({ kind: 'fail' })
	})
})
