import { describe, expect, test } from 'bun:test'
import { abandonSlot, acceptFrame, advanceCaptureCycle, attemptsSpent, attemptWindowExhausted, grantAttemptWindow, SEQUENCER_INITIAL_CAPTURE_PROGRESS } from 'src/api/sequencer.progress'
import { captureCycleCompleted, frameGroupCompleted, frameGroupDegraded, frameScheduler, groupProgressOf, SEQUENCER_INITIAL_GROUP_PROGRESS, targetProgressOf } from 'src/api/sequencer.scheduler'
import type { SequencerCameraCapture } from '#/sequencer'
import type { SequencerPlanFrameGroup, SequencerPlanLoop, SequencerPlanSequence } from '#/sequencer.plan'
import type { SequencerCaptureProgress } from '#/sequencer.state'
import { camera, retry } from './sequencer.fixture'

function group(id: string, group?: Partial<SequencerPlanFrameGroup>, capture?: Partial<SequencerCameraCapture>): SequencerPlanFrameGroup {
	const count = group?.count ?? 3
	const requiredSlots = group?.requiredSlots ?? count
	const abandonmentBudget = group?.abandonmentBudget ?? 0

	return {
		id,
		nodeId: `target:m42/frame:${id}`,
		count,
		delay: 0,
		weight: 1,
		capture: camera(capture),
		retry: retry(),
		requiredSlots,
		abandonmentBudget,
		slotLimit: requiredSlots + abandonmentBudget,
		projectedIntegration: requiredSlots * 60,
		...group,
	}
}

function loop(groups: readonly SequencerPlanFrameGroup[]): SequencerPlanLoop {
	const body: SequencerPlanSequence = { kind: 'sequence', id: 'target:m42/cycle', children: [] }
	return { kind: 'loop', id: 'target:m42/capture', repeat: 3, order: 'sequential', groups, body }
}

function counters(progress: SequencerCaptureProgress, groupId: string) {
	return groupProgressOf(targetProgressOf(progress, 'm42'), groupId)
}

describe('capture progress', () => {
	test('an accepted frame closes the slot and moves every counter that decides completion', () => {
		const lum = group('lum', { count: 2 })
		const progress = acceptFrame(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)

		expect(counters(progress, 'lum')).toEqual({ cursor: 1, accepted: 1, captured: 1, rejected: 0, abandoned: 0, integration: 60, attemptWindowStart: 0 })
		expect(counters(acceptFrame(progress, 'm42', lum), 'lum')).toEqual({ cursor: 2, accepted: 2, captured: 2, rejected: 0, abandoned: 0, integration: 120, attemptWindowStart: 0 })
	})

	test('an abandoned slot counts as rejected and never as accepted', () => {
		const lum = group('lum', { count: 2, abandonmentBudget: 1 })
		const progress = abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)

		expect(counters(progress, 'lum')).toEqual({ cursor: 1, accepted: 0, captured: 0, rejected: 1, abandoned: 1, integration: 0, attemptWindowStart: 0 })
		expect(frameGroupCompleted(lum, counters(progress, 'lum'))).toBeFalse()
	})

	test('a group reaching its target with an abandoned slot inside the budget concludes normally', () => {
		const lum = group('lum', { count: 2, abandonmentBudget: 1 })
		let progress = abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)
		progress = acceptFrame(acceptFrame(progress, 'm42', lum), 'm42', lum)

		expect(counters(progress, 'lum').cursor).toBe(3)
		expect(frameGroupCompleted(lum, counters(progress, 'lum'))).toBeTrue()
		expect(frameGroupDegraded(lum, counters(progress, 'lum'))).toBeFalse()
	})

	test('a group losing every slot of its limit concludes degraded', () => {
		const lum = group('lum', { count: 1, abandonmentBudget: 1 })
		const progress = abandonSlot(abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum), 'm42', lum)

		expect(counters(progress, 'lum')).toEqual({ cursor: 2, accepted: 0, captured: 0, rejected: 2, abandoned: 2, integration: 0, attemptWindowStart: 0 })
		expect(frameGroupDegraded(lum, counters(progress, 'lum'))).toBeTrue()
	})

	test('the counters restart with the cycle and the scheduler starts the ordinals over', () => {
		const lum = group('lum', { count: 1 })
		const scheduler = frameScheduler(loop([lum]))
		const first = acceptFrame(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)

		expect(captureCycleCompleted([lum], targetProgressOf(first, 'm42'))).toBeTrue()

		const second = advanceCaptureCycle(first, 'm42')

		expect(targetProgressOf(second, 'm42')).toEqual({ cycle: 1, groups: {} })
		expect(counters(second, 'lum')).toEqual(SEQUENCER_INITIAL_GROUP_PROGRESS)
		expect(scheduler.next(second, { targetId: 'm42', instant: 0 })).toEqual({ group: lum, cycle: 1, ordinal: 0 })
	})

	test('three cycles of a group of ten frames produce ten accepted frames each', () => {
		const lum = group('lum', { count: 10 })
		let progress = SEQUENCER_INITIAL_CAPTURE_PROGRESS
		let exposures = 0

		for (let cycle = 0; cycle < 3; cycle++) {
			while (!frameGroupCompleted(lum, counters(progress, 'lum'))) {
				progress = acceptFrame(progress, 'm42', lum)
				exposures++
			}

			expect(counters(progress, 'lum').accepted).toBe(10)
			progress = advanceCaptureCycle(progress, 'm42')
		}

		expect(exposures).toBe(30)
		expect(targetProgressOf(progress, 'm42').cycle).toBe(3)
	})

	test('the integration accumulates only the exposure of accepted frames', () => {
		const lum = group('lum', { count: 3, requiredSlots: 3, abandonmentBudget: 1 })
		let progress = abandonSlot(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)

		for (let i = 0; i < 3; i++) progress = acceptFrame(progress, 'm42', lum)

		expect(counters(progress, 'lum').integration).toBe(180)
		expect(frameGroupCompleted(lum, counters(progress, 'lum'))).toBeTrue()
	})

	test('converts an accepted exposure into seconds before integrating it', () => {
		const lum = group('lum', { count: 2 }, { exposureTime: 60000, exposureTimeUnit: 'millisecond' })
		const progress = acceptFrame(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)

		expect(counters(progress, 'lum').integration).toBe(60)
	})
})

