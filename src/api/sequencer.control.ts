import type { SequencerEndCondition, SequencerExecution } from '#/sequencer'
import type { SequencerCheckpoint, SequencerDesiredState, SequencerSessionState } from '#/sequencer.state'
import { isSequencerTerminalState } from '#/sequencer.state'

// Where a pause, a resume and a stop take effect, and what the session keeps hold of while they are pending.
//
// The intent reducer decides *that* the session converges to `paused` or to `stopped`; nothing in it decides
// *where*. That is this module: the safe point a pending pause is attended at, whether the active action is
// cancelled to reach it, the node a resume re-enters, and the boundary a stop honors. Keeping the two apart
// is what lets the reducer stay a pure fold over commands while the boundary rules stay a pure function of
// the configured mode, with the runtime as the only impure part.
//
// The one rule that spans every decision here: the reservation is retained in every non-terminal state,
// paused and suspended included. Between the `release()` of a cancelled exposure's lease and the `acquire()`
// of the next action there is a real window in which the device is free, and without the reservation a manual
// HTTP command lands exactly in it. With it the window still exists and is unreachable from outside
// the session.
//
// Instants are milliseconds since the Unix epoch.

// Boundaries at which the runtime is between nodes and can honor a pending pause or stop.
//
// They are not a single timeline. `afterAction` is the gap between two plan nodes — two startup steps, the
// slew and the centering — and `beforeExposure` is the gap after the triggers of a capture safe point and
// before the shutter. Ranking those two as if the second were later than the write is what made
// `afterCurrentExposure` skip the frame the operator asked to finish.
//
// - afterExposure: the sensor is done and nothing is on disk yet.
// - afterArtifact: the frame is written and its artifact registered, so the frame is durable.
// - afterAction: the node that was running reached a terminal decision.
// - beforeExposure: the triggers of this frame have finished and the shutter has not opened.
// - beforeFrame: the next frame has not started.
export type SequencerSafePoint = 'afterExposure' | 'afterArtifact' | 'afterAction' | 'beforeExposure' | 'beforeFrame'

// Safe points each pause mode is attended at.
//
// These are not a single timeline. `afterAction` in the capture walk sits *before* the shutter — it is the
// boundary after the triggers of this frame — while `afterArtifact` sits after the write. A rank that put
// `afterAction` later than `afterArtifact` made `afterCurrentExposure` hold in the middle of the safe point
// and skip the frame the operator asked to finish.
//
// `immediate` accepts every boundary and, unlike the other two, does not wait to reach one: it cancels the
// active action and waits for its cleanups.
//
// `afterCurrentExposure` is attended once the frame is durable and at the start of the next one, never
// before the shutter. Pausing between the sensor and the write would hold a session with an exposed frame
// that exists nowhere.
//
// `afterCurrentAction` waits for the triggers of the current safe point and then holds, so the session
// pauses with focus and dithering already applied. That is the more conservative boundary and not the more
// useful one: the post-frame work prepares the *next* frame, and a session that then sits paused for an hour
// will have to redo it. The choice is the operator's, which is why both exist.
const SEQUENCER_PAUSE_ATTENDED: Readonly<Record<SequencerExecution['pauseMode'], readonly SequencerSafePoint[]>> = {
	immediate: ['afterExposure', 'afterArtifact', 'afterAction', 'beforeExposure', 'beforeFrame'],
	afterCurrentExposure: ['afterAction', 'afterArtifact', 'beforeFrame'],
	afterCurrentAction: ['afterAction', 'beforeExposure', 'beforeFrame'],
}

// Whether a pending pause is attended at this safe point under the configured mode.
export function sequencerPauseAttended(mode: SequencerExecution['pauseMode'], safePoint: SequencerSafePoint) {
	return SEQUENCER_PAUSE_ATTENDED[mode].includes(safePoint)
}

// Fields of the execution policy a convergence is decided from. It is the pair and not the whole block
// because the plan snapshots the execution policy into a shape of its own, and both carry these two.
export type SequencerConvergencePolicy = Pick<SequencerExecution, 'pauseMode' | 'stopMode'>

// What the runtime does when it reaches a safe point.
// - continue: take the next step of the plan.
// - pause: stop starting nodes and hold, keeping the reservation.
// - stop: leave the plan and run the terminal pipeline.
export type SequencerConvergence = 'continue' | 'pause' | 'stop'

