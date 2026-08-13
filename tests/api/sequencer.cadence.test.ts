import { describe, expect, test } from 'bun:test'
import { SEQUENCER_INITIAL_CADENCE_ANCHORS, sequencerCadenceBoundary, sequencerExposureEnded, sequencerSettleAnchored, waitForCadenceBoundary } from 'src/api/sequencer.cadence'
import type { SequencerCadenceSpacing } from 'src/api/sequencer.cadence'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'

function spacing(overrides?: Partial<SequencerCadenceSpacing>): SequencerCadenceSpacing {
	return { delay: 30, settle: 10, ...overrides }
}

function actionContext(now: () => number, signal = new AbortController().signal): SequencerActionContext {
	return {
		sessionId: 'session-1',
		nodeId: 'target:m42/frame:lum',
		attempt: 1,
		scope: {} as SequencerActionContext['scope'],
		signal,
		now,
		request: () => undefined,
		progress: () => {},
		artifact: () => {},
		auxiliary: () => undefined,
		checkpoint: { containers: [], attempts: {}, completed: [], capture: {}, anchors: sequencerInitialTriggerAnchors(1_000_000), definitionRevision: 1, handlerVersions: {} },
	}
}

describe('cadence boundary', () => {
	test('leaves the first exposure of a session unspaced', () => {
		expect(sequencerCadenceBoundary(SEQUENCER_INITIAL_CADENCE_ANCHORS, spacing())).toBe(0)
	})

	test('spaces the next exposure from the end of the previous one', () => {
		expect(sequencerCadenceBoundary(sequencerExposureEnded(1_000_000), spacing())).toBe(1_030_000)
	})

	test('takes the later of the two spacings instead of adding them', () => {
		const anchors = sequencerSettleAnchored(sequencerExposureEnded(1_000_000), 1_005_000)

		expect(sequencerCadenceBoundary(anchors, spacing())).toBe(1_030_000)
		expect(sequencerCadenceBoundary(anchors, spacing({ settle: 60 }))).toBe(1_065_000)
	})

	test('keeps the spacing of the previous exposure across a movement', () => {
		const anchors = sequencerSettleAnchored(sequencerExposureEnded(1_000_000), 1_001_000)

		expect(anchors).toEqual({ exposureEndedAt: 1_000_000, settleAnchoredAt: 1_001_000 })
	})

	test('retires the initial settle once a frame was exposed against it', () => {
		const moved = sequencerSettleAnchored(SEQUENCER_INITIAL_CADENCE_ANCHORS, 1_000_000)
		const exposed = sequencerExposureEnded(1_100_000)

		expect(sequencerCadenceBoundary(moved, spacing())).toBe(1_010_000)
		expect(exposed.settleAnchoredAt).toBeUndefined()
		expect(sequencerCadenceBoundary(exposed, spacing({ delay: 0 }))).toBe(0)
	})

	test('settles the first exposure after a slew with no previous frame', () => {
		const anchors = sequencerSettleAnchored(SEQUENCER_INITIAL_CADENCE_ANCHORS, 1_000_000)

		expect(sequencerCadenceBoundary(anchors, spacing())).toBe(1_010_000)
	})

	test('spaces nothing when both durations are zero', () => {
		const anchors = sequencerSettleAnchored(sequencerExposureEnded(1_000_000), 1_005_000)

		expect(sequencerCadenceBoundary(anchors, spacing({ delay: 0, settle: 0 }))).toBe(0)
	})
})

describe('cadence wait', () => {
	test('waits nothing when the safe point already absorbed the spacing', async () => {
		const result = await waitForCadenceBoundary(
			actionContext(() => 1_030_001),
			1_030_000,
		)

		expect(result).toEqual({ type: 'completed', value: 0 })
	})

	test('waits nothing at all when no anchor spaces the exposure', async () => {
		const result = await waitForCadenceBoundary(
			actionContext(() => 1_000_000),
			0,
		)

		expect(result).toEqual({ type: 'completed', value: 0 })
	})

	test('reports the seconds it actually held the exposure back', async () => {
		let now = 1_000_000
		const result = await waitForCadenceBoundary(
			actionContext(() => (now += 250)),
			1_000_500,
		)

		expect(result).toEqual({ type: 'completed', value: 0.5 })
	})

	test('does not release the exposure when the timer fires early', async () => {
		const reads: number[] = []
		let now = 1_000_000
		const context = actionContext(() => {
			reads.push(now)
			now += 5
			return now
		})

		const result = await waitForCadenceBoundary(context, 1_000_020)

		expect(result).toMatchObject({ type: 'completed' })
		expect(reads.length).toBeGreaterThan(2)
	})

	test('reports a cancelled wait as the abort it is', async () => {
		const controller = new AbortController()
		const context = actionContext(() => 1_000_000, controller.signal)

		setTimeout(() => controller.abort(), 5)

		const result = await waitForCadenceBoundary(context, 1_060_000)

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})
})
