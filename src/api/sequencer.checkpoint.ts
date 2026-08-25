import type { SequencerCheckpoint as SequencerCheckpointPolicy } from '#/sequencer'
import type { SequencerCaptureProgress, SequencerCheckpoint, SequencerTriggerAnchors } from '#/sequencer.state'

// The checkpoint of a running session: the value the runtime keeps in memory and the cadence at which it is
// written (§13.2, §13.3).
//
// The separation that makes this module necessary is between **keeping** and **persisting**. `execution.
// checkpoint` exposes `enabled`, `afterEveryAction`, `afterEveryFrame`, `afterEveryArtifact` and `interval`,
// and read as written they would allow turning the whole checkpoint off. That is not a setting, it is the
// removal of state the runtime needs to work: the attempt window of the current slot (§8.3), the trigger
// anchors (§8.4) and the capture progress live there, and without them the safe point has nothing to decide
// against and the termination proof has no counter. So the checkpoint is kept unconditionally, always, and
// the policy governs only how often it is written.
//
// Instants are milliseconds since the Unix epoch, and the declared interval is seconds.

// What made the runtime consider a write.
// - action: a plan action reached a terminal decision.
// - frame: an exposure ended.
// - artifact: an artifact row is part of the same unit.
// - transition: the lifecycle state or the desired state changed.
// - interval: nothing happened except time passing.
export type SequencerCheckpointTrigger = 'action' | 'frame' | 'artifact' | 'transition' | 'interval'

// Whether the checkpoint is written for this trigger, `elapsed` milliseconds after the last write.
//
// A transition and an artifact are always written, whatever the policy declares, because neither is cadence.
// A state change is the record of what the session *is*, and an artifact row is the durable half of a frame:
// the progress that counted the frame and the artifact that records it are one unit (§13.2), and writing them
// apart lets a restart see a committed artifact with no progress counting it — which captures the slot twice
// — or progress for a frame no artifact ever recorded. `afterEveryArtifact` is therefore honored and cannot
// be turned off; it names a durability rule rather than a frequency.
//
// Every cadence trigger also writes when the declared interval has elapsed, which is what `interval` means:
// the maximum time a session may go without a durable checkpoint, not a timer of its own.
export function sequencerCheckpointDue(policy: SequencerCheckpointPolicy, trigger: SequencerCheckpointTrigger, elapsed: number) {
	if (trigger === 'transition' || trigger === 'artifact') return true
	if (trigger === 'action' && policy.afterEveryAction) return true
	if (trigger === 'frame' && policy.afterEveryFrame) return true

	return policy.interval > 0 && elapsed >= policy.interval * 1000
}

// Checkpoint of one session, held in memory and handed to the store as one value.
//
// Every mutation replaces the value instead of editing it in place, so the checkpoint handed to a commit is
// never seen changing afterwards: a counter that reached the store before the commit that made it durable is
// exactly the drift the atomic unit exists to prevent.
export class SequencerCheckpointKeeper {
	#checkpoint: SequencerCheckpoint
	#writtenAt: number
	#dirty = false

	// Builds a keeper over the stored checkpoint of a session, `at` being the instant it was last written,
	// which for a session that never wrote one is the instant it was created.
	constructor(checkpoint: SequencerCheckpoint, at: number) {
		this.#checkpoint = checkpoint
		this.#writtenAt = at
	}

	// Current value, which is always up to date regardless of what was written.
	get checkpoint(): SequencerCheckpoint {
		return this.#checkpoint
	}

	// Whether the value changed since the last write.
	get dirty() {
		return this.#dirty
	}

	// Instant of the last write.
	get writtenAt() {
		return this.#writtenAt
	}

	// Moves the cursor onto a node, with the container stack it belongs to, outermost first.
	enter(nodeId: string, containers: readonly string[]) {
		this.#replace({ cursor: nodeId, containers })
	}

	// Records the attempt a node is on, which is what a resume re-enters it with instead of restarting it.
	attempt(nodeId: string, attempt: number) {
		this.#replace({ attempts: { ...this.#checkpoint.attempts, [nodeId]: attempt } })
	}

	// Marks a node as reached a terminal decision, so a resume continues past it rather than running it again.
	// Recording the same node twice leaves the checkpoint unchanged.
	complete(nodeId: string) {
		if (this.#checkpoint.completed.includes(nodeId)) return
		this.#replace({ completed: [...this.#checkpoint.completed, nodeId] })
	}

	// Reopens the nodes of a container that is starting another pass, dropping them from `completed` and
	// discarding the attempts they spent.
	//
	// Both blocks are keyed by node id alone, and the capture loop runs its body once per frame (§8.3). Without
	// this, the second iteration re-enters a body whose nodes are all recorded as settled: `sequencerResumePoint`
	// answers `nextNode` for every one of them, and the preparation, the safe-point triggers and the capture of
	// that iteration are skipped. The stale attempt count is the same defect from the budget side — the node
	// would be re-entered carrying the retries another iteration already spent.
	reenter(nodeIds: readonly string[]) {
		const reopened = new Set(nodeIds)
		const completed = this.#checkpoint.completed.filter((nodeId) => !reopened.has(nodeId))
		const attempts: Record<string, number> = Object.create(null)

		for (const nodeId in this.#checkpoint.attempts) {
			if (!reopened.has(nodeId)) attempts[nodeId] = this.#checkpoint.attempts[nodeId]!
		}

		if (completed.length === this.#checkpoint.completed.length && Object.keys(attempts).length === Object.keys(this.#checkpoint.attempts).length) return

		this.#replace({ completed, attempts })
	}

	// Clears the cursor, which is the state of a session before the first node and after the last one.
	leave() {
		this.#replace({ cursor: undefined })
	}

	// Replaces the capture progress, which is the only block keyed by target.
	capture(capture: SequencerCaptureProgress) {
		this.#replace({ capture })
	}

	// Replaces the trigger anchors.
	//
	// The anchors are session-level and deliberately not keyed by target: a new target resets what depends on
	// pointing and framing — dither, centering, drift — and resets nothing that depends on the equipment.
	// Focus does not change because the telescope turned, and neither does sensor temperature.
	anchors(anchors: SequencerTriggerAnchors) {
		this.#replace({ anchors })
	}

	// Reports that the current value reached the store, `at` being the instant of the commit.
	//
	// It is called after the commit succeeded and never before: a refused commit leaves the checkpoint dirty,
	// so the next write carries the change instead of dropping it.
	written(at: number) {
		this.#writtenAt = at
		this.#dirty = false
	}

	// Whether the checkpoint should travel with the unit this trigger produces, `at` being its instant. A value
	// unchanged since the last write is never due: it would replace the stored checkpoint with itself.
	due(policy: SequencerCheckpointPolicy, trigger: SequencerCheckpointTrigger, at: number) {
		return this.#dirty && sequencerCheckpointDue(policy, trigger, at - this.#writtenAt)
	}

	// Replaces the value with the fields of the change applied over it.
	#replace(change: Partial<SequencerCheckpoint>) {
		this.#checkpoint = { ...this.#checkpoint, ...change }
		this.#dirty = true
	}
}