describe('attempt window', () => {
	test('counts the attempts of the current window and exhausts at the retry budget', () => {
		const lum = group('lum', { count: 1, retry: { ...retry(), maxAttempts: 3 } })
		const fresh = SEQUENCER_INITIAL_GROUP_PROGRESS

		expect(attemptsSpent(fresh, 0)).toBe(1)
		expect(attemptWindowExhausted(lum, fresh, 0)).toBeFalse()
		expect(attemptWindowExhausted(lum, fresh, 1)).toBeFalse()
		expect(attemptWindowExhausted(lum, fresh, 2)).toBeTrue()
	})

	test('a granted window restarts the spent attempts while the physical attempt keeps growing', () => {
		const lum = group('lum', { count: 1, retry: { ...retry(), maxAttempts: 3 } })
		const progress = grantAttemptWindow(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', 'lum', 3)

		expect(counters(progress, 'lum').attemptWindowStart).toBe(3)
		expect(attemptsSpent(counters(progress, 'lum'), 3)).toBe(1)
		expect(attemptWindowExhausted(lum, counters(progress, 'lum'), 4)).toBeFalse()
		expect(attemptWindowExhausted(lum, counters(progress, 'lum'), 5)).toBeTrue()
		expect(counters(progress, 'lum').cursor).toBe(0)
	})

	test('a closed slot opens the next one on a fresh window', () => {
		const lum = group('lum', { count: 2 })
		const progress = acceptFrame(grantAttemptWindow(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', 'lum', 4), 'm42', lum)

		expect(counters(progress, 'lum').attemptWindowStart).toBe(0)
		expect(counters(abandonSlot(progress, 'm42', lum), 'lum').attemptWindowStart).toBe(0)
	})
})

describe('progress immutability', () => {
	test('every transition returns a new progress and leaves the previous one untouched', () => {
		const lum = group('lum', { count: 2 })
		const first = acceptFrame(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum)
		const snapshot = structuredClone(first)

		abandonSlot(first, 'm42', lum)
		advanceCaptureCycle(first, 'm42')
		grantAttemptWindow(first, 'm42', 'lum', 7)

		expect(first).toEqual(snapshot)
		expect(SEQUENCER_INITIAL_CAPTURE_PROGRESS).toEqual({})
	})

	test('a target keeps the progress of the other targets of the session', () => {
		const lum = group('lum', { count: 2 })
		const progress = acceptFrame(acceptFrame(SEQUENCER_INITIAL_CAPTURE_PROGRESS, 'm42', lum), 'm31', lum)

		expect(targetProgressOf(progress, 'm42').groups.lum?.accepted).toBe(1)
		expect(targetProgressOf(progress, 'm31').groups.lum?.accepted).toBe(1)
		expect(targetProgressOf(advanceCaptureCycle(progress, 'm31'), 'm42').groups.lum?.accepted).toBe(1)
	})
})
