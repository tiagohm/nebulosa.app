import { describe, expect, test } from 'bun:test'
import type { SequencerSafePoint } from 'src/api/sequencer.control'
import { sequencerCancelsActiveAction, sequencerConvergence, sequencerPauseAttended, sequencerResumePoint, sequencerRetainsReservation } from 'src/api/sequencer.control'
import type { SequencerExecution } from '#/sequencer'
import type { SequencerCheckpoint, SequencerSessionState } from '#/sequencer.state'

const SAFE_POINTS: readonly SequencerSafePoint[] = ['afterExposure', 'afterArtifact', 'afterAction', 'beforeFrame']

function execution(pauseMode: SequencerExecution['pauseMode'], stopMode: SequencerExecution['stopMode'] = 'graceful') {
	return { pauseMode, stopMode } as SequencerExecution
}

function checkpoint(overrides?: Partial<SequencerCheckpoint>): SequencerCheckpoint {
	return { containers: [], attempts: {}, completed: [], capture: {}, anchors: { sessionStart: 0, autofocus: { frames: 0 }, dither: { frames: 0 }, driftCheck: { frames: 0 } }, definitionRevision: 1, handlerVersions: {}, ...overrides }
}

describe('pause boundary', () => {
	test('immediate is attended at every safe point', () => {
		expect(SAFE_POINTS.every((it) => sequencerPauseAttended('immediate', it))).toBe(true)
	})

	test('afterCurrentExposure waits for the frame to be durable', () => {
		expect(sequencerPauseAttended('afterCurrentExposure', 'afterExposure')).toBe(false)
		expect(sequencerPauseAttended('afterCurrentExposure', 'afterArtifact')).toBe(true)
		expect(sequencerPauseAttended('afterCurrentExposure', 'afterAction')).toBe(true)
		expect(sequencerPauseAttended('afterCurrentExposure', 'beforeFrame')).toBe(true)
	})

	test('afterCurrentAction waits for the whole safe point', () => {
		expect(sequencerPauseAttended('afterCurrentAction', 'afterExposure')).toBe(false)
		expect(sequencerPauseAttended('afterCurrentAction', 'afterArtifact')).toBe(false)
		expect(sequencerPauseAttended('afterCurrentAction', 'afterAction')).toBe(true)
		expect(sequencerPauseAttended('afterCurrentAction', 'beforeFrame')).toBe(true)
	})

	test('a pause that arrived after its boundary is still attended at the next one', () => {
		expect(sequencerPauseAttended('afterCurrentExposure', 'beforeFrame')).toBe(true)
		expect(sequencerPauseAttended('immediate', 'beforeFrame')).toBe(true)
	})
})

describe('convergence', () => {
	test('a running session takes the next step at every safe point', () => {
		expect(SAFE_POINTS.every((it) => sequencerConvergence('running', execution('immediate'), it) === 'continue')).toBe(true)
	})

	test('a pause holds only at the boundary its mode selects', () => {
		expect(sequencerConvergence('paused', execution('afterCurrentAction'), 'afterArtifact')).toBe('continue')
		expect(sequencerConvergence('paused', execution('afterCurrentAction'), 'afterAction')).toBe('pause')
	})

	test('a stop is attended at every safe point under both modes', () => {
		for (const mode of ['graceful', 'immediate'] as const) {
			expect(SAFE_POINTS.every((it) => sequencerConvergence('stopped', execution('afterCurrentAction', mode), it) === 'stop')).toBe(true)
		}
	})
})

describe('cancellation', () => {
	test('only the immediate modes cancel the running action', () => {
		expect(sequencerCancelsActiveAction('paused', execution('immediate'))).toBe(true)
		expect(sequencerCancelsActiveAction('paused', execution('afterCurrentExposure'))).toBe(false)
		expect(sequencerCancelsActiveAction('paused', execution('afterCurrentAction'))).toBe(false)
		expect(sequencerCancelsActiveAction('stopped', execution('afterCurrentAction', 'immediate'))).toBe(true)
		expect(sequencerCancelsActiveAction('stopped', execution('afterCurrentAction', 'graceful'))).toBe(false)
	})

	test('a graceful stop lets an immediate pause mode finish the exposure it was in', () => {
		expect(sequencerCancelsActiveAction('stopped', execution('immediate', 'graceful'))).toBe(false)
	})

	test('a running session cancels nothing', () => {
		expect(sequencerCancelsActiveAction('running', execution('immediate', 'immediate'))).toBe(false)
	})
})

describe('reservation', () => {
	test('is retained in every non-terminal state', () => {
		const retained: readonly SequencerSessionState[] = ['created', 'running', 'paused', 'finalizing', 'waitingResources', 'suspended', 'recovering', 'interrupted']

		expect(retained.every(sequencerRetainsReservation)).toBe(true)
	})

	test('is released with the terminal state', () => {
		const released: readonly SequencerSessionState[] = ['completed', 'stopped', 'failed']

		expect(released.some(sequencerRetainsReservation)).toBe(false)
	})
})

describe('resume point', () => {
	test('starts at the plan when nothing had started', () => {
		expect(sequencerResumePoint(checkpoint())).toEqual({ at: 'plan' })
	})

	test('re-enters the node the cursor holds on the attempt it was interrupted on', () => {
		const state = checkpoint({ cursor: 'target:capture:loop:frame', containers: ['root', 'target:capture:loop'], attempts: { 'target:capture:loop:frame': 2 } })

		expect(sequencerResumePoint(state)).toEqual({ at: 'node', nodeId: 'target:capture:loop:frame', containers: ['root', 'target:capture:loop'], attempt: 2 })
	})

	test('re-enters a node that never consumed an attempt at zero', () => {
		expect(sequencerResumePoint(checkpoint({ cursor: 'startup:cool' }))).toMatchObject({ at: 'node', attempt: 0 })
	})

	test('continues past a cursor that had already settled', () => {
		const state = checkpoint({ cursor: 'startup:unpark', containers: ['root', 'startup'], completed: ['startup:unpark'], attempts: { 'startup:unpark': 1 } })

		expect(sequencerResumePoint(state)).toEqual({ at: 'nextNode', nodeId: 'startup:unpark', containers: ['root', 'startup'] })
	})

	test('reads only the checkpoint, so a resume after a restart takes the same path', () => {
		const state = checkpoint({ cursor: 'a', containers: ['root'], attempts: { a: 1 } })

		expect(sequencerResumePoint(state)).toEqual(sequencerResumePoint(structuredClone(state)))
	})
})
