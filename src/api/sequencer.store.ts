import type { SequencerArtifact, SequencerArtifactDraft, SequencerCheckpoint, SequencerDesiredState, SequencerEvent, SequencerEventDraft, SequencerFailure, SequencerSession, SequencerSessionState } from '#/sequencer.state'
import { SEQUENCER_INITIAL_CAPTURE_PROGRESS } from './sequencer.progress'

// Persistence boundary of the sequencer: sessions, checkpoints, events, and artifacts.
//
// The store exposes exactly one write operation, `commit`, and it is deliberately the only one. A session
// transition changes state, checkpoint, events, and artifacts together, and five separate writes would
// leave a crash between any two of them. Retrofitting atomicity later would mean revisiting every call
// site, so the runtime calls a single commit unit from the start.
//
// The interface is synchronous because both implementations it is meant to have are: an in-memory map and
// a `bun:sqlite` transaction. In memory the commit is one synchronous block; in SQLite it is one
// transaction. Everything else about the contract — optimistic revision check, monotonic event sequence,
// artifact identity — is identical in both, which is what makes the later swap mechanical.
//
// Instants are milliseconds since the Unix epoch.

// Session creation request. The store assigns the id, the initial revision, and the timestamps.
export interface SequencerSessionDraft {
	// Definition the session executes.
	readonly definitionId: string
	// Definition revision snapshotted for the whole session.
	readonly definitionRevision: number
	// Handler version per block type resolved at session start, recorded in the initial checkpoint.
	readonly handlerVersions: Readonly<Record<string, number>>
}

// One atomic unit of durable change. Every field is optional except the session and the revision it
// expects: a commit that only appends an event is as valid as one that also moves the state.
export interface SequencerCommit {
	// Session being changed.
	readonly sessionId: string
	// Revision the caller observed. The commit is refused when the stored revision moved on.
	readonly expectedRevision: number
	// New lifecycle state, when it changes.
	readonly state?: SequencerSessionState
	// New desired state, when the operator asked for one.
	readonly desiredState?: SequencerDesiredState
	// Definitive failure cause, recorded together with a `failed` state.
	readonly failure?: SequencerFailure
	// Replacement checkpoint, stored as an independent copy of the value handed in.
	readonly checkpoint?: SequencerCheckpoint
	// Events appended in order, each receiving the next sequence of the session.
	readonly events?: readonly SequencerEventDraft[]
	// Artifacts registered or moved to a new status.
	readonly artifacts?: readonly SequencerArtifactDraft[]
}

// Why a commit was refused.
// - unknownSession: no session with that id exists.
// - revisionMismatch: another writer committed first; the caller must re-read and decide again.
// - artifactConflict: a second artifact would be committed for a logical slot that already has one.
export type SequencerCommitFailureReason = 'unknownSession' | 'revisionMismatch' | 'artifactConflict'

// Outcome of a commit. On failure nothing was written, including the events and artifacts of the same unit.
export type SequencerCommitResult =
	| {
			readonly ok: true
			// Session as stored after the commit, with its revision already incremented.
			readonly session: SequencerSession
			// Events appended by this commit, in sequence order.
			readonly events: readonly SequencerEvent[]
	  }
	| {
			readonly ok: false
			// Cause of the refusal.
			readonly reason: SequencerCommitFailureReason
			// Session as currently stored, absent when the session itself is unknown.
			readonly session?: SequencerSession
			// Diagnostic naming the exact conflict.
			readonly detail?: string
	  }

// Durable state of the sequencer. Reads return stored snapshots; writes go through `commit`.
export interface SequencerStore {
	// Creates a session in `created`, with an empty checkpoint carrying the resolved handler versions.
	createSession: (draft: SequencerSessionDraft) => SequencerSession
	// Returns one session, or undefined when it does not exist.
	session: (id: string) => SequencerSession | undefined
	// Returns every session, oldest first.
	sessions: () => readonly SequencerSession[]
	// Applies one atomic unit of change.
	commit: (commit: SequencerCommit) => SequencerCommitResult
	// Returns the events of a session in sequence order, optionally only those after a given sequence.
	events: (sessionId: string, afterSequence?: number) => readonly SequencerEvent[]
	// Returns the artifacts of a session in registration order.
	artifacts: (sessionId: string) => readonly SequencerArtifact[]
}

// Everything one session owns, kept together so a commit touches a single entry.
interface SessionEntry {
	// Current session record, replaced wholesale by every commit.
	session: SequencerSession
	// Events in sequence order; the last one carries the maximum sequence assigned so far.
	readonly events: SequencerEvent[]
	// Artifacts by `logicalSlotId` and attempt, in registration order.
	readonly artifacts: Map<string, SequencerArtifact>
}

// In-memory implementation used by the V1 runtime, honoring the same contract a SQLite one would.
export class InMemorySequencerStore implements SequencerStore {
	readonly #sessions = new Map<string, SessionEntry>()
	// Wall-clock source, injectable so tests do not depend on real time.
	readonly #now: () => number

	// Builds a store over an optional clock; the default is the process wall clock.
	constructor(now: () => number = Date.now) {
		this.#now = now
	}

