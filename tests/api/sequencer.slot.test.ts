import { describe, expect, test } from 'bun:test'
import { abandonSlot, grantAttemptWindow, SEQUENCER_INITIAL_CAPTURE_PROGRESS } from 'src/api/sequencer.progress'
import { groupProgressOf, targetProgressOf } from 'src/api/sequencer.scheduler'
import type { SequencerSlotFailure } from 'src/api/sequencer.slot'
import { sequencerDegradedCause, sequencerGroupOutcome, sequencerSlotFailure } from 'src/api/sequencer.slot'
import type { SequencerRetryPolicy } from '#/sequencer'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { SequencerCaptureProgress } from '#/sequencer.state'
import { camera, retry } from './sequencer.fixture'

function group(overrides?: Partial<SequencerPlanFrameGroup>, retryOverrides?: Partial<SequencerRetryPolicy>): SequencerPlanFrameGroup {
	const count = overrides?.count ?? 3
	const requiredSlots = overrides?.requiredSlots ?? count
	const abandonmentBudget = overrides?.abandonmentBudget ?? 0

	return {
		id: 'lum',
		name: 'lum',
		nodeId: 'target:m42/frame:lum',
		frameType: 'LIGHT',
		exposureTime: 60,
		count,
		integrationTime: 0,
		delay: 0,
		weight: 1,
		camera: camera(),
		retry: { ...retry(), ...retryOverrides },
		requiredSlots,
		abandonmentBudget,
		slotLimit: requiredSlots + abandonmentBudget,
		projectedIntegration: requiredSlots * 60,
		...overrides,
	}
}

function failure(overrides?: Partial<SequencerSlotFailure>): SequencerSlotFailure {
	return { reason: 'timeout', targetId: 'm42', group: group(), progress: SEQUENCER_INITIAL_CAPTURE_PROGRESS, attempt: 0, ...overrides }
}

function counters(progress: SequencerCaptureProgress) {
	return groupProgressOf(targetProgressOf(progress, 'm42'), 'lum')
}

describe('slot attempts', () => {
	test('retries within the window and names the next physical attempt', () => {
		expect(sequencerSlotFailure(failure({ attempt: 0 }))).toEqual({ kind: 'retry', attempt: 1, delay: 5000 })
		expect(sequencerSlotFailure(failure({ attempt: 1 }))).toEqual({ kind: 'retry', attempt: 2, delay: 10000 })
	})

	test('abandons the slot when the window is exhausted and the policy gives up', () => {
		const lum = group({ abandonmentBudget: 1 }, { onExhausted: 'skip' })
		const decision = sequencerSlotFailure(failure({ group: lum, attempt: 2, detail: 'shutter' }))

		expect(decision).toMatchObject({ kind: 'abandon', cause: { reason: 'timeout', detail: 'shutter' } })
		expect(decision.kind === 'abandon' && counters(decision.progress)).toEqual({ cursor: 1, accepted: 0, captured: 0, rejected: 1, abandoned: 1, integration: 0, attemptWindowStart: 0 })
	})

	test('holds the slot on the cursor when the policy pauses', () => {
		const lum = group(undefined, { onExhausted: 'pause' })

		expect(sequencerSlotFailure(failure({ group: lum, attempt: 2, detail: 'cooler' }))).toEqual({ kind: 'hold', cause: { reason: 'timeout', detail: 'cooler' }, exhausted: true })
	})

	test('an abort commanded by a pause holds the slot without spending its window', () => {
		expect(sequencerSlotFailure(failure({ reason: 'aborted', commandedBy: 'paused', detail: 'operator' }))).toEqual({ kind: 'hold', cause: { reason: 'aborted', detail: 'operator' }, exhausted: false })
	})

	test('preserves the device reason when the policy fails', () => {
		expect(sequencerSlotFailure(failure({ reason: 'commandFailed', attempt: 2, detail: 'exposure refused' }))).toEqual({ kind: 'fail', reason: 'commandFailed', detail: 'exposure refused' })
	})

	test('a commanded abort stops instead of consuming the slot', () => {
		expect(sequencerSlotFailure(failure({ reason: 'aborted', commandedBy: 'stopped' }))).toEqual({ kind: 'stop' })
	})

	test('an abort with no matching command fails with the cause of the cancellation', () => {
		expect(sequencerSlotFailure(failure({ reason: 'aborted', abortedBy: 'disconnected', detail: 'camera' }))).toEqual({ kind: 'fail', reason: 'disconnected', detail: 'camera' })
	})

	test('counts attempts within the window of the slot and not the physical ones', () => {
		const progress = grantAttemptWindow(abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', group()), 'm42', 'lum', 7)

		expect(counters(progress).attemptWindowStart).toBe(7)
		expect(sequencerSlotFailure(failure({ progress, attempt: 7 }))).toEqual({ kind: 'retry', attempt: 8, delay: 5000 })
		expect(sequencerSlotFailure(failure({ progress, attempt: 9 }))).toMatchObject({ kind: 'fail' })
	})

	test('a resume after an exhaustion pause gives a fresh window without moving the cursor or the slot limit', () => {
		const lum = group(undefined, { onExhausted: 'pause' })
		const held = grantAttemptWindow(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', 'lum', 4)

		expect(sequencerSlotFailure(failure({ group: lum, progress: held, attempt: 4 }))).toMatchObject({ kind: 'retry', attempt: 5 })
		expect(counters(held).cursor).toBe(0)
		expect(lum.slotLimit).toBe(3)
	})
})

describe('group outcome', () => {
	test('a group still filling slots is capturing', () => {
		const lum = group({ count: 2, abandonmentBudget: 1 })

		expect(sequencerGroupOutcome(lum, abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum), 'm42')).toBe('capturing')
	})

	test('a group reaching its target within the abandonment budget completes normally', () => {
		const lum = group({ count: 1, abandonmentBudget: 1 })
		const progress = { m42: { cycle: 0, groups: { lum: { cursor: 2, accepted: 1, captured: 1, rejected: 1, abandoned: 1, integration: 60, attemptWindowStart: 0 } } } }

		expect(sequencerGroupOutcome(lum, progress, 'm42')).toBe('completed')
	})

	test('a group that spent every slot without reaching its target is degraded', () => {
		const lum = group({ count: 1, abandonmentBudget: 1 })
		let progress = abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)
		progress = abandonSlot(progress, 'm42', lum)

		expect(sequencerGroupOutcome(lum, progress, 'm42')).toBe('degraded')
	})

	test('an integration target reached by the accepted frames completes', () => {
		const lum = group({ count: 0, integrationTime: 120, requiredSlots: 2 })
		const progress = { m42: { cycle: 0, groups: { lum: { cursor: 2, accepted: 2, captured: 2, rejected: 0, abandoned: 0, integration: 120, attemptWindowStart: 0 } } } }

		expect(sequencerGroupOutcome(lum, progress, 'm42')).toBe('completed')
	})
})

describe('degraded cause', () => {
	test('reports the cause of the attempts that consumed the slots', () => {
		expect(sequencerDegradedCause({ reason: 'commandFailed', detail: 'exposure refused' })).toEqual({ reason: 'commandFailed', detail: 'exposure refused' })
	})

	test('reports unknown when nothing recorded why the slots were lost', () => {
		expect(sequencerDegradedCause()).toEqual({ reason: 'unknown' })
	})
})
