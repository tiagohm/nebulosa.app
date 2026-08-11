import type { SequencerArtifact, SequencerArtifactDraft } from '#/sequencer.state'
import type { SequencerFrameClassification } from './sequencer.write'

// Artifact registry of one session: which slots already hold a frame, which attempt is open, and what the
// end of the session does with the records that never closed.
//
// The store owns the atomicity and the uniqueness invariant — at most one `committed` per `logicalSlotId`,
// enforced inside `commit`. This module owns the reading of the registry and the drafts the capture path
// hands to that commit, so the rules of the lifecycle live next to each other instead of being restated at
// every call site.
//
// The lifecycle of one attempt is three steps: a `pending` record registered before the exposure starts, the
// write protocol of §14.5, and a `committed` record confirmed with the checkpoint in the same unit. A crash
// therefore leaves a pending record rather than a file the session claims exists, and reconciliation decides
// what that record becomes.

// Registers an attempt before its exposure starts, which is what makes a crash observable: the record exists
// before the file does, so a resume finds the attempt that was open instead of inventing the next one.
export function sequencerPendingArtifact(logicalSlotId: string, attempt: number): SequencerArtifactDraft {
	return { logicalSlotId, attempt, status: 'pending' }
}

// Confirms an attempt whose frame is durable at `path`, which the write protocol only reports after the
// rename. Committed in the same unit as the checkpoint that counts the frame.
export function sequencerCommittedArtifact(logicalSlotId: string, attempt: number, path: string): SequencerArtifactDraft {
	return { logicalSlotId, attempt, status: 'committed', path }
}

// Closes an attempt that produced no usable frame, whether it was refused by a capture criterion, left an
// unreadable file, or was abandoned when the session ended. The slot stays free, so the next attempt of the
// slot is the number after this one.
export function sequencerRejectedArtifact(logicalSlotId: string, attempt: number): SequencerArtifactDraft {
	return { logicalSlotId, attempt, status: 'rejected' }
}

// Committed artifact of one slot, or undefined when the slot still owes a frame.
//
// There is at most one by construction, so the first match is the answer. A caller asks this before deciding
// to capture: a slot that already has a committed artifact is done, and capturing it again would either
// overwrite a good frame or produce a second file for one slot.
//
// `artifacts` are the records of one session, in any order.
export function sequencerCommittedSlot(artifacts: readonly SequencerArtifact[], logicalSlotId: string) {
	for (const artifact of artifacts) {
		if (artifact.logicalSlotId === logicalSlotId && artifact.status === 'committed') return artifact
	}

	return undefined
}

// Records still open, in registration order. These are the attempts that were registered and never closed:
// either the write is in flight, or the process died between the registration and the commit.
export function sequencerPendingArtifacts(artifacts: readonly SequencerArtifact[]) {
	return artifacts.filter((artifact) => artifact.status === 'pending')
}

// Drafts that close the registry when the session reaches a terminal state, in registration order.
//
// Every pending record becomes rejected: the session is over, nobody will finish the write it stands for, and
// leaving it open would make a resumed or inspected session believe an attempt is still running. A committed
// record is never touched, in any terminal state — the frame is on disk and parsed, and how the session ended
// says nothing about a file that was already durable when it did. Stopping or failing a session loses the
// frames it had not finished, not the frames it had.
//
// Returns an empty array when nothing is open, so the caller can spread it into the terminal commit
// unconditionally.
export function sequencerTerminalArtifacts(artifacts: readonly SequencerArtifact[]): readonly SequencerArtifactDraft[] {
	const drafts: SequencerArtifactDraft[] = []

	for (const artifact of artifacts) {
		if (artifact.status === 'pending') drafts.push(sequencerRejectedArtifact(artifact.logicalSlotId, artifact.attempt))
	}

	return drafts
}

// Draft that reconciles one open attempt against what the classification of §14.5 found on disk, or undefined
// when the record must stay as it is.
//
// - validFinal: the file survived the crash and parses, so the attempt is confirmed and the frame is not
//   captured again. This is the window the protocol exists to close — a finished file whose artifact was
//   never confirmed.
// - invalidFinal and orphanTemporary: the classification already removed what it found, so the attempt
//   produced nothing and is closed; the recapture is the next attempt of the slot.
// - missing: nothing was written, so the pending record stays open and the same attempt is executed again,
//   which is what keeps the write idempotent against a crash before the exposure ended.
//
// `path` is the final path the classification examined.
export function sequencerReconciledArtifact(classification: SequencerFrameClassification, logicalSlotId: string, attempt: number, path: string): SequencerArtifactDraft | undefined {
	switch (classification) {
		case 'validFinal':
			return sequencerCommittedArtifact(logicalSlotId, attempt, path)
		case 'invalidFinal':
		case 'orphanTemporary':
			return sequencerRejectedArtifact(logicalSlotId, attempt)
		case 'missing':
			return undefined
	}
}
