import { describe, expect, test } from 'bun:test'
import { captureCycleCompleted, frameGroupCompleted, frameGroupDegraded, frameGroupReachedTarget, frameScheduler, groupProgressOf, SEQUENCER_INITIAL_GROUP_PROGRESS, SEQUENCER_INITIAL_TARGET_PROGRESS, targetProgressOf } from 'src/api/sequencer.scheduler'
import type { FrameSchedulingContext } from 'src/api/sequencer.scheduler'
import type { SequencerPlanFrameGroup, SequencerPlanLoop, SequencerPlanSequence } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerGroupProgress } from '#/sequencer.state'
import { camera, retry } from './sequencer.fixture'

function group(id: string, overrides?: Partial<SequencerPlanFrameGroup>): SequencerPlanFrameGroup {
	const count = overrides?.count ?? 3
	const requiredSlots = overrides?.requiredSlots ?? count
	const abandonmentBudget = overrides?.abandonmentBudget ?? 0

	return {
		id,
		name: id,
		nodeId: `target:m42/frame:${id}`,
		frameType: 'LIGHT',
		exposureTime: 60,
		count,
		integrationTime: 0,
		delay: 0,
		weight: 1,
		camera: camera(),
		retry: retry(),
		requiredSlots,
		abandonmentBudget,
		slotLimit: requiredSlots + abandonmentBudget,
		projectedIntegration: requiredSlots * 60,
		...overrides,
	}
}

function loop(groups: readonly SequencerPlanFrameGroup[], order: SequencerPlanLoop['order'] = 'sequential'): SequencerPlanLoop {
	const body: SequencerPlanSequence = { kind: 'sequence', id: 'target:m42/cycle', children: [] }
	return { kind: 'loop', id: 'target:m42/capture', repeat: 2, order, groups, body }
}

function context(overrides?: Partial<FrameSchedulingContext>): FrameSchedulingContext {
	return { targetId: 'm42', instant: 1_700_000_000_000, ...overrides }
}

function progress(groups: Record<string, Partial<SequencerGroupProgress>>, cycle = 0): SequencerCaptureProgress {
	const entries = Object.entries(groups).map(([id, counters]) => [id, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, ...counters }] as const)
	return { m42: { cycle, groups: Object.fromEntries(entries) } }
}

describe('progress lookup', () => {
	test('reads an identifier that names a member of the prototype as untouched', () => {
		for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
			expect(targetProgressOf({}, id)).toBe(SEQUENCER_INITIAL_TARGET_PROGRESS)
			expect(groupProgressOf(targetProgressOf({}, id), id)).toBe(SEQUENCER_INITIAL_GROUP_PROGRESS)
		}
	})

	test('still reads the entry a target of such a name recorded', () => {
		const state = { constructor: { cycle: 2, groups: { toString: { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 1 } } } }

		expect(targetProgressOf(state, 'constructor').cycle).toBe(2)
		expect(groupProgressOf(targetProgressOf(state, 'constructor'), 'toString').accepted).toBe(1)
	})
})

describe('frame group completion', () => {
	test('concludes on the frame count', () => {
		const lum = group('lum', { count: 3, integrationTime: 0 })

		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 3, accepted: 2 })).toBeFalse()
		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 3, accepted: 3 })).toBeTrue()
	})

	test('concludes on the integration time', () => {
		const lum = group('lum', { count: 0, integrationTime: 180, requiredSlots: 3 })

		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 2, integration: 120 })).toBeFalse()
		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 3, integration: 180 })).toBeTrue()
	})

	test('concludes on whichever criterion is reached first', () => {
		const lum = group('lum', { count: 10, integrationTime: 120, requiredSlots: 2 })

		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 2, integration: 120 })).toBeTrue()
		expect(frameGroupReachedTarget(group('lum', { count: 2, integrationTime: 600, requiredSlots: 2 }), { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 2, integration: 120 })).toBeTrue()
	})

	test('ignores the criterion configured with zero', () => {
		const byCount = group('lum', { count: 2, integrationTime: 0 })
		const byIntegration = group('lum', { count: 0, integrationTime: 120, requiredSlots: 2 })

		expect(frameGroupReachedTarget(byCount, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 2, integration: 0 })).toBeTrue()
		expect(frameGroupReachedTarget(byIntegration, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, accepted: 99, integration: 60 })).toBeFalse()
	})

	test('concludes on an integration target the accumulated sum only reaches within rounding error', () => {
		const lum = group('lum', { count: 0, exposureTime: 0.3, integrationTime: 3, requiredSlots: 10 })
		let integration = 0

		for (let i = 0; i < 10; i++) integration += lum.exposureTime

		expect(integration).not.toBe(3)
		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 10, accepted: 10, captured: 10, integration })).toBeTrue()
		expect(frameGroupDegraded(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 10, accepted: 10, captured: 10, integration })).toBeFalse()
		expect(frameGroupReachedTarget(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 9, accepted: 9, captured: 9, integration: integration - lum.exposureTime })).toBeFalse()
	})

	test('never forgives a whole exposure of a long target of short frames', () => {
		const lucky = group('lucky', { count: 0, exposureTime: 0.0004, integrationTime: 1_000_000, requiredSlots: 2_500_000_000 })

		expect(frameGroupReachedTarget(lucky, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, integration: 999_999.9992 })).toBeFalse()
		expect(frameGroupReachedTarget(lucky, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, integration: 1_000_000 - lucky.exposureTime })).toBeFalse()
		expect(frameGroupReachedTarget(lucky, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, integration: 1_000_000 - lucky.exposureTime * 0.25 })).toBeTrue()
	})

	test('concludes degraded when the cursor reaches the slot limit without the target', () => {
		const lum = group('lum', { count: 3, abandonmentBudget: 1 })
		const exhausted: SequencerGroupProgress = { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 4, accepted: 1, rejected: 3, abandoned: 3 }

		expect(frameGroupDegraded(lum, exhausted)).toBeTrue()
		expect(frameGroupCompleted(lum, exhausted)).toBeTrue()
		expect(frameGroupDegraded(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 4, accepted: 3, abandoned: 1 })).toBeFalse()
	})

	test('spends no slot beyond the required ones when nothing is abandoned', () => {
		const lum = group('lum', { count: 3 })

		expect(lum.slotLimit).toBe(3)
		expect(frameGroupCompleted(lum, { ...SEQUENCER_INITIAL_GROUP_PROGRESS, cursor: 3, accepted: 3 })).toBeTrue()
	})
})

