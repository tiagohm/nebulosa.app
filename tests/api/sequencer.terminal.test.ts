import { describe, expect, test } from 'bun:test'
import type { SequencerPipelineReport, SequencerPipelineResult } from 'src/api/sequencer.pipeline'
import type { SequencerPrimaryOutcome } from 'src/api/sequencer.terminal'
import { sequencerFinalizeRuns, sequencerStartupOutcome, sequencerTerminalOutcome } from 'src/api/sequencer.terminal'
import type { SequencerPlanFinalize } from '#/sequencer.plan'

function result(nodeId: string, outcome: SequencerPipelineResult['outcome'], overrides?: Partial<SequencerPipelineResult>): SequencerPipelineResult {
	return { nodeId, type: 'sequencer.lifecycle.parkMount', required: false, outcome, attempts: outcome === 'notRun' ? 0 : 1, ...overrides }
}

function report(results: readonly SequencerPipelineResult[], overrides?: Partial<SequencerPipelineReport>): SequencerPipelineReport {
	const failed = results.find((result) => result.required && result.outcome === 'failed')
	const failure = failed === undefined ? undefined : { nodeId: failed.nodeId, reason: failed.reason ?? 'unknown', detail: failed.detail }

	return { results, failure, stopped: false, ...overrides }
}

function finalize(overrides?: Partial<SequencerPlanFinalize>): SequencerPlanFinalize {
	return { continueOnFailure: true, runOn: ['completed', 'stopped', 'failed'], ...overrides }
}

describe('finalize selection', () => {
	test('runs for the states the definition selected', () => {
		const pipeline = finalize({ runOn: ['completed'] })

		expect(sequencerFinalizeRuns(pipeline, { kind: 'completed' })).toBeTrue()
		expect(sequencerFinalizeRuns(pipeline, { kind: 'stopped' })).toBeFalse()
		expect(sequencerFinalizeRuns(pipeline, { kind: 'failed', reason: 'timeout' })).toBeFalse()
	})

	test('a plan without a terminal pipeline never runs one', () => {
		expect(sequencerFinalizeRuns(undefined, { kind: 'completed' })).toBeFalse()
	})

	test('selects from the outcome of the plan and not from the state the session ends in', () => {
		const pipeline = finalize({ runOn: ['completed'] })
		const primary: SequencerPrimaryOutcome = { kind: 'completed' }
		const terminal = sequencerTerminalOutcome(primary, report([result('park', 'failed', { required: true, reason: 'timeout' })]))

		expect(sequencerFinalizeRuns(pipeline, primary)).toBeTrue()
		expect(terminal.state).toBe('failed')
	})
})

describe('startup outcome', () => {
	test('lets the capture block run when nothing required failed', () => {
		expect(sequencerStartupOutcome(report([result('cool', 'succeeded'), result('unpark', 'failed')]))).toBeUndefined()
	})

	test('a required failure becomes the outcome of the session with its original cause', () => {
		const startup = report([result('unpark', 'failed', { required: true, reason: 'commandFailed', detail: 'unpark refused' })])

		expect(sequencerStartupOutcome(startup)).toEqual({ kind: 'failed', reason: 'commandFailed', detail: 'unpark refused' })
	})

	test('a commanded stop during startup stops the session', () => {
		expect(sequencerStartupOutcome(report([result('cool', 'notRun')], { stopped: true }))).toEqual({ kind: 'stopped' })
	})

	test('a required action that never ran is detected instead of assumed impossible', () => {
		const startup = report([result('park', 'notRun', { required: true })])

		expect(sequencerStartupOutcome(startup)).toMatchObject({ kind: 'failed', reason: 'unexpectedState' })
	})
})

describe('terminal composition', () => {
	test('a clean plan with a clean finalization keeps its state', () => {
		expect(sequencerTerminalOutcome({ kind: 'completed' }, report([result('park', 'succeeded')]))).toEqual({ state: 'completed', issues: [] })
		expect(sequencerTerminalOutcome({ kind: 'stopped' }, report([result('park', 'skipped')]))).toEqual({ state: 'stopped', issues: [] })
	})

	test('a session without a terminal pipeline composes from the plan alone', () => {
		expect(sequencerTerminalOutcome({ kind: 'completed' })).toEqual({ state: 'completed', issues: [] })
	})

	test('a required finalize failure turns a completed session into a failed one', () => {
		const terminal = sequencerTerminalOutcome({ kind: 'completed' }, report([result('park', 'failed', { required: true, reason: 'alert', detail: 'park' })]))

		expect(terminal.state).toBe('failed')
		expect(terminal.failure).toEqual({ reason: 'alert', detail: 'park' })
	})

	test('a required finalize failure also converts a stopped session', () => {
		expect(sequencerTerminalOutcome({ kind: 'stopped' }, report([result('park', 'failed', { required: true, reason: 'timeout' })])).state).toBe('failed')
	})

	test('a required action that never ran converts as well', () => {
		const terminal = sequencerTerminalOutcome({ kind: 'completed' }, report([result('park', 'notRun', { required: true })]))

		expect(terminal.state).toBe('failed')
		expect(terminal.failure).toMatchObject({ reason: 'unexpectedState' })
	})

	test('an optional finalize failure is recorded and changes no state', () => {
		const terminal = sequencerTerminalOutcome({ kind: 'completed' }, report([result('warm', 'failed', { reason: 'busy', detail: 'cooler' })]))

		expect(terminal.state).toBe('completed')
		expect(terminal.failure).toBeUndefined()
		expect(terminal.issues).toEqual([{ nodeId: 'warm', required: false, outcome: 'failed', reason: 'busy', detail: 'cooler' }])
	})

	test('never overwrites the primary failure with a finalize failure', () => {
		const primary: SequencerPrimaryOutcome = { kind: 'failed', reason: 'qualityRejected', detail: 'every frame was rejected' }
		const terminal = sequencerTerminalOutcome(primary, report([result('park', 'failed', { required: true, reason: 'alert', detail: 'park' })]))

		expect(terminal.state).toBe('failed')
		expect(terminal.failure).toEqual({ reason: 'qualityRejected', detail: 'every frame was rejected' })
		expect(terminal.issues).toEqual([{ nodeId: 'park', required: true, outcome: 'failed', reason: 'alert', detail: 'park' }])
	})

	test('the first required finalize failure decides and later ones are only attached', () => {
		const results = [result('park', 'failed', { required: true, reason: 'alert', detail: 'park' }), result('cover', 'failed', { required: true, reason: 'busy', detail: 'cover' })]
		const terminal = sequencerTerminalOutcome({ kind: 'completed' }, report(results))

		expect(terminal.failure).toEqual({ reason: 'alert', detail: 'park' })
		expect(terminal.issues).toHaveLength(2)
	})

	test('records every finalize issue whatever the state ends up being', () => {
		const results = [result('warm', 'failed', { reason: 'busy' }), result('cover', 'notRun'), result('park', 'succeeded')]
		const terminal = sequencerTerminalOutcome({ kind: 'stopped' }, report(results))

		expect(terminal.state).toBe('stopped')
		expect(terminal.issues.map((issue) => issue.nodeId)).toEqual(['warm', 'cover'])
	})
})
