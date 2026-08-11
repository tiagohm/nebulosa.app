import type { OperationFailureReason } from './orchestration'

// Durable execution state of a sequencer session: what the runtime persists, what it reloads after a
// restart, and what the UI reads. Configuration lives in `sequencer.ts` and never appears here.
//
// Every value in this file is serializable. Device instances, operation handles, reservation tokens, and
// callbacks are excluded by construction, because the whole contract has to survive a write to disk.
// Wall-clock instants are milliseconds since the Unix epoch, as produced by `Date.now()`.

// Lifecycle state of one session.
// V1 produces `created`, `running`, `paused`, `finalizing`, `completed`, `stopped`, and `failed`. The
// remaining values are accepted by the type but never produced yet: declaring them now costs nothing and
// avoids migrating persisted values when resource waiting, suspension, and recovery arrive.
export type SequencerSessionState = 'created' | 'running' | 'paused' | 'finalizing' | 'completed' | 'stopped' | 'failed' | 'waitingResources' | 'suspended' | 'recovering' | 'interrupted'

// State the operator asked the session to converge to, persisted separately from the current state so a
// pause or stop requested during a transition is never lost. There is no `pausing` or `stopping` state:
// with a desired state every transient one would only mean "converging", which the UI derives instead.
export type SequencerDesiredState = 'running' | 'paused' | 'stopped'

// States from which no further work happens and the reservation has already been released.
export const SEQUENCER_TERMINAL_STATES = ['completed', 'stopped', 'failed'] as const

// Reports whether a state is terminal.
export function isSequencerTerminalState(state: SequencerSessionState) {
	return state === 'completed' || state === 'stopped' || state === 'failed'
}

// Definitive cause of a failed session, normalized from the operation that produced it.
export interface SequencerFailure {
	// Normalized terminal cause.
	readonly reason: OperationFailureReason
	// Human-readable diagnostic, when the failing operation carried one.
	readonly detail?: string
}

// Persisted session record. `revision` is the optimistic-concurrency guard: every commit checks the
// revision it expected and increments it, so two writers racing over one session cannot interleave.
export interface SequencerSession {
	// Stable session identifier.
	readonly id: string
	// Definition this session executes.
	readonly definitionId: string
	// Immutable definition revision snapshotted when the session was created; later edits do not affect it.
	readonly definitionRevision: number
	// Optimistic-concurrency revision of this record, starting at 0 and incremented by every commit.
	readonly revision: number
	// Current lifecycle state.
	readonly state: SequencerSessionState
	// State the runtime is converging to.
	readonly desiredState: SequencerDesiredState
	// Instant the session record was created.
	readonly createdAt: number
	// Instant of the last committed change.
	readonly updatedAt: number
	// Instant the session left `created`, absent while it never started.
	readonly startedAt?: number
	// Instant the session reached a terminal state, absent while it has not.
	readonly endedAt?: number
	// Cause of a `failed` session.
	readonly failure?: SequencerFailure
	// Execution position and accumulated progress; always present, even before the first node runs.
	readonly checkpoint: SequencerCheckpoint
}

// Everything the runtime needs to resume a session that was interrupted, kept in memory unconditionally
// and written according to the configured cadence. High-frequency exposure progress is deliberately absent:
// it is presentation, not state the runtime decides from.
//
// V1 persists execution position and capture progress. Trigger anchors and reconciliation hints join them
// with the trigger evaluator.
export interface SequencerCheckpoint {
	// Node the runtime is executing or is about to execute, absent before the first node and after the last.
	readonly cursor?: string
	// Enclosing container nodes, outermost first, so a resume knows which sequence the cursor belongs to.
	readonly containers: readonly string[]
	// Attempts already consumed per node id, including the one in progress.
	readonly attempts: Readonly<Record<string, number>>
	// Nodes that reached a terminal decision and will not run again.
	readonly completed: readonly string[]
	// Capture progress per target, holding the current cycle and the per-group counters of that cycle. It is
	// always present, empty before the first frame, because the scheduler decides from it and a resume that
	// found it absent would restart the cycle it was in the middle of.
	readonly capture: SequencerCaptureProgress
	// Definition revision this checkpoint was produced from; a resume against another revision is invalid.
	readonly definitionRevision: number
	// Handler version per block type, as resolved when the session started. A resume against a registry
	// that no longer offers the same versions is refused rather than silently executed by another handler.
	readonly handlerVersions: Readonly<Record<string, number>>
}

