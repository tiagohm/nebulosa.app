import type { FrameType } from 'nebulosa/src/devices/indi/device'
import type { Sequencer, SequencerDeviceRole, SequencerFailureReason } from './sequencer'

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
	// Normalized terminal cause. It is the sequencer's own set rather than the operation one, because a session
	// also fails for causes no device operation has: a frame refused by the quality gate, an unsafe condition,
	// or storage that went away mid-night.
	readonly reason: SequencerFailureReason
	// Human-readable diagnostic, when the failing operation carried one.
	readonly detail?: string
}

// Stored definition, which is the request contract plus what persistence assigns to it.
//
// The id and the revision are optional on the definition itself, because a definition being edited has not
// been stored yet and has neither. A stored one always has both, so they are reported here as the total values
// they are; the stored definition carries the same two, written from this record and never from the payload.
export interface SequencerDefinitionRecord {
	// Identifier assigned by persistence.
	readonly id: string
	// Revision of this version, starting at 1 and incremented by every update.
	readonly revision: number
	// Definition as stored, with its id and revision filled in.
	readonly definition: Sequencer
	// Instant the definition was first stored.
	readonly createdAt: number
	// Instant of the last update.
	readonly updatedAt: number
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
	// Nodes that reached a terminal decision and will not run again in the pass they belong to. A loop starting
	// another pass reopens the nodes of its body, which run once per iteration.
	readonly completed: readonly string[]
	// Capture progress per target, holding the current cycle and the per-group counters of that cycle. It is
	// always present, empty before the first frame, because the scheduler decides from it and a resume that
	// found it absent would restart the cycle it was in the middle of.
	readonly capture: SequencerCaptureProgress
	// Instants and counters the safe-point triggers are evaluated against. Always present, because a resume
	// that found them absent would fire every trigger again on the first frame after the restart.
	readonly anchors: SequencerTriggerAnchors
	// Definition revision this checkpoint was produced from; a resume against another revision is invalid.
	readonly definitionRevision: number
	// Handler version per block type, as resolved when the session started. A resume against a registry
	// that no longer offers the same versions is refused rather than silently executed by another handler.
	readonly handlerVersions: Readonly<Record<string, number>>
}

// Last successful run of one safe-point trigger, which is what the next evaluation measures against.
//
// It records a run, not a decision: a trigger that was selected and failed leaves the anchor where it was,
// so the condition that selected it is still true on the next safe point. A trigger suppressed by a rate
// limiter leaves it untouched for the same reason.
export interface SequencerTriggerAnchor {
	// Wall-clock instant of the last successful run, in milliseconds since the Unix epoch. Absent while the
	// trigger has never run, in which case the elapsed time is measured from the start of the session.
	readonly at?: number
	// Frames accepted since that instant, counting only the frames that looked at the sky. A calibration
	// frame never moves it: a run of darks in the middle of the night would otherwise dither and check drift
	// against a framing nothing touched.
	readonly frames: number
	// Temperature observed at the last run, in degrees Celsius, absent when no device reported one. It is
	// the reference of the temperature-change condition, which is why it is captured with the run.
	readonly temperature?: number
	// Filter the last run served, absent when the session commands no wheel. It is the reference of the
	// filter-change condition.
	readonly filter?: string
}

// Condition of a safe point that happens once and is never observable again.
//
// A flip is over as soon as the mount reports the other side of the pier, and a recovery is over as soon as
// the safe point that followed it ends. Everything else a trigger is stated over — frames, elapsed time,
// temperature, the filter the frame needs — is still there to be measured at the next safe point, which is
// why only these two have to be remembered when the run they selected did not focus.
export type SequencerTriggerEventReason = 'afterMeridianFlip' | 'afterRecovery'

