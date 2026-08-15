import { describe, expect, test } from 'bun:test'
import { SEQUENCER_INITIAL_CADENCE_ANCHORS, sequencerCadenceBoundary, sequencerExposureEnded, waitForCadenceBoundary } from 'src/api/sequencer.cadence'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'

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
		expect(sequencerCadenceBoundary(SEQUENCER_INITIAL_CADENCE_ANCHORS, 30)).toBe(0)
	})

	test('spaces the next exposure from the end of the previous one', () => {
		expect(sequencerCadenceBoundary(sequencerExposureEnded(1_000_000), 30)).toBe(1_030_000)
	})

	test('anchors the spacing on the end of the exposure and nothing else', () => {
		expect(sequencerExposureEnded(1_000_000)).toEqual({ exposureEndedAt: 1_000_000 })
	})

	test('spaces nothing when the declared delay is zero', () => {
		expect(sequencerCadenceBoundary(sequencerExposureEnded(1_000_000), 0)).toBe(0)
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
