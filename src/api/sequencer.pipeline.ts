import type { SequencerFailureReason } from '#/sequencer'
import type { SequencerPlanPipeline } from '#/sequencer.plan'
import type { SequencerLifecycle } from './sequencer.compiler'
import { sequencerFailurePolicy } from './sequencer.policy'
import type { SequencerActionResult } from './sequencer.registry'

// Executor of an ordered lifecycle pipeline, which is what runs both ends of the night (§8.5, §8.6).
//
// Startup and finalize are the same machine: an ordered list of actions, each with its own timeout, retry
// policy and `required` flag, executed under the reservation the session already holds. They differ in what
// their result composes into, and that composition is not here — this module reports what happened to each
// action and lets the terminal state be composed from it, so the ordered list has one implementation instead
// of two that drift.
//
// Two rules shape the execution.
//
// A **required action is always attempted**. `continueOnFailure` governs the chain of optional actions; it
// cannot keep a later required action from running. Without the inversion, `continueOnFailure: false` and an
// optional `warmCamera` failing third would keep a required `parkMount` fifth from ever running, and the
// session would end `completed` because no required action failed — none was attempted — with the mount
// pointing where it was for the rest of the night. The pipeline exists to leave the equipment safe, so safety
// takes precedence over the continuation policy.
//
// An action interrupted by the flag is recorded as `notRun` rather than dropped. It is the difference between
// an action that was tried and did not work and one that never ran, and the composition of §8.6 needs both.
//
// Timeouts are declared in seconds and retry delays in seconds; both are milliseconds here.

// Result of one action of the pipeline.
// - succeeded: the action reached its terminal state, or its handler found nothing to do, which for an
//   idempotent lifecycle action is the same thing.
// - skipped: the handler declared the action does not apply to this session.
// - failed: every attempt the policy allowed was spent without success.
// - notRun: the action did not take effect, because `continueOnFailure: false` interrupted the chain of
//   optional actions or a commanded stop ended the pipeline. Outside a commanded stop it is only possible for
//   an optional action, since a required one is always attempted; a required action reported this way is a
//   defect, which is exactly why the composition of §8.6 converts it into a failure instead of assuming it
//   cannot happen.
export type SequencerPipelineOutcome = 'succeeded' | 'skipped' | 'failed' | 'notRun'

// One action of the pipeline, as the executor receives it.
export interface SequencerPipelineStep {
	// Plan node id of the action, which is what its events and its checkpoint cursor are addressed by.
	readonly nodeId: string
	// Block type of the action, resolved through the registry.
	readonly type: string
	// Lowered configuration of the action, carrying `required`, the timeout and the retry policy.
	readonly configuration: SequencerLifecycle
}

// What happened to one action.
export interface SequencerPipelineResult {
	// Plan node id of the action.
	readonly nodeId: string
	// Block type of the action.
	readonly type: string
	// Whether a failure of this action makes the session terminal.
	readonly required: boolean
	// How the action ended.
	readonly outcome: SequencerPipelineOutcome
	// Cause of the last failed attempt; absent unless the outcome is `failed`.
	readonly reason?: SequencerFailureReason
	// Diagnostic of the last failed attempt, or of the handler that skipped, when there was one.
	readonly detail?: string
	// Attempts actually spent, `0` for an action that never ran.
	readonly attempts: number
}

// Primary failure a pipeline produces, which is the failure of its first required action that did not succeed.
export interface SequencerPipelineFailure {
	// Node id of the action that failed.
	readonly nodeId: string
	// Cause carried forward as the reason of the session.
	readonly reason: SequencerFailureReason
	// Diagnostic of the failing attempt, when it had one.
	readonly detail?: string
}

// Everything one run of a pipeline reports.
export interface SequencerPipelineReport {
	// One result per declared action, in execution order, including the ones that never ran.
	readonly results: readonly SequencerPipelineResult[]
	// Failure of the first required action that failed, absent when none did. Only a required action produces
	// one: an optional action that fails follows `continueOnFailure` and never decides the outcome of the
	// session — a night without a dew heater is still a night. A required action that never ran carries no
	// failure of its own and is composed from its result by §8.6, which is where the primary outcome is known.
	readonly failure?: SequencerPipelineFailure
	// Whether a commanded stop interrupted the pipeline.
	readonly stopped: boolean
}

// Runs one attempt of one action.
//
// The executor never throws for an expected failure: it answers with the decision of the handler, exactly as
// the registry defines it. `signal` is aborted when the attempt exceeds its timeout or the session cancels,
// and the executor must settle after it rather than leaving the action running.
export interface SequencerPipelineExecutor {
	// Executes one attempt, with `attempt` starting at 1.
	run(step: SequencerPipelineStep, attempt: number, signal: AbortSignal): Promise<SequencerActionResult<unknown>>
	// Waits `delay` milliseconds between two attempts, resolving early when the session cancels.
	delay(delay: number): Promise<void>
}

// Failed attempt of one action, before the policy decides what to do about it.
interface AttemptFailure {
	// Normalized cause of the attempt.
	readonly reason: SequencerFailureReason
	// Diagnostic carried by the attempt, when it had one.
	readonly detail?: string
	// Whether the cause is one no retry of the same node could undo.
	readonly fatal: boolean
}

