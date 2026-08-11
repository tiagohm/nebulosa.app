import type { SequencerPlanFrameGroup } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerGroupProgress } from '#/sequencer.state'
import { groupProgressOf, targetProgressOf } from './sequencer.scheduler'

// Accounting of the capture progress: how the outcome of one slot, the advance of a cycle, and the grant of a
// new attempt window change the counters the scheduler decides from.
//
// Every function here is pure and returns a new progress, because the progress is part of the checkpoint and
// the checkpoint is written as one unit with the artifact of the frame that moved it. Mutating it in place
// would let a counter reach the scheduler before the commit that made it durable.
//
// The scheduler owns the predicates over these counters; this module owns the transitions between them. The
// split is what keeps a single answer for "is this group done" while the two questions have different
// callers: the safe point asks the first one, the frame that just ended asks the second.
//
// Exposure times and accumulated integration are in seconds.

// Progress of a session that has not captured anything.
export const SEQUENCER_INITIAL_CAPTURE_PROGRESS: SequencerCaptureProgress = {}

// Replaces the counters of one group of one target, creating the target entry and the group entry when the
// cycle has not touched them yet.
function withGroupProgress(progress: SequencerCaptureProgress, targetId: string, groupId: string, counters: SequencerGroupProgress): SequencerCaptureProgress {
	const target = targetProgressOf(progress, targetId)
	return { ...progress, [targetId]: { ...target, groups: { ...target.groups, [groupId]: counters } } }
}

// Attempts the current window of the slot has consumed through `attempt`, inclusive, so an attempt equal to
// the window start counts as one.
//
// The window is a range over the physical attempt rather than a counter of its own: a stored counter and a
// derived attempt agree only while both are up to date, and a crash between the exposure and the commit is
// exactly when they stop agreeing. `attempt` is the physical attempt of the current slot, derived from the
// artifact registry and never going backwards.
export function attemptsSpent(progress: SequencerGroupProgress, attempt: number) {
	return attempt - progress.attemptWindowStart + 1
}

// Whether the attempt that just finished was the last one the window of the slot allows, which is what
// abandons the slot.
//
// The budget is the `maxAttempts` of the failure policy of the capture action of the group, not a second
// limit of its own: two ceilings deciding the same thing drift apart.
export function attemptWindowExhausted(group: SequencerPlanFrameGroup, progress: SequencerGroupProgress, attempt: number) {
	return attemptsSpent(progress, attempt) >= group.retry.maxAttempts
}

// Records an accepted frame: the slot closes, the counters that decide completion advance, and the cursor
// moves to the next slot, whose attempt window starts at attempt 0 like any fresh slot.
//
// In this version a physically completed frame is always accepted, so `captured` moves with `accepted`; when
// quality evaluation arrives it stops moving `accepted` and moves `rejected` instead, and neither the
// scheduler nor the stop condition changes.
export function acceptFrame(progress: SequencerCaptureProgress, targetId: string, group: SequencerPlanFrameGroup): SequencerCaptureProgress {
	const current = groupProgressOf(targetProgressOf(progress, targetId), group.id)

	return withGroupProgress(progress, targetId, group.id, {
		...current,
		cursor: current.cursor + 1,
		accepted: current.accepted + 1,
		captured: current.captured + 1,
		integration: current.integration + group.exposureTime,
		attemptWindowStart: 0,
	})
}

// Records a slot closed without an accepted frame after exhausting its attempts: the slot is abandoned, it
// counts as rejected as well, and the cursor moves on.
//
// Abandonment is not what ends a group. The budget is the slack the group has to lose slots and still reach
// its target, which is why it is added to the required slots instead of compared against this counter: with
// ten frames and a budget of one, comparing would end the group at the first failure, long before any attempt
// at the target.
export function abandonSlot(progress: SequencerCaptureProgress, targetId: string, group: SequencerPlanFrameGroup): SequencerCaptureProgress {
	const current = groupProgressOf(targetProgressOf(progress, targetId), group.id)

	return withGroupProgress(progress, targetId, group.id, {
		...current,
		cursor: current.cursor + 1,
		rejected: current.rejected + 1,
		abandoned: current.abandoned + 1,
		attemptWindowStart: 0,
	})
}

// Grants a new attempt window to the slot the group is on, which is what a resume after a pause by exhaustion
// does.
//
// The spent attempts of the window go back to zero while the physical attempt keeps growing, so the next file
// does not collide with the one of the failed attempt and the artifact identity stays unique. The abandonment
// budget is untouched and the slot limit does not change: the guarantee bounding an autonomous loop is per
// autonomous run, and only an explicit decision of the operator extends it. `attempt` is the physical attempt
// the new window opens at, which is the next one after the last recorded for the slot.
export function grantAttemptWindow(progress: SequencerCaptureProgress, targetId: string, groupId: string, attempt: number): SequencerCaptureProgress {
	const current = groupProgressOf(targetProgressOf(progress, targetId), groupId)
	return withGroupProgress(progress, targetId, groupId, { ...current, attemptWindowStart: attempt })
}

// Advances the target to the next cycle, resetting every group counter.
//
// The targets of a group are per cycle, so the counters restart with the cycle: `repeat: 3` of a group of ten
// frames is three blocks of ten. Carrying them across cycles would make the repetition count indistinguishable
// from multiplying the frame count.
export function advanceCaptureCycle(progress: SequencerCaptureProgress, targetId: string): SequencerCaptureProgress {
	const target = targetProgressOf(progress, targetId)
	return { ...progress, [targetId]: { cycle: target.cycle + 1, groups: {} } }
}
