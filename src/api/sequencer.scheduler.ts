import type { SequencerPlanFrameGroup, SequencerPlanLoop } from '#/sequencer.plan'
import type { SequencerCaptureProgress, SequencerGroupProgress, SequencerTargetProgress } from '#/sequencer.state'

// Frame scheduler of the capture loop: the function that answers which frame comes next, given only the
// persisted capture progress and one immutable observation snapshot.
//
// The loop does not iterate a list. How many frames a group produces depends on how many were accepted, and
// which group provides the next one depends on the capture order, so the decision is a function and the loop
// asks it once per safe point.
//
// The scheduler decides, it does not observe. Every input is a parameter, which is what keeps the device
// layer out of the decision and what makes any capture order testable without hardware. Nothing here reads a
// clock either: the instant arrives inside the context.
//
// Exposure times and accumulated integration are in seconds; instants are milliseconds since the Unix epoch.

// Observations a scheduling decision may need and that the progress does not carry, collected once at the top
// of the safe point and immutable during it.
//
// The context exists in V1 even though the sequential order ignores every observation in it, because the
// parameter is what forbids the device access. A rule written only in prose does not survive: whoever
// implements a round-robin order or temperature-driven darks without it reads the camera directly.
export interface FrameSchedulingContext {
	// Target the decision is being made for, which is the key the progress is read at.
	readonly targetId: string
	// Instant of the safe point. It is the only clock reading of the safe point, shared with the trigger
	// evaluator: two readings would let an elapsed-time trigger fire against an instant the selection never
	// saw.
	readonly instant: number
	// Sensor temperature observed at the safe point, in degrees Celsius, absent when the camera reports none.
	readonly sensorTemperature?: number
	// Filter currently installed, absent when the session commands no wheel.
	readonly filter?: string
}

// Frame the scheduler selected, which is one slot of one group in the current cycle.
export interface FrameSelection {
	// Group providing the frame, carrying the exposure, the camera settings, and the attempt budget.
	readonly group: SequencerPlanFrameGroup
	// Cycle the slot belongs to, which is the cycle the target progress is in.
	readonly cycle: number
	// Index of the slot inside the group and cycle, starting at 0 and always below the `slotLimit` of the
	// group. Together with the node, the group, and the cycle it forms the logical slot identity.
	readonly ordinal: number
}

// Decides which frame the capture loop exposes next.
export interface FrameScheduler {
	// Selects the next frame of the current cycle, or undefined when every scheduled group of the cycle has
	// concluded. Advancing the cycle and ending the loop belong to the caller, which is the only side that
	// knows the repetition count; a scheduler that advanced the cycle itself would have to decide termination
	// twice.
	next(progress: SequencerCaptureProgress, context: FrameSchedulingContext): FrameSelection | undefined
}

// Counters of a group that has not produced anything in the current cycle. Reading a missing entry as this
// value is what lets the progress hold entries only for the groups the cycle already touched, and it is also
// the value a cycle advance resets every group to.
export const SEQUENCER_INITIAL_GROUP_PROGRESS: SequencerGroupProgress = { cursor: 0, accepted: 0, captured: 0, rejected: 0, abandoned: 0, integration: 0, attemptWindowStart: 0 }

// Progress of a target that has not started, which is cycle 0 with no group touched.
export const SEQUENCER_INITIAL_TARGET_PROGRESS: SequencerTargetProgress = { cycle: 0, groups: {} }

// Progress of one target, or the initial progress when the target has not started yet.
export function targetProgressOf(progress: SequencerCaptureProgress, targetId: string) {
	return progress[targetId] ?? SEQUENCER_INITIAL_TARGET_PROGRESS
}

// Counters of one group in the current cycle, or the initial counters when the cycle has not touched it yet.
export function groupProgressOf(progress: SequencerTargetProgress, groupId: string) {
	return progress.groups[groupId] ?? SEQUENCER_INITIAL_GROUP_PROGRESS
}

// Whether a group reached the target it was asked for in the current cycle.
//
// A group concludes on whichever criterion is reached first, and a configured `0` disables that criterion, so
// a group is compared only against the criteria it declares. Both targets are per cycle, which is what makes
// `repeat: 3` of a group of ten frames three blocks of ten rather than one block of thirty.
export function frameGroupReachedTarget(group: SequencerPlanFrameGroup, progress: SequencerGroupProgress) {
	return (group.count > 0 && progress.accepted >= group.count) || (group.integrationTime > 0 && progress.integration >= group.integrationTime)
}

// Whether a group concluded the current cycle without reaching its target, having spent every slot the
// lowering allowed it.
//
// This is the degraded completion of the termination proof, and it is not success: the session that ends this
// way fails with the reason of the failure that consumed the slots, never with the slot limit itself, which
// describes the mechanism and not the cause.
export function frameGroupDegraded(group: SequencerPlanFrameGroup, progress: SequencerGroupProgress) {
	return progress.cursor >= group.slotLimit && !frameGroupReachedTarget(group, progress)
}

// Whether a group has nothing left to emit in the current cycle, either by reaching its target or by
// exhausting its slots.
export function frameGroupCompleted(group: SequencerPlanFrameGroup, progress: SequencerGroupProgress) {
	return frameGroupReachedTarget(group, progress) || progress.cursor >= group.slotLimit
}

// Whether every scheduled group of the cycle concluded, which is what closes a cycle.
//
// Completion is stated over the scheduled groups and not over the enabled ones. On-demand groups have no
// target of their own and never reach one, so counting them would keep the cycle from ever closing, and
// stating the rule the other way would silently change the meaning of every checkpoint written before the
// first on-demand group existed. V1 emits scheduled groups only.
export function captureCycleCompleted(groups: readonly SequencerPlanFrameGroup[], progress: SequencerTargetProgress) {
	for (const group of groups) {
		if (!frameGroupCompleted(group, groupProgressOf(progress, group.id))) return false
	}

	return true
}

// Scheduler that finishes each group before starting the next one, in the declaration order of the plan.
//
// `groups` are the normalized groups of the loop, which the scheduler treats uniformly: it does not know
// whether a group came from the capture list or, later, from a calibration expansion.
function sequentialFrameScheduler(groups: readonly SequencerPlanFrameGroup[]): FrameScheduler {
	return {
		next(progress, context) {
			const target = targetProgressOf(progress, context.targetId)

			for (const group of groups) {
				const current = groupProgressOf(target, group.id)
				if (!frameGroupCompleted(group, current)) return { group, cycle: target.cycle, ordinal: current.cursor }
			}

			return undefined
		},
	}
}

// Builds the scheduler the capture order of the plan selects.
//
// V1 implements the sequential order only; the remaining orders are alternative implementations of the same
// function and reach here only through a plan the compiler refused to produce, which is why an unknown order
// throws instead of falling back to the sequential one: quietly capturing in an order other than the one that
// was asked for is the silent acceptance the compatibility rule forbids.
export function frameScheduler(loop: SequencerPlanLoop): FrameScheduler {
	switch (loop.order) {
		case 'sequential':
			return sequentialFrameScheduler(loop.groups)
		default:
			throw new Error(`unsupported capture order: ${loop.order}`)
	}
}
