import type { SequencerFailureReason, SequencerRetryPolicy } from '#/sequencer'
import type { SequencerDesiredState } from '#/sequencer.state'

// What a session does when one action did not succeed (§10).
//
// The decision is a pure function of the declared policy, the attempt that failed, the normalized reason and
// whether a control command explains the failure. Nothing here reads a clock, a device or the session state:
// the caller applies the decision, and the same inputs always produce the same one, which is what makes a
// night reproducible from its event log.
//
// Two rules shape everything below.
//
// `retryOn` is obeyed **literally**. It is required and per action, and it is the whole list of reasons that
// action considers recoverable. A default table applied on top of it would be the second source of truth the
// compatibility rule forbids: the operator declares `retryOn: ['timeout']` and the session retries a `busy`
// because "the default says so". The defaults the UI writes when it creates a definition live in the UI.
//
// Where a feature declares `onFailure`, **it** is the terminal decision of that action and the `onExhausted`
// of the same retry policy does not decide. The two answer the same question — what the session does when
// this action did not work — and do not even offer the same answers: only `onFailure` has `continue` and
// `continueUnguided`, only `onExhausted` has `skip`. `onFailure` is the more expressive of the two, and that
// is what decides in its favor: `dither.onFailure: 'continue'` is the right semantics for a dither that could
// not displace, and it is inexpressible through `onExhausted`. `retry` keeps governing how many attempts and
// how far apart; what leaves it is only the final decision.
//
// Delays are declared in seconds and returned in milliseconds, which is what the wait takes.

// Terminal decision a feature declares for itself, alongside the retry policy that governs its attempts.
//
// `suspend` is accepted by the type because the definition contract carries it, and the compiler refuses a
// definition that asks for it: this version has no suspended state to move a session into.
export type SequencerOnFailure = 'continue' | 'continueUnguided' | 'pause' | 'suspend' | 'stop' | 'fail'

// What the caller does with the action that failed.
// - retry: run the same node again, as `attempt`, after waiting `delay`.
// - skip: give up on this node and continue the plan.
// - continue: the same, for a feature that declares the outcome harmless; `guiding` reports whether the
//   session keeps guiding, which is the only thing that separates `continue` from `continueUnguided`.
// - pause: hold the session and wait for the operator, keeping the reservation.
// - stop: leave the plan and run the terminal pipeline, ending `stopped`.
// - fail: end the session, carrying the cause forward.
export type SequencerPolicyDecision =
	| { readonly kind: 'retry'; readonly attempt: number; readonly delay: number }
	| { readonly kind: 'skip' }
	| { readonly kind: 'continue'; readonly guiding: boolean }
	| { readonly kind: 'pause' }
	| { readonly kind: 'stop' }
	| { readonly kind: 'fail'; readonly reason: SequencerFailureReason; readonly detail?: string }

// One failure, as the policy sees it.
export interface SequencerPolicyFailure {
	// Normalized cause, already translated from the operation that produced it.
	readonly reason: SequencerFailureReason
	// Human-readable diagnostic carried by the failing operation, when it had one.
	readonly detail?: string
	// Attempt that just failed, starting at 1. It is the attempt number and not a count of remaining ones, so
	// a resume that re-enters a node on the attempt it was interrupted on decides exactly as it would have.
	readonly attempt: number
	// Attempt budget and spacing of the action.
	readonly retry: SequencerRetryPolicy
	// Terminal decision the feature declares, when it declares one. Absent for the actions that only carry a
	// retry policy, where `onExhausted` decides.
	readonly onFailure?: SequencerOnFailure
	// Desired state a control command in the queue converged to, when one explains an `aborted` outcome. Only
	// meaningful for `aborted`, and absent when nothing commanded the cancellation. It is the state and not a
	// flag because both of the states that cancel an action reach here: an immediate stop and an immediate
	// pause both cancel what is running, and only the origin separates a session that is shutting down from one
	// that is waiting for its operator.
	readonly commandedBy?: Exclude<SequencerDesiredState, 'running'>
	// Cause of the cancellation behind an `aborted` outcome, when the layer that cancelled reported one.
	readonly abortedBy?: SequencerFailureReason
}

// Delay before the next attempt, in milliseconds.
//
// The spacing grows as `delay * backoff^(attempt - 1)`, so the first retry waits exactly `delay`, and it is
// capped at `maximumDelay`. The cap is also what keeps a large attempt number safe: the power overflows to
// `Infinity` long before the budget is exhausted, and the minimum against a finite cap absorbs it.
//
// A `maximumDelay` below `delay` is honored literally and produces the shorter wait, like every other field
// of the policy.
function retryDelay(retry: SequencerRetryPolicy, attempt: number) {
	return Math.min(retry.delay * retry.backoff ** (attempt - 1), retry.maximumDelay) * 1000
}

// Applies the terminal decision of the action, which is `onFailure` when the feature declares one.
function terminalDecision(failure: SequencerPolicyFailure): SequencerPolicyDecision {
	const decision = failure.onFailure ?? failure.retry.onExhausted

	switch (decision) {
		case 'continue':
			return { kind: 'continue', guiding: true }
		case 'continueUnguided':
			return { kind: 'continue', guiding: false }
		case 'skip':
			return { kind: 'skip' }
		case 'pause':
			return { kind: 'pause' }
		case 'stop':
			return { kind: 'stop' }
		default:
			// `fail`, and `suspend`, which the compiler refuses before a session can ask for it. Failing is the
			// honest answer if one ever arrives: pretending it means `pause` would give the definition a terminal
			// decision it never declared.
			return { kind: 'fail', reason: failure.reason, detail: failure.detail }
	}
}

// Whether the reason is one this action declared recoverable and the budget still has an attempt for it.
function retryable(failure: SequencerPolicyFailure) {
	return failure.attempt < failure.retry.maxAttempts && failure.retry.retryOn.includes(failure.reason)
}

// Decides what the session does about one failed action (§10).
//
// An `aborted` outcome is decided by its origin rather than by the policy, because the origin is part of the
// reason. A cancellation a control command explains is intentional and converges to the state that command
// asked for; a cancellation nothing explains is a failure, and the cause of the cancellation — a disconnect,
// a removal, a quiescence — is carried forward instead. The device lifecycle cancels the active operation
// when a device goes away, and that `aborted` has no command behind it: without this rule a session ends
// "intentionally stopped" because of a USB cable, and the history records a human decision nobody made. When
// in doubt the answer is failure, because attributing intent where there was none is the error that erases
// the information.
//
// The commanded origin carries *which* state it converged to, and the two are not interchangeable: an
// immediate pause cancels the running action exactly like an immediate stop does (§11.3), so reading every
// commanded cancellation as a stop would shut a session down because the operator asked it to wait.
//
// It is also why an aborted action is never retried: no origin leaves anything to retry against, the stopped
// one would fight the very stop that produced it, and the paused one is re-entered by the resume instead.
export function sequencerFailurePolicy(failure: SequencerPolicyFailure): SequencerPolicyDecision {
	if (failure.reason === 'aborted') {
		if (failure.commandedBy === 'stopped') return { kind: 'stop' }
		if (failure.commandedBy === 'paused') return { kind: 'pause' }
		return { kind: 'fail', reason: failure.abortedBy ?? 'aborted', detail: failure.detail }
	}

	return retryable(failure) ? { kind: 'retry', attempt: failure.attempt + 1, delay: retryDelay(failure.retry, failure.attempt) } : terminalDecision(failure)
}
