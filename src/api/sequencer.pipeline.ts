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
	// Waits `delay` milliseconds between two attempts. `signal` is the cancellation of the session, and the wait
	// resolves as soon as it is aborted: a stop that lands during the spacing of a long backoff would otherwise
	// be answered only after the whole wait elapsed, which for a `maximumDelay` of minutes is a session that
	// keeps holding its devices long after the operator ended it. It is the session signal and never the
	// deadline of an attempt, because no attempt is running between two of them.
	delay(delay: number, signal: AbortSignal): Promise<void>
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

// Longest delay a timer accepts, in milliseconds, which is the 32-bit signed maximum — about 24.8 days.
//
// A larger value does not schedule a later timer: it overflows and is scheduled as `1`, so an action declaring
// a deadline of a month would be aborted in the first millisecond and reported as having timed out. A deadline
// beyond this is therefore reached in chunks rather than handed to one timer.
export const SEQUENCER_MAXIMUM_TIMER_DELAY = 2_147_483_647

// Retry policy of a fatal cause: the same budget and spacing, with nothing left to consider recoverable.
//
// A `removed` device does not come back because the node ran again, and an `aborted` attempt has nothing left
// to retry against. Emptying `retryOn` instead of branching keeps one path to the terminal decision, so the
// `onExhausted` of the action still decides what a fatal failure does to the pipeline.
function withoutRetries(configuration: SequencerLifecycle) {
	return { ...configuration.retry, retryOn: [] }
}

// Answer of one attempt, together with what the session was doing when it arrived.
interface SequencerAttempt {
	// Normalized answer of the executor, with the deadline already applied.
	readonly result: SequencerActionResult<unknown>
	// Whether the cancellation of the session was in place before the attempt answered. It is what separates an
	// `aborted` the session caused from one it merely coincided with, and it is recorded rather than read back
	// afterwards for exactly that reason.
	readonly commanded: boolean
}