describe('sequential frame scheduler', () => {
	test('fills the first group before starting the next one', () => {
		const [lum, red] = [group('lum', { count: 2 }), group('red', { count: 2 })]
		const scheduler = frameScheduler(loop([lum, red]))

		expect(scheduler.next({}, context())).toEqual({ group: lum, cycle: 0, ordinal: 0 })
		expect(scheduler.next(progress({ lum: { cursor: 1, accepted: 1, captured: 1, integration: 60 } }), context())).toEqual({ group: lum, cycle: 0, ordinal: 1 })
		expect(scheduler.next(progress({ lum: { cursor: 2, accepted: 2, captured: 2, integration: 120 } }), context())).toEqual({ group: red, cycle: 0, ordinal: 0 })
	})

	test('returns nothing when every scheduled group of the cycle concluded', () => {
		const [lum, red] = [group('lum', { count: 1 }), group('red', { count: 1 })]
		const scheduler = frameScheduler(loop([lum, red]))
		const done = progress({ lum: { cursor: 1, accepted: 1, captured: 1, integration: 60 }, red: { cursor: 1, accepted: 1, captured: 1, integration: 60 } })

		expect(scheduler.next(done, context())).toBeUndefined()
		expect(captureCycleCompleted([lum, red], targetProgressOf(done, 'm42'))).toBeTrue()
	})

	test('reports the cycle the progress is in and restarts the ordinals with the counters', () => {
		const lum = group('lum', { count: 2 })
		const scheduler = frameScheduler(loop([lum]))

		expect(scheduler.next(progress({}, 1), context())).toEqual({ group: lum, cycle: 1, ordinal: 0 })
	})

	test('skips a group that already reached the slot limit and keeps scheduling the others', () => {
		const [lum, red] = [group('lum', { count: 2 }), group('red', { count: 2 })]
		const scheduler = frameScheduler(loop([lum, red]))
		const degraded = progress({ lum: { cursor: 2, rejected: 2, abandoned: 2 } })

		expect(scheduler.next(degraded, context())).toEqual({ group: red, cycle: 0, ordinal: 0 })
		expect(captureCycleCompleted([lum, red], targetProgressOf(degraded, 'm42'))).toBeFalse()
	})

	test('is a pure function of the progress and the context', () => {
		const scheduler = frameScheduler(loop([group('lum', { count: 2 })]))
		const state = progress({ lum: { cursor: 1, accepted: 1, captured: 1, integration: 60 } })
		const snapshot = structuredClone(state)

		const first = scheduler.next(state, context({ instant: 1, sensorTemperature: -10, filter: 'L' }))
		const second = scheduler.next(state, context({ instant: 999, sensorTemperature: 20, filter: 'R' }))

		expect(first).toEqual(second)
		expect(state).toEqual(snapshot)
	})

	test('reads the progress of the target the context names', () => {
		const lum = group('lum', { count: 2 })
		const scheduler = frameScheduler(loop([lum]))
		const state = progress({ lum: { cursor: 1, accepted: 1, captured: 1, integration: 60 } })

		expect(scheduler.next(state, context({ targetId: 'm31' }))).toEqual({ group: lum, cycle: 0, ordinal: 0 })
		expect(groupProgressOf(targetProgressOf(state, 'm31'), 'lum')).toEqual(SEQUENCER_INITIAL_GROUP_PROGRESS)
	})

	test('refuses an order it does not implement instead of capturing in another one', () => {
		expect(() => frameScheduler(loop([group('lum')], 'roundRobin'))).toThrow('unsupported capture order: roundRobin')
	})
})