// Every anchor of the session, which is the whole input the trigger evaluator reads besides the selection.
//
// `performance.now()` is the clock for durations inside an action, as the project convention requires, but
// it cannot anchor these: it does not survive a restart, and surviving one is what these exist for.
export interface SequencerTriggerAnchors {
	// Instant the session started, in milliseconds since the Unix epoch. It is the origin of every elapsed
	// time whose trigger has never run.
	readonly sessionStart: number
	// Instant the current target started, in milliseconds since the Unix epoch, absent before the first
	// target begins. It is what the initial capture settle is measured from.
	readonly targetStart?: number
	// Anchor of the autofocus trigger.
	readonly autofocus: SequencerTriggerAnchor
	// Anchor of the dither trigger.
	readonly dither: SequencerTriggerAnchor
	// Anchor of the drift check, which is a capture and a solve rather than a reading, and is therefore
	// rate limited by the same mechanism as the runs that command a device.
	readonly driftCheck: SequencerTriggerAnchor
	// One-shot condition that selected an autofocus which has not focused yet, absent when nothing is owed.
	// It is what keeps the promise of a post-flip or post-recovery focus alive across the safe points that
	// follow, and the run that focuses is what clears it.
	readonly pendingAutofocus?: SequencerTriggerEventReason
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
	// Attempt that produced it, starting at 0 and growing only when a previous attempt was rejected or
	// abandoned. It is derived from this registry rather than stored anywhere else, so it never disagrees with
	// what was written.
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

// Everything below describes what the UI observes, and nothing below is a source of truth: the snapshot is
// derived from the runtime state and the checkpoint on every tick, and no execution decision reads it (§15.1).
// It is therefore not persisted and carries no revision of its own beyond the one of the session it describes.

// One declared device role and what it resolved to when the session started.
export interface SequencerDeviceSnapshot {
	// Role the definition declared.
	readonly role: SequencerDeviceRole
	// Device id as written in the definition.
	readonly declaredId: string
	// Device actually resolved for the session, absent while the role could not be resolved against the live
	// devices. The declared id is kept either way, because "the definition asked for this and it is not here"
	// is what the operator has to read.
	readonly deviceId?: string
}

// Target the session is executing, which in V1 is always the only one.
export interface SequencerTargetSnapshot {
	// Target id as declared, which is also the segment of every node below the target block.
	readonly id: string
	// Human-readable label of the target.
	readonly name: string
}

// Exposure the sensor is integrating right now.
//
// It is a field of the capture block rather than one more foreground action on purpose: "capture is idle" is
// the absence of an exposure, and the UI has to tell the two apart without inspecting action types (§15.1).
export interface SequencerExposureSnapshot {
	// Instant the exposure started, in milliseconds since the Unix epoch.
	readonly startedAt: number
	// Time already integrated, in seconds, clamped to `total`.
	readonly elapsed: number
	// Requested duration of the exposure, in seconds.
	readonly total: number
	// Time left, in seconds, `0` once the elapsed time reached the total. The sensor may still be reading out,
	// which is why reaching zero does not remove the exposure from the snapshot.
	readonly remaining: number
}

// Progress of one frame group of the current cycle, joining the plan targets with the checkpoint counters.
//
// `abandoned` and `slotLimit` are reported alongside the outcome counters because a degraded completion must
// not appear only in the terminal state: the operator has to watch the margin being spent while intervening
// is still possible (§15.1).
export interface SequencerGroupSnapshot {
	// Frame group id within the plan.
	readonly id: string
	// Human-readable label of the group, absent when the definition declared none.
	readonly name?: string
	// Classification of the frames the group captures.
	readonly frameType: FrameType
	// Exposure duration of every frame of the group, in seconds.
	readonly exposureTime: number
	// Filter the group captures through, absent when the session commands no wheel.
	readonly filter?: string
	// Slots already emitted in this cycle, which is also the ordinal of the next one.
	readonly cursor: number
	// Frames accepted in this cycle.
	readonly accepted: number
	// Frames physically completed in this cycle.
	readonly captured: number
	// Frames discarded in this cycle.
	readonly rejected: number
	// Slots closed without an accepted frame after exhausting their attempt window.
	readonly abandoned: number
	// Slots the group needs to reach its target in one cycle.
	readonly requiredSlots: number
	// Hard ceiling on the slots the scheduler may emit for the group in one cycle.
	readonly slotLimit: number
	// Accepted exposure time accumulated in this cycle, in seconds.
	readonly integration: number
	// Accepted exposure time of one cycle when every required slot is accepted, in seconds.
	readonly projectedIntegration: number
}

// Capture block of the snapshot: where the session is inside the plan and how much of it is done.
export interface SequencerCaptureSnapshot {
	// Cycle of `repeat` being executed, starting at 0.
	readonly cycle: number
	// Group the scheduler selected, absent before the first frame and after the last.
	readonly groupId?: string
	// Exposure in progress, absent whenever the sensor is not integrating, which is what makes the capture
	// idle even while a foreground action runs.
	readonly exposure?: SequencerExposureSnapshot
	// Every group of the current target, in plan order.
	readonly groups: readonly SequencerGroupSnapshot[]
	// Frames accepted across every group of the current cycle.
	readonly accepted: number
	// Slots every group of one cycle requires.
	readonly requiredSlots: number
	// Accepted exposure time accumulated in this cycle, in seconds.
	readonly integration: number
	// Accepted exposure time of one full cycle, in seconds.
	readonly projectedIntegration: number
	// Estimated work left, in seconds, absent while no plan backs the session. It is an estimate and never a
	// firm forecast: it projects the required slots still to be accepted against the exposure time plus the
	// measured average overhead, ignores flip and astronomical waits, counts no trigger it cannot predict, and
	// is recomputed on every tick rather than persisted (§15.1).
	readonly remaining?: number
	// Instant the session is estimated to finish, in milliseconds since the Unix epoch, absent under the same
	// conditions as `remaining` and carrying the same caveats.
	readonly estimatedCompletion?: number
	// Moving average of the interval between the end of one exposure and the start of the next, in seconds,
	// absent until one such interval has been measured. It is measured and never configured, which is why a
	// session that has just started estimates optimistically and converges as triggers actually run.
	readonly overhead?: number
}

// Why a session is standing still with a known end, such as the flip window of §8.4.
//
// A long wait is never hidden behind the completion estimate: it is reported as the foreground action, with
// the instant it ends and the reason it exists, because a frozen bar with no explanation is the worst thing
// an operator can find at three in the morning (§15.1).
export interface SequencerWaitSnapshot {
	// Why the session is waiting, phrased for the operator.
	readonly reason: string
	// Instant the wait is expected to end, in milliseconds since the Unix epoch, absent when the condition is
	// not a clock — a resource that has to come back, typically.
	readonly until?: number
}

// What an action of the snapshot is doing right now.
// - running: the action is executing.
// - waiting: the action is standing still on a condition, described by its `wait`.
// - retrying: the attempt failed and the next one has not started.
// - cancelling: a cancellation was requested and the cleanups are still running.
export type SequencerActivityState = 'running' | 'waiting' | 'retrying' | 'cancelling'

// One action the session is running, in foreground or in background.
export interface SequencerActivitySnapshot {
	// Plan node the action belongs to.
	readonly nodeId: string
	// Block type of the node, as registered. The UI reads it to tell a trigger — autofocus, dither, flip,
	// recentering — from the capture itself.
	readonly type: string
	// Human-readable label of the node, falling back to its type when the plan declares none.
	readonly name: string
	// What the action is doing.
	readonly state: SequencerActivityState
	// Attempt in progress, starting at 1, so a retry is visible before it fails again.
	readonly attempt: number
	// Fraction of the action already done, in `0..1`, absent when the action cannot report one.
	readonly progress?: number
	// Short human-readable detail reported by the handler.
	readonly detail?: string
	// Instant the action started, in milliseconds since the Unix epoch.
	readonly startedAt: number
	// Condition the action is standing still on, present exactly when the state is `waiting`.
	readonly wait?: SequencerWaitSnapshot
}

// Safe-point triggers the snapshot reports the readiness of.
export type SequencerTriggerName = 'autofocus' | 'dither' | 'driftCheck' | 'meridianFlip'

// Whether one trigger would fire at the next safe point, and how far it is from firing.
//
// The two distances are reported separately, and both are absent for a trigger whose condition is neither a
// frame count nor a clock, because the honest answer there is "when it happens", not a number.
export interface SequencerTriggerSnapshot {
	// Trigger being reported.
	readonly name: SequencerTriggerName
	// Whether its condition already holds, so it runs at the next safe point.
	readonly armed: boolean
	// Frames still to be accepted before the frame-count condition holds, absent when the trigger states none.
	readonly frames?: number
	// Time left before the elapsed-time condition holds, in seconds, absent when the trigger states none.
	readonly elapsed?: number
}

// One monitor of the session. V1 declares no monitors and the list is always empty; the field exists so the
// UI is written against the final shape rather than against a value that appears later.
export interface SequencerMonitorSnapshot {
	// Monitor id.
	readonly id: string
	// Human-readable label.
	readonly name: string
	// Whether the condition the monitor watches currently holds.
	readonly triggered: boolean
	// Short human-readable detail of the last reading.
	readonly detail?: string
}

// The single value that describes everything the UI shows (§15.1).
export interface SequencerSessionSnapshot {
	// Session being described.
	readonly id: string
	// Definition it executes.
	readonly definitionId: string
	// Definition revision it snapshotted at creation.
	readonly definitionRevision: number
	// Revision of the session record this snapshot was derived from, which is what makes two snapshots of the
	// same session comparable.
	readonly revision: number
	// Current lifecycle state.
	readonly state: SequencerSessionState
	// State the runtime is converging to.
	readonly desiredState: SequencerDesiredState
	// Whether the current state differs from the desired one, which is the "converging" the UI shows instead
	// of the `pausing` and `stopping` states the state machine deliberately does not have.
	readonly converging: boolean
	// Cause of a failed session.
	readonly failure?: SequencerFailure
	// Instant the session record was created.
	readonly createdAt: number
	// Instant of the last committed change.
	readonly updatedAt: number
	// Instant the session started, absent while it never did.
	readonly startedAt?: number
	// Instant the session ended, absent while it has not.
	readonly endedAt?: number
	// Device roles the session declared and what they resolved to.
	readonly devices: readonly SequencerDeviceSnapshot[]
	// Target being executed, absent while no plan backs the session.
	readonly target?: SequencerTargetSnapshot
	// Capture progress, always present so the UI never branches on its absence.
	readonly capture: SequencerCaptureSnapshot
	// Action the UI shows, absent when nothing is running. With the serialized V1 runtime there is at most one.
	readonly foreground?: SequencerActivitySnapshot
	// Actions running alongside the foreground one. Empty in practice in V1, where background is telemetry
	// only (§11.2).
	readonly background: readonly SequencerActivitySnapshot[]
	// Node the plan takes next, absent whenever it is not determinable.
	readonly next?: string
	// Readiness of every trigger the plan lowered.
	readonly triggers: readonly SequencerTriggerSnapshot[]
	// Monitors of the session, always empty in V1.
	readonly monitors: readonly SequencerMonitorSnapshot[]
	// Highest event sequence committed for the session, `0` when it has none. A client that reconnects asks
	// for the events after the sequence it already holds instead of replaying the whole history.
	readonly lastEventSequence: number
	// Instant the snapshot was derived, in milliseconds since the Unix epoch. It is what makes the elapsed
	// time of the exposure and the completion estimate readable as a reading taken at a known moment.
	readonly timestamp: number
}
