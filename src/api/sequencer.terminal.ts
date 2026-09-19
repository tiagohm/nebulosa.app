import type { SequencerFailureReason } from '#/sequencer'
import type { SequencerPlanFinalize } from '#/sequencer.plan'
import type { SequencerPipelineReport, SequencerPipelineResult } from './sequencer.pipeline'

// Composition of the terminal state of a session out of two results that are recorded separately.
//
// `continueOnFailure` says whether the terminal pipeline keeps going, and only that. It does not say what
// state the session ends in, and without this composition a perfect capture followed by a park that failed
// could be reported as `completed` or as `failed` depending on the order the code happened to assign them.
//
// The two parts are the outcome of the main plan — completed, stopped by an intent, or failed with the
// original cause — and the results of the finalize pipeline, one per action. They are never merged into a
// single running value: a primary failure is the one that explains the night, and overwriting it with the
// error of a cooler loses the only useful information the session has.

// Terminal state a session ends in.
export type SequencerTerminalState = 'completed' | 'stopped' | 'failed'

// Outcome of the main plan, before the terminal pipeline runs.
//
// A capture group that concluded degraded and a required startup action that failed are both
// `failed` here, carrying the cause of the device failure that produced them rather than the mechanism that
// noticed it.
export type SequencerPrimaryOutcome = { readonly kind: 'completed' } | { readonly kind: 'stopped' } | { readonly kind: 'failed'; readonly reason: SequencerFailureReason; readonly detail?: string }

// One finalize action that did not succeed, attached to the terminal state without replacing its cause.
export interface SequencerTerminalIssue {
	// Node id of the action.
	readonly nodeId: string
	// Whether the action was declared required.
	readonly required: boolean
	// How it ended: `failed` or `notRun`.
	readonly outcome: SequencerPipelineResult['outcome']
	// Cause of the last attempt, absent for an action that never ran.
	readonly reason?: SequencerFailureReason
	// Diagnostic of the last attempt, when it carried one.
	readonly detail?: string
}

// Terminal state of a session, with the cause that explains it and everything the finalization could not do.
export interface SequencerTerminalOutcome {
	// State the session ends in.
	readonly state: SequencerTerminalState
	// Cause of a `failed` session, absent for any other state.
	readonly failure?: { readonly reason: SequencerFailureReason; readonly detail?: string }
	// Finalize actions that failed or never ran, in execution order. Present whatever the terminal state is:
	// a park that failed after a successful capture is recorded even though the session may still be reported
	// with the cause of something else.
	readonly issues: readonly SequencerTerminalIssue[]
}

// Whether the terminal pipeline runs for this outcome.
//
// The selection is over the state the main plan produced, not over the state the session will end in: the
// composition below can turn a `completed` into a `failed`, and deciding the selection from the final state
// would let the pipeline that produces a failure decide whether it should have run at all.
export function sequencerFinalizeRuns(finalize: SequencerPlanFinalize | undefined, primary: SequencerPrimaryOutcome) {
	return finalize !== undefined && finalize.runOn.includes(primary.kind)
}

// Turns the report of the startup pipeline into the outcome of the main plan, or undefined when the capture
// block may run.
//
// A required startup action that failed aborts the session **before** capture: there is nothing to preserve,
// so the startup failure *is* the reason of the session, the target block does not execute, and the terminal
// pipeline still runs, because it is the one that brings the equipment back to a safe state. A cover that
// opened and a cooler that started before the third action failed have to be undone, and the only path that
// knows how is the terminal pipeline with its own list. An optional action that failed follows
// `continueOnFailure` and does not change the outcome: a night without a dew heater is still a night.
export function sequencerStartupOutcome(report: SequencerPipelineReport): SequencerPrimaryOutcome | undefined {
	if (report.failure !== undefined) return { kind: 'failed', reason: report.failure.reason, detail: report.failure.detail }
	if (report.stopped) return { kind: 'stopped' }

	const missing = requiredNotRun(report)
	if (missing !== undefined) return { kind: 'failed', reason: 'unexpectedState', detail: `the required action ${missing.nodeId} did not run` }

	return undefined
}

// First required action of a pipeline that never ran, or undefined when every one of them was attempted.
//
// By the inversion this cannot happen, and that is exactly why it is detected instead of assumed: if
// it happens it is a defect, and reporting `completed` would hide the defect behind a session that looks fine.
function requiredNotRun(report: SequencerPipelineReport) {
	for (const result of report.results) {
		if (result.required && result.outcome === 'notRun') return result
	}

	return undefined
}

// Collects the finalize actions that did not succeed.
function terminalIssues(report: SequencerPipelineReport | undefined): SequencerTerminalIssue[] {
	const issues: SequencerTerminalIssue[] = []

	if (report !== undefined) {
		for (const result of report.results) {
			if (result.outcome === 'failed' || result.outcome === 'notRun') issues.push({ nodeId: result.nodeId, required: result.required, outcome: result.outcome, reason: result.reason, detail: result.detail })
		}
	}

	return issues
}

// Composes the terminal state of a session from the outcome of its plan and the report of its finalization.
// `finalize` is absent when the plan declares no terminal pipeline or the pipeline did not run for
// this outcome.
//
// The rules, in the order they are applied:
//
// - an existing primary failure is **preserved** as the cause of the session, and the finalize failures are
//   attached to it. The original failure is the one that explains the night;
// - the failure of a **required** finalize action turns `completed` or `stopped` into `failed`. A mount that
//   did not park is not a successful session, however many frames reached the disk;
// - a required action that never ran turns it into `failed` as well, for the reason above;
// - an optional action that failed changes nothing about the state and is still recorded, so the operator
//   sees what the finalization could not do.
//
// Confirmed artifacts stay confirmed in every terminal state: a finalize failure invalidates no frame.
export function sequencerTerminalOutcome(primary: SequencerPrimaryOutcome, finalize?: SequencerPipelineReport): SequencerTerminalOutcome {
	const issues = terminalIssues(finalize)

	if (primary.kind === 'failed') return { state: 'failed', failure: { reason: primary.reason, detail: primary.detail }, issues }

	for (const issue of issues) {
		if (!issue.required) continue
		if (issue.outcome === 'failed') return { state: 'failed', failure: { reason: issue.reason ?? 'unknown', detail: issue.detail }, issues }
		return { state: 'failed', failure: { reason: 'unexpectedState', detail: `the required action ${issue.nodeId} did not run` }, issues }
	}

	return { state: primary.kind, issues }
}
