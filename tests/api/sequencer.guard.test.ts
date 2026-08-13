import { describe, expect, test } from 'bun:test'
import { SIDEREAL_DAYSEC, TAU } from 'nebulosa/src/core/constants'
import type { Angle } from 'nebulosa/src/math/units/angle'
import { sequencerFlipWindowDelay, sequencerPreExposureGuard, waitForFlipWindow } from 'src/api/sequencer.guard'
import type { SequencerFlipBoundary, SequencerGuardObservation } from 'src/api/sequencer.guard'
import type { SequencerActionContext } from 'src/api/sequencer.registry'
import { sequencerInitialTriggerAnchors } from 'src/api/sequencer.trigger'

const RATE = TAU / SIDEREAL_DAYSEC

function hourAngleOf(seconds: number): Angle {
	return seconds * RATE
}

function boundary(overrides?: Partial<SequencerFlipBoundary>): SequencerFlipBoundary {
	return { minimumHourAngle: hourAngleOf(120), maximumHourAngle: hourAngleOf(-60), safetyMargin: 30, ...overrides }
}

function observation(overrides?: Partial<SequencerGuardObservation>): SequencerGuardObservation {
	return { hourAngle: hourAngleOf(-600), exposureTime: 300, now: 1_000_000, startsAt: 1_000_000, flipPending: true, ...overrides }
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

describe('pre-exposure guard', () => {
	test('admits an exposure that ends before the boundary with its margin', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation())

		expect(decision.type).toBe('allowed')
		expect(decision.projectedHourAngle).toBeCloseTo(hourAngleOf(-270), 12)
	})

	test('refuses an exposure that would cross the boundary', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(-200) }))

		expect(decision).toMatchObject({ type: 'refused' })
		expect(decision.projectedHourAngle).toBeCloseTo(hourAngleOf(130), 12)
	})

	test('counts the margin as part of what has to fit', () => {
		const observed = observation({ hourAngle: hourAngleOf(-380) })

		expect(sequencerPreExposureGuard(boundary({ safetyMargin: 10 }), observed).type).toBe('allowed')
		expect(sequencerPreExposureGuard(boundary({ safetyMargin: 20 }), observed).type).toBe('allowed')
		expect(sequencerPreExposureGuard(boundary({ safetyMargin: 21 }), observed).type).toBe('refused')
	})

	test('projects from the cadence boundary instead of from the decision', () => {
		const observed = observation({ hourAngle: hourAngleOf(-420), startsAt: 1_060_000 })

		expect(sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(-420) })).type).toBe('allowed')
		expect(sequencerPreExposureGuard(boundary(), observed).type).toBe('refused')
		expect(sequencerPreExposureGuard(boundary(), observed).projectedHourAngle).toBeCloseTo(hourAngleOf(-30), 12)
	})

	test('ignores a cadence boundary that has already passed', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation({ startsAt: 900_000 }))

		expect(decision.projectedHourAngle).toBeCloseTo(hourAngleOf(-270), 12)
	})

	test('reports how long the flip window takes to open', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(-30) }))

		expect(decision).toMatchObject({ type: 'refused' })
		expect(decision.type === 'refused' && decision.wait).toBeCloseTo(150, 9)
	})

	test('admits every exposure once the flip is no longer pending', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(300), flipPending: false }))

		expect(decision.type).toBe('allowed')
		expect(decision.projectedHourAngle).toBeCloseTo(hourAngleOf(630), 12)
		expect(sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(300) })).type).toBe('refused')
	})

	test('reports no wait for a refusal made inside an already open window', () => {
		const decision = sequencerPreExposureGuard(boundary(), observation({ hourAngle: hourAngleOf(300) }))

		expect(decision).toMatchObject({ type: 'refused', wait: 0 })
		expect(sequencerFlipWindowDelay(boundary(), hourAngleOf(120))).toBe(0)
	})
})

describe('flip window wait', () => {
	test('returns at once when the mount is already inside the window', async () => {
		let clock = 1_000_000
		const result = await waitForFlipWindow(
			actionContext(() => (clock += 1000)),
			boundary(),
			() => hourAngleOf(180),
		)

		expect(result).toMatchObject({ type: 'completed' })
	})

	test('ends the wait on the hour angle the mount reports rather than on elapsed time', async () => {
		let reads = 0
		const result = await waitForFlipWindow(
			actionContext(() => 1_000_000),
			boundary({ minimumHourAngle: hourAngleOf(0.02) }),
			() => hourAngleOf(++reads > 2 ? 1 : 0),
		)

		expect(result).toMatchObject({ type: 'completed', value: 0 })
		expect(reads).toBe(3)
	})

	test('stops waiting for a mount that publishes no hour angle', async () => {
		const result = await waitForFlipWindow(
			actionContext(() => 1_000_000),
			boundary(),
			() => undefined,
		)

		expect(result).toEqual({ type: 'completed', value: 0 })
	})

	test('reports a cancelled wait as the abort it is', async () => {
		const controller = new AbortController()
		const context = actionContext(() => 1_000_000, controller.signal)

		setTimeout(() => controller.abort(), 5)

		const result = await waitForFlipWindow(context, boundary(), () => hourAngleOf(0))

		expect(result).toMatchObject({ type: 'fatalFailure', reason: 'aborted' })
	})
})