// Counters of one frame group inside the current cycle.
//
// Every counter is per cycle and resets when the cycle advances, because `count` and `integrationTime` are
// per-cycle targets: `repeat: 3` of a group asking for ten frames is three blocks of ten, not thirty frames
// in one block. Accumulating across cycles would make `repeat` indistinguishable from multiplying `count`.
//
// The three outcome counters exist separately even though two of them are constant in V1, where a physically
// completed frame is always accepted and only an abandoned slot is ever rejected. Quality evaluation only has
// to stop incrementing `accepted` and start incrementing `rejected`; neither the scheduler nor the stop
// condition changes.
export interface SequencerGroupProgress {
	// Slots already emitted in this cycle, which is also the ordinal of the next slot. It never reaches beyond
	// the `slotLimit` of the group, which is what bounds the cycle.
	readonly cursor: number
	// Frames accepted, which is the counter the completion criteria are stated in.
	readonly accepted: number
	// Frames physically completed. In V1 this equals `accepted`, since nothing rejects a completed frame.
	readonly captured: number
	// Frames discarded. In V1 only an abandoned slot increments it.
	readonly rejected: number
	// Slots closed without an accepted frame after exhausting their attempt window.
	readonly abandoned: number
	// Accumulated exposure time of the accepted frames of this cycle, in seconds.
	readonly integration: number
	// Physical attempt the current attempt window opened at. Attempts spent in the window are `attempt -
	// attemptWindowStart`, exhaustion is that difference reaching the maximum, and granting a new window after
	// a pause is writing the next physical attempt here. Only the window start is stored: the physical attempt
	// itself is derived from the artifact registry, so the two can never disagree after a crash.
	readonly attemptWindowStart: number
}

// Capture progress of one target: the cycle it is in and the counters of every group inside that cycle.
export interface SequencerTargetProgress {
	// Cycle of `repeat` being executed, starting at 0. The loop ends when cycle `repeat - 1` completes.
	readonly cycle: number
	// Counters per frame group id, holding an entry only for the groups the cycle has already touched.
	readonly groups: Readonly<Record<string, SequencerGroupProgress>>
}

// Capture progress of the whole session, keyed by target id.
//
// V1 has exactly one entry, and the map exists anyway: the progress goes into the checkpoint, and turning a
// record into a map afterwards would invalidate every checkpoint written before.
export type SequencerCaptureProgress = Readonly<Record<string, SequencerTargetProgress>>

// Categories of persisted event. All are low volume and all are needed to reconstruct what a session did.
// - stateChanged: a lifecycle transition.
// - policyApplied: a failure policy decision, such as a retry or a skip.
// - triggerFired: a safe-point trigger that decided to run.
// - artifactCommitted: an artifact promoted from pending to committed.
export type SequencerEventType = 'stateChanged' | 'policyApplied' | 'triggerFired' | 'artifactCommitted'

// Event as it is submitted, before the store assigns its position in the session's sequence.
export interface SequencerEventDraft {
	// Category of the event.
	readonly type: SequencerEventType
	// Plan node the event belongs to, absent for session-level events.
	readonly nodeId?: string
	// Lifecycle state reached, for a state transition.
	readonly state?: SequencerSessionState
	// Human-readable detail, kept short because it is persisted verbatim.
	readonly detail?: string
}

// Persisted event, ordered by a per-session sequence.
export interface SequencerEvent extends SequencerEventDraft {
	// Session this event belongs to.
	readonly sessionId: string
	// Strictly increasing position within the session, derived from the maximum already assigned inside the
	// same commit. Never a free-running counter and never a timestamp, which is not strictly monotonic.
	readonly sequence: number
	// Instant the event was committed.
	readonly timestamp: number
}

// Lifecycle of one artifact. A frame is registered as `pending` before the write starts and promoted only
// after the file is durable, so a crash leaves a pending record instead of a file the session claims exists.
export type SequencerArtifactStatus = 'pending' | 'committed' | 'rejected'

// Artifact as it is submitted. The identity is `(sessionId, logicalSlotId, attempt)`: the attempt belongs
// in the key because a rejected frame and its recapture must coexist, and a resume re-executes the same
// attempt rather than the next one, which is what makes the write idempotent against a crash.
export interface SequencerArtifactDraft {
	// Logical slot the artifact fills, identifying target, group, and slot index within the plan.
	readonly logicalSlotId: string
	// Attempt that produced it, starting at 1.
	readonly attempt: number
	// Status to register or move to.
	readonly status: SequencerArtifactStatus
	// Final path on disk, known once the artifact is committed.
	readonly path?: string
}

// Persisted artifact record.
export interface SequencerArtifact extends SequencerArtifactDraft {
	// Session that produced the artifact.
	readonly sessionId: string
	// Instant the record was first registered.
	readonly createdAt: number
	// Instant of the last status change.
	readonly updatedAt: number
}