// Decides what a safe point does about the state the session is converging to.
//
// A stop is attended at every boundary, under either stop mode: unlike a pause, there is no later state that
// would consume the focus or the dither the rest of the safe point would produce, so waiting for a broader
// boundary would only spend devices on work nothing reads. `graceful` shows up as the absence of a
// cancellation and never as a later boundary.
export function sequencerConvergence(desiredState: SequencerDesiredState, execution: SequencerConvergencePolicy, safePoint: SequencerSafePoint): SequencerConvergence {
	if (desiredState === 'stopped') return 'stop'
	if (desiredState === 'paused') return sequencerPauseAttended(execution.pauseMode, safePoint) ? 'pause' : 'continue'
	return 'continue'
}

// Whether the declared end condition of the session has been reached, asked in front of every frame.
//
// The condition bounds the night from outside the plan: the loop stops selecting frames as soon as it holds,
// and the session completes normally with whatever it captured, exactly as if the sequence had run out. It is
// evaluated in front of a frame and never during one, so the frame that is on the sensor when the boundary
// passes is always finished and written.
//
// `at` is the instant of the evaluation and `end.time` of the `at` condition an absolute instant, both in
// milliseconds since the Unix epoch. `integration` is the exposure time the accepted frames of the session
// have accumulated and `end.time` of the `integrationTime` condition the target, both in seconds; the
// accumulation counts the whole session and not the cycle, because the condition ends the session and not the
// cycle.
//
// `afterSequence` ends with the plan itself and therefore never holds here. The two altitude conditions need
// the ephemeris this version does not compute, and the compiler refuses a definition that declares one, so
// they cannot reach a running session.
export function sequencerEndReached(end: SequencerEndCondition, at: number, integration: number) {
	switch (end.type) {
		case 'at':
			return at >= end.time
		case 'integrationTime':
			return integration >= end.time
		default:
			return false
	}
}

// Whether converging to the desired state requires cancelling the action that is running, instead of letting
// it reach its own terminal decision and honoring the pause or the stop at the next safe point.
//
// Only the two immediate modes do. The cancellation is a request and never a kill: the runtime waits for the
// cleanups of the cancelled action before it reports the new state, because reporting early would leave a
// device mid-command while the UI says nothing is running.
//
// A graceful stop lets the running node finish precisely so a frame that was already exposed becomes durable
// rather than being thrown away.
export function sequencerCancelsActiveAction(desiredState: SequencerDesiredState, execution: SequencerConvergencePolicy) {
	if (desiredState === 'stopped') return execution.stopMode === 'immediate'
	return desiredState === 'paused' && execution.pauseMode === 'immediate'
}

// Whether the session still holds its reservation in this state.
//
// Every non-terminal state retains it, `paused` and `suspended` included: a paused session is one that will
// resume against the same devices, and releasing them would let another client take the camera and hand the
// operator a resume that cannot happen. The reservation is released with the terminal state, after the
// terminal pipeline ran.
export function sequencerRetainsReservation(state: SequencerSessionState) {
	return !isSequencerTerminalState(state)
}

// Where a resume re-enters the plan.
// - node: the cursor is a node that had not reached a terminal decision, and it runs again.
// - nextNode: the cursor had already settled, so the walk continues from the containers that hold it.
// - plan: nothing had started, and the walk begins at the root.
export type SequencerResumePoint = { readonly at: 'node'; readonly nodeId: string; readonly containers: readonly string[]; readonly attempt: number } | { readonly at: 'nextNode'; readonly nodeId: string; readonly containers: readonly string[] } | { readonly at: 'plan' }

// Derives the node a resume re-enters from the checkpoint.
//
// The checkpoint is the only input: the runtime holds the same cursor in memory, but reading the in-memory
// copy here would make a resume after a restart take a different path from a resume after a pause, and the
// path that is exercised every night is the one that has to be the same as the path exercised after a crash.
//
// The attempt carried back is the number of attempts already consumed by that node, which is what makes a
// resume continue the retry budget of the node instead of restarting it. It is deliberately not incremented
// here: the node is re-entered on the attempt it was interrupted on, and only a failure spends the next one.
//
// A resume also re-anchors the capture settle at the instant it happens, which the caller does through
// `sequencerSettleAnchored`. The reason is mechanical rather than procedural: a session can sit paused for an
// hour, and the first frame after it starts from a mount that has just been told to track again, so the
// resume pays the same spacing a movement pays. How much of it is actually spent is the cadence boundary's
// decision, and it is usually none.
export function sequencerResumePoint(checkpoint: SequencerCheckpoint): SequencerResumePoint {
	const nodeId = checkpoint.cursor

	if (nodeId === undefined) return { at: 'plan' }
	if (checkpoint.completed.includes(nodeId)) return { at: 'nextNode', nodeId, containers: checkpoint.containers }

	return { at: 'node', nodeId, containers: checkpoint.containers, attempt: checkpoint.attempts[nodeId] ?? 0 }
}