// Retry policy of a fatal cause: the same budget and spacing, with nothing left to consider recoverable.
//
// A `removed` device does not come back because the node ran again, and an `aborted` attempt has nothing left
// to retry against. Emptying `retryOn` instead of branching keeps one path to the terminal decision, so the
// `onExhausted` of the action still decides what a fatal failure does to the pipeline.
function withoutRetries(configuration: SequencerLifecycle) {
	return { ...configuration.retry, retryOn: [] }
}

// Runs one attempt under the timeout of the action, in seconds, and normalizes what comes back.
//
// The deadline gets its own controller so the abort it causes is distinguishable from the abort of a session
// that is stopping: the same `aborted` answer means "the action ran out of time" in one case and "the operator
// stopped the session" in the other, and reporting the second as the first would attribute a decision nobody
// made. A timeout of `0` runs without a deadline, which is what a definition asks for by declaring none.
async function runAttempt(executor: SequencerPipelineExecutor, step: SequencerPipelineStep, attempt: number, signal: AbortSignal): Promise<SequencerActionResult<unknown>> {
	const timeout = step.configuration.timeout * 1000

	if (timeout <= 0) return await executor.run(step, attempt, signal)

	const controller = new AbortController()
	const abort = () => controller.abort()
	let expired = false

	const timer = setTimeout(() => {
		expired = true
		controller.abort()
	}, timeout)

	signal.addEventListener('abort', abort, { once: true })

	try {
		const result = await executor.run(step, attempt, controller.signal)
		return expired ? { type: 'retryableFailure', reason: 'timeout', detail: `the action did not finish within ${step.configuration.timeout}s` } : result
	} finally {
		clearTimeout(timer)
		signal.removeEventListener('abort', abort)
	}
}

// Translates the answer of one attempt into a failure, or undefined when the attempt did not fail.
function attemptFailure(result: SequencerActionResult<unknown>): AttemptFailure | undefined {
	switch (result.type) {
		case 'completed':
		case 'skipped':
			return undefined
		case 'retryableFailure':
			return { reason: result.reason, detail: result.detail, fatal: false }
		case 'fatalFailure':
			return { reason: result.reason, detail: result.detail, fatal: true }
		default:
			// A lifecycle pipeline has no pause and no suspend of its own: it is the routine that brings the
			// equipment to a safe state, and holding it half-executed waiting for an operator is worse than either
			// finishing or failing. A handler asking for one is a defect, and recording it as the failure it is
			// keeps it visible instead of silently converting it into a wait nobody asked for.
			return { reason: 'unexpectedState', detail: result.detail, fatal: true }
	}
}

// Runs one action until it succeeds, exhausts its policy, or is ended by a commanded stop.
async function runStep(executor: SequencerPipelineExecutor, step: SequencerPipelineStep, signal: AbortSignal): Promise<SequencerPipelineResult> {
	const { configuration } = step
	const base = { nodeId: step.nodeId, type: step.type, required: configuration.required }

	for (let attempt = 1; ; attempt++) {
		const result = await runAttempt(executor, step, attempt, signal)
		const failure = attemptFailure(result)

		if (failure === undefined) return { ...base, outcome: result.type === 'skipped' ? 'skipped' : 'succeeded', detail: result.type === 'skipped' ? result.detail : undefined, attempts: attempt }

		const decision = sequencerFailurePolicy({
			reason: failure.reason,
			detail: failure.detail,
			attempt,
			retry: failure.fatal ? withoutRetries(configuration) : configuration.retry,
			commanded: signal.aborted,
		})

		if (decision.kind === 'retry') {
			await executor.delay(decision.delay)
			continue
		}

		// `stop` is the commanded cancellation of §10, and it ends the pipeline rather than this action alone.
		// Every other terminal decision — skip, continue, pause, fail — gives up on the action, and which one it
		// was does not change what the session composes from it: `required` is what decides that.
		return { ...base, outcome: decision.kind === 'stop' ? 'notRun' : 'failed', reason: failure.reason, detail: failure.detail, attempts: attempt }
	}
}

// Executes an ordered lifecycle pipeline, running each action under its own timeout and retry policy (§8.5,
// §8.6).
//
// `steps` are the enabled actions of the pipeline in declaration order, which is the order that decides
// whether the cover closes before or after the cooler warms — the reason the list is the authority and a set
// of per-feature booleans is not.
//
// The pipeline runs under the reservation the session already holds and never acquires one of its own, which
// is what keeps a device from being commanded between two actions of the same list.
export async function runSequencerPipeline(pipeline: SequencerPlanPipeline, steps: readonly SequencerPipelineStep[], executor: SequencerPipelineExecutor, signal: AbortSignal): Promise<SequencerPipelineReport> {
	const results: SequencerPipelineResult[] = []
	let failure: SequencerPipelineFailure | undefined
	let halted = false
	let stopped = false

	for (const step of steps) {
		const { configuration } = step

		if (stopped || (halted && !configuration.required)) {
			results.push({ nodeId: step.nodeId, type: step.type, required: configuration.required, outcome: 'notRun', attempts: 0 })
			continue
		}

		const result = await runStep(executor, step, signal)
		results.push(result)

		if (result.outcome === 'notRun') {
			stopped = true
			continue
		}

		if (result.outcome !== 'failed') continue

		if (!pipeline.continueOnFailure) halted = true
		if (configuration.required) failure ??= { nodeId: step.nodeId, reason: result.reason ?? 'unknown', detail: result.detail }
	}

	return { results, failure, stopped }
}
