import type { SequencerFailureReason } from '#/sequencer'
import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { SequencerCaptureProgress } from '#/sequencer.state'
import type { SequencerPolicyDecision } from './sequencer.policy'
import { sequencerFailurePolicy } from './sequencer.policy'
import { abandonSlot, attemptsSpent } from './sequencer.progress'
import { frameGroupDegraded, frameGroupReachedTarget, groupProgressOf, targetProgressOf } from './sequencer.scheduler'

// What a failed capture does to the slot it was filling (§8.3).
//
// The failure policy of §10 decides how many attempts and what happens after them; this module is what
// happens *to the slot*: the attempt window it spends, the abandonment that closes it, the exhaustion that
// holds the session with the slot still on the cursor, and the completion that is degraded rather than
// successful. The two are separate because they bound different things — one bounds attempts, the other
// bounds slots — and multiplying them is what proves the cycle terminates.
//
// The termination argument, in one line: the lowering fixes how many slots a group may emit (`slotLimit`),
// the failure policy fixes how many attempts each slot admits, and the product of the two is the ceiling of
// exposures of the group in one cycle. It holds for every failure policy, which is why no policy has to be
// forbidden to keep the loop finite.
//
// Exposure times and accumulated integration are in seconds; retry delays are in milliseconds.

// Cause of a failure, as it is carried forward through an abandonment and into a degraded completion.
export interface SequencerSlotCause {
	// Normalized cause of the last failed attempt of the slot.
	readonly reason: SequencerFailureReason
	// Human-readable diagnostic of that attempt, when it carried one.
	readonly detail?: string
}

// One failed attempt at a slot.
export interface SequencerSlotFailure extends SequencerSlotCause {
	// Target the group belongs to.
	readonly targetId: string
	// Frame group whose slot was being filled, holding the retry policy and the slot limit of the cycle.
	readonly group: SequencerPlanFrameGroup
	// Capture progress before the outcome of this attempt is applied.
	readonly progress: SequencerCaptureProgress
	// Physical attempt that just failed, derived from the artifact registry and never going backwards. It is
	// not the attempt the policy counts: the window may have been reopened by a resume, and the two are
	// reconciled here.
	readonly attempt: number
	// Whether a control command in the queue explains an `aborted` outcome.
	readonly commanded?: boolean
	// Cause of the cancellation behind an `aborted` outcome, when the layer that cancelled reported one.
	readonly abortedBy?: SequencerFailureReason
}

// What the caller does with the slot.
// - retry: expose again under `attempt`, the next physical attempt, after waiting `delay` milliseconds.
// - abandon: the slot closes without an accepted frame, the counters move, and the cursor advances.
// - hold: the attempts are exhausted and the session pauses with the slot still on the cursor, so a resume
//   can grant it a new window.
// - stop: leave the plan and run the terminal pipeline.
// - fail: end the session, carrying the cause of the last attempt.
export type SequencerSlotDecision =
	| { readonly kind: 'retry'; readonly attempt: number; readonly delay: number }
	| { readonly kind: 'abandon'; readonly progress: SequencerCaptureProgress; readonly cause: SequencerSlotCause }
	| { readonly kind: 'hold'; readonly cause: SequencerSlotCause }
	| { readonly kind: 'stop' }
	| { readonly kind: 'fail'; readonly reason: SequencerFailureReason; readonly detail?: string }

// Applies the outcome of one failed attempt to the slot it was filling.
//
// The physical attempt is translated into the attempt the policy counts before the policy sees it. They are
// different numbers on purpose: the physical one is derived from the artifact registry so a file never
// collides with the one of a failed attempt, and the window is a range over it whose start a resume moves.
// Feeding the physical attempt to the policy directly would make a slot resumed after an exhaustion pause
// exhaust again on its first failure.
//
// A policy that gives up on the action closes the slot in one of two ways, and which one it is matters:
// `skip` and `continue` abandon it and the cursor advances, while `pause` leaves it on the cursor with its
// window exhausted, which is the state a resume grants a new window against. Leaving the slot open under
// `skip` would be the infinite loop this section exists to rule out — `accepted` never moves and the
// scheduler keeps producing work.
export function sequencerSlotFailure(failure: SequencerSlotFailure): SequencerSlotDecision {
	const { attempt, group, progress, targetId } = failure
	const counters = groupProgressOf(targetProgressOf(progress, targetId), group.id)
	const cause: SequencerSlotCause = { reason: failure.reason, detail: failure.detail }

	const decision = sequencerFailurePolicy({
		reason: failure.reason,
		detail: failure.detail,
		attempt: attemptsSpent(counters, attempt),
		retry: group.retry,
		commanded: failure.commanded,
		abortedBy: failure.abortedBy,
	})

	return slotDecisionOf(decision, failure, cause)
}

// Translates the decision of the failure policy into what happens to the slot.
function slotDecisionOf(decision: SequencerPolicyDecision, failure: SequencerSlotFailure, cause: SequencerSlotCause): SequencerSlotDecision {
	switch (decision.kind) {
		case 'retry':
			// The next physical attempt, not the next attempt of the window: the window counts how many are left,
			// the physical number names the file.
			return { kind: 'retry', attempt: failure.attempt + 1, delay: decision.delay }
		case 'skip':
		case 'continue':
			return { kind: 'abandon', progress: abandonSlot(failure.progress, failure.targetId, failure.group), cause }
		case 'pause':
			return { kind: 'hold', cause }
		case 'stop':
			return { kind: 'stop' }
		default:
			return { kind: 'fail', reason: decision.reason, detail: decision.detail }
	}
}

// How a group ended, once its cursor can emit no further slot.
// - capturing: the group is still filling slots.
// - completed: the group reached the target its criteria declare.
// - degraded: the cursor reached the slot limit without reaching the target.
export type SequencerGroupOutcome = 'capturing' | 'completed' | 'degraded'

// Reports where a group stands after a slot closes.
//
// A group that reached its target having abandoned some slots within the budget completes normally: isolated
// abandonment is the noise of a night, and exhaustion is broken equipment. That is exactly what the budget
// buys — it is the slack the group has to lose slots and still reach the target, never a stop trigger of its
// own, which is why the lowering adds it to the required slots instead of comparing a counter against it.
export function sequencerGroupOutcome(group: SequencerPlanFrameGroup, progress: SequencerCaptureProgress, targetId: string): SequencerGroupOutcome {
	const counters = groupProgressOf(targetProgressOf(progress, targetId), group.id)

	if (frameGroupReachedTarget(group, counters)) return 'completed'
	return frameGroupDegraded(group, counters) ? 'degraded' : 'capturing'
}

// Cause a degraded completion is reported with.
//
// Degraded completion is not success: it makes the plan outcome a failure (§8.6). The cause carried is the
// one of the last attempt that failed, and deliberately not "the slot limit was reached", which describes the
// mechanism that stopped the group rather than the reason it never filled — an operator reading the session
// afterwards needs the camera error, not the counter that noticed it.
//
// `cause` is absent only when nothing recorded why the slots were lost, which after a restart is possible,
// and `unknown` is then the honest answer rather than a mechanism dressed as a cause.
export function sequencerDegradedCause(cause?: SequencerSlotCause): SequencerSlotCause {
	return cause ?? { reason: 'unknown' }
}
