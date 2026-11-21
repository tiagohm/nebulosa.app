import { useState } from 'react'

// Draft of a value a device reports, for the fields of Equipment Control that type a request (a target position, a
// sync value, a speed): the field shows the reported value until the operator edits it, so a command never starts
// from a value read once when the panel opened and gone stale since, and a command stays unavailable until the
// operator typed something other than what the device reports.

// Draft of one reported value.
export interface Draft<T> {
	// Value the field shows: the operator's edit, or the reported value while there is none.
	readonly value: T
	// Whether the operator typed a value other than the reported one.
	readonly edited: boolean
	// Replaces the edit with a value.
	readonly set: (value: T) => void
	// Drops the edit, so the field follows the reported value again.
	readonly reset: () => void
}

// Returns the draft of a reported value; the edit is kept until reset, even when the reported value changes.
export function useDraft<T>(reported: T): Draft<T> {
	const [draft, setDraft] = useState<{ readonly value: T }>()
	const value = draft ? draft.value : reported

	return {
		value,
		edited: draft !== undefined && draft.value !== reported,
		set: (next) => setDraft({ value: next }),
		reset: () => setDraft(undefined),
	}
}