	createSession(draft: SequencerSessionDraft): SequencerSession {
		const timestamp = this.#now()

		const session: SequencerSession = {
			id: Bun.randomUUIDv7(),
			definitionId: draft.definitionId,
			definitionRevision: draft.definitionRevision,
			revision: 0,
			state: 'created',
			desiredState: 'running',
			createdAt: timestamp,
			updatedAt: timestamp,
			checkpoint: {
				containers: [],
				attempts: {},
				completed: [],
				capture: SEQUENCER_INITIAL_CAPTURE_PROGRESS,
				definitionRevision: draft.definitionRevision,
				handlerVersions: { ...draft.handlerVersions },
			},
		}

		this.#sessions.set(session.id, { session, events: [], artifacts: new Map() })

		return session
	}

	session(id: string) {
		return this.#sessions.get(id)?.session
	}

	sessions(): readonly SequencerSession[] {
		return this.#sessions
			.values()
			.map((entry) => entry.session)
			.toArray()
	}

	commit(commit: SequencerCommit): SequencerCommitResult {
		const entry = this.#sessions.get(commit.sessionId)

		if (entry === undefined) return { ok: false, reason: 'unknownSession' }

		const current = entry.session

		if (current.revision !== commit.expectedRevision) {
			return { ok: false, reason: 'revisionMismatch', session: current, detail: `expected revision ${commit.expectedRevision}, stored revision is ${current.revision}` }
		}

		// Every refusal is decided before anything is written, so a rejected commit leaves no partial unit
		// behind and the caller can retry the whole thing against the revision it now reads.
		const conflict = artifactConflict(entry, commit.artifacts)

		if (conflict !== undefined) return { ok: false, reason: 'artifactConflict', session: current, detail: conflict }

		const timestamp = this.#now()
		const state = commit.state ?? current.state
		const started = current.startedAt ?? (state === 'created' ? undefined : timestamp)
		const ended = current.endedAt ?? (isTerminal(state) ? timestamp : undefined)

		const session: SequencerSession = {
			...current,
			revision: current.revision + 1,
			state,
			desiredState: commit.desiredState ?? current.desiredState,
			updatedAt: timestamp,
			startedAt: started,
			endedAt: ended,
			failure: commit.failure ?? current.failure,
			// The stored checkpoint is an independent copy: a runtime that keeps mutating its own working
			// value must not retroactively change what was committed, which is what a serializing store
			// would give and what makes the two implementations interchangeable.
			checkpoint: commit.checkpoint === undefined ? current.checkpoint : structuredClone(commit.checkpoint),
		}

		const events: SequencerEvent[] = []

		// The sequence comes from the maximum already assigned to this session, inside the same unit. A
		// free-running counter would not survive a reload and a timestamp is not strictly monotonic.
		let sequence = entry.events.at(-1)?.sequence ?? 0

		for (const draft of commit.events ?? []) {
			sequence++
			events.push({ ...draft, sessionId: current.id, sequence, timestamp })
		}

		for (const draft of commit.artifacts ?? []) {
			const key = artifactKey(draft.logicalSlotId, draft.attempt)
			const existing = entry.artifacts.get(key)
			entry.artifacts.set(key, { ...draft, sessionId: current.id, createdAt: existing?.createdAt ?? timestamp, updatedAt: timestamp })
		}

		entry.session = session
		for (const event of events) entry.events.push(event)

		return { ok: true, session, events }
	}

	events(sessionId: string, afterSequence: number = 0): readonly SequencerEvent[] {
		const events = this.#sessions.get(sessionId)?.events

		if (events === undefined) return []

		// Sequences are dense and ascending, so the cursor indexes directly instead of scanning.
		return afterSequence <= 0 ? events.slice() : events.slice(afterSequence)
	}

	artifacts(sessionId: string): readonly SequencerArtifact[] {
		const artifacts = this.#sessions.get(sessionId)?.artifacts
		return artifacts === undefined ? [] : artifacts.values().toArray()
	}
}

// Builds the composite artifact identity within one session.
function artifactKey(logicalSlotId: string, attempt: number) {
	return `${logicalSlotId}#${attempt}`
}

// Reports whether the state ends the session.
function isTerminal(state: SequencerSessionState) {
	return state === 'completed' || state === 'stopped' || state === 'failed'
}

// Detects a second committed artifact for a logical slot that already has one, whether the offender is
// already stored or arrives twice in the same unit. Two committed artifacts for one slot would make the
// session claim two final files for a single frame, and whichever one a reader picked would be arbitrary.
function artifactConflict(entry: SessionEntry, drafts: readonly SequencerArtifactDraft[] | undefined) {
	if (drafts === undefined || drafts.length === 0) return undefined

	const committed = new Map<string, number>()

	for (const artifact of entry.artifacts.values()) {
		if (artifact.status === 'committed') committed.set(artifact.logicalSlotId, artifact.attempt)
	}

	// Drafts are applied in order, because a unit is allowed to free a slot and fill it again: a recapture
	// rejects the attempt that held the slot and commits the replacement, and judging both against the state
	// before the unit would refuse a batch whose final state has exactly one committed artifact per slot.
	for (const draft of drafts) {
		const attempt = committed.get(draft.logicalSlotId)

		if (draft.status === 'committed') {
			if (attempt !== undefined && attempt !== draft.attempt) return `slot ${draft.logicalSlotId} already has a committed artifact from attempt ${attempt}`

			committed.set(draft.logicalSlotId, draft.attempt)
		} else if (attempt === draft.attempt) {
			committed.delete(draft.logicalSlotId)
		}
	}

	return undefined
}