// Runs one attempt under the timeout of the action, in seconds, and normalizes what comes back.
//
// The deadline gets its own controller so the abort it causes is distinguishable from the abort of a session
// that is stopping: the same `aborted` answer means "the action ran out of time" in one case and "the operator
// stopped the session" in the other, and reporting the second as the first would attribute a decision nobody
// made. A timeout of `0` runs without a deadline, which is what a definition asks for by declaring none.
//
// The cancellation of the session is recorded as it happens, ordered against the answer of the executor,
// instead of being read from the signal once the attempt is over. Reading it afterwards cannot tell a device
// that died from a device that died and was then stopped: a camera failing on its own an instant before the
// operator presses stop would be reported as the stop, and the pipeline would end with no failure to explain
// the night while the actual cause was thrown away. A cancellation that arrives after the answer belongs to
// the next action, which sees it on the signal it is entered with.
//
// The ordering is resolved to the turn, and a cancellation raised in the same synchronous turn as the answer
// counts as commanded. That case is undecidable rather than unhandled: a promise never runs a callback before
// the statement that follows its resolution, so nothing observing the answer — here or at the resolution
// boundary — can be told apart from an answer and a stop that truly happened together. Attributing the tie to
// the stop is the deliberate choice, because the session is leaving the plan either way and the alternative
// invents a device failure to explain a night the operator ended.
async function runAttempt(executor: SequencerPipelineExecutor, step: SequencerPipelineStep, attempt: number, signal: AbortSignal): Promise<SequencerAttempt> {
	const timeout = step.configuration.timeout * 1000
	// A cancellation already in place is the stop of a session that is leaving the plan, whatever this attempt
	// answers; anything later counts only if it preceded the answer.
	let commanded = signal.aborted
	let settled = false

	// Records the cancellation of the session against the progress of the attempt.
	const cancelled = () => {
		commanded ||= !settled
	}

	if (timeout <= 0) {
		signal.addEventListener('abort', cancelled, { once: true })

		try {
			const result = await executor.run(step, attempt, signal)
			settled = true

			return { result, commanded }
		} finally {
			signal.removeEventListener('abort', cancelled)
		}
	}

	const controller = new AbortController()

	const abort = () => {
		cancelled()
		controller.abort()
	}

	let expired = false
	let timer: ReturnType<typeof setTimeout> | undefined

	// Waits `remaining` milliseconds, one timer chunk at a time, and expires the attempt at the end of the last
	// one. Only the pending chunk is ever outstanding, so cancelling the attempt clears the whole deadline.
	//
	// A deadline that arrives after the session already cancelled the attempt expires nothing: the cancellation
	// that came first is the one that explains the attempt, and an executor slow to clean up would otherwise
	// have its `aborted` answer relabelled `timeout` — the stop would be retried under the timeout policy and
	// the pipeline would report a session that nobody stopped.
	const schedule = (remaining: number) => {
		timer = setTimeout(
			() => {
				const left = remaining - SEQUENCER_MAXIMUM_TIMER_DELAY

				if (left > 0) return schedule(left)

				expired = !commanded
				controller.abort()
			},
			Math.min(remaining, SEQUENCER_MAXIMUM_TIMER_DELAY),
		)
	}

	schedule(timeout)

	// A signal that is already aborted never dispatches the event again, so a stop that landed before this
	// attempt started — during the retry delay of the previous one, or before the pipeline was entered at all —
	// has to be carried over by hand. Without it the attempt runs uncancelled for its whole timeout, or
	// succeeds and lets the pipeline keep commanding devices for a session that is already leaving the plan.
	if (signal.aborted) controller.abort()
	else signal.addEventListener('abort', abort, { once: true })

	try {
		const result = await executor.run(step, attempt, controller.signal)
		settled = true

		// The deadline only rewrites an attempt that did not finish. An action that answered `completed` or
		// `skipped` did the work — the mount is parked — and the timer firing in the same turn as that answer
		// says nothing about the equipment. Reporting it as a timeout would park a mount twice, or, on a required
		// finalize action with a single attempt, fail a night that had already finished.
		if (!expired || result.type === 'completed' || result.type === 'skipped') return { result, commanded }

		return { result: { type: 'retryableFailure', reason: 'timeout', detail: `the action did not finish within ${step.configuration.timeout}s` }, commanded }
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
		const { result, commanded: cancellation } = await runAttempt(executor, step, attempt, signal)
		const failure = attemptFailure(result)

		if (failure === undefined) return { ...base, outcome: result.type === 'skipped' ? 'skipped' : 'succeeded', detail: result.type === 'skipped' ? result.detail : undefined, attempts: attempt }

		// A cancellation the session itself commanded, which is the only thing that ends the whole list. It is
		// reported as a stop whatever asked for it, because a pipeline has no paused state of its own: the
		// runtime does not cancel one to pause a session, and a cancelled pipeline is a session leaving the plan.
		// The cancellation is the one the attempt observed, not the state of the signal now: a stop that arrived
		// after the answer did not cause it, and the action keeps the cause it actually failed with.
		const commanded = failure.reason === 'aborted' && cancellation

		const decision = sequencerFailurePolicy({
			reason: failure.reason,
			detail: failure.detail,
			attempt,
			retry: failure.fatal ? withoutRetries(configuration) : configuration.retry,
			commandedBy: commanded ? 'stopped' : undefined,
		})

		if (decision.kind === 'retry') {
			await executor.delay(decision.delay, signal)
			continue
		}

		// Only the commanded cancellation ends the pipeline instead of this action alone. `onExhausted: 'stop'`
		// and `onFailure: 'stop'` reach the same decision, and they are the opposite situation: the action was
		// attempted and did not work. Recording those as `notRun` would report a park that failed as a session
		// nobody has to explain — no failure, every later required action skipped by the stop, and the cause of
		// the night lost — which is exactly the outcome the required-action inversion exists to prevent.
		if (commanded && decision.kind === 'stop') return { ...base, outcome: 'notRun', attempts: attempt }

		// Every other terminal decision — skip, continue, pause, fail, stop — gives up on the action, and which
		// one it was does not change what the session composes from it: `required` is what decides that.
		return { ...base, outcome: 'failed', reason: failure.reason, detail: failure.detail, attempts: attempt }
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
