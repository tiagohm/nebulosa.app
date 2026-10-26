import type { IndiNumberProperty, IndiTextProperty } from 'api'
import { labelOf, numberText, parseNumberText } from './indi.format'

// Drafts of the text and number editors of the INDI Properties view. A draft holds only the elements the user
// edited, as typed, with the reported text of each element when the editing started, so a value the device
// changes meanwhile never overwrites what the user typed and is shown as changed on the device instead. Applying
// sends the edited elements only; the server completes the others with their current values.

// Vector a value editor edits.
export type IndiValueProperty = IndiTextProperty | IndiNumberProperty

// Edited values of a vector.
export interface ValueDraft {
	// Text typed for each edited element, by name.
	readonly values: Readonly<Record<string, string>>
	// Reported text of every element when the editing started, by name.
	readonly reported: Readonly<Record<string, string>>
}

// Returns the reported text of every element of a vector: the value as the driver formats it, or nothing for a
// write-only vector, whose current values the driver never reports.
export function reportedTexts(vector: IndiValueProperty): Record<string, string> {
	const texts: Record<string, string> = {}

	for (const name of vector.elementNames) {
		if (vector.permission === 'wo') texts[name] = ''
		else texts[name] = vector.type === 'NUMBER' ? numberText(vector.elements[name]) : vector.elements[name].value
	}

	return texts
}

// Returns the draft after typing text into an element, starting one from the reported texts when there is none.
export function editDraft(draft: ValueDraft | undefined, reported: Readonly<Record<string, string>>, name: string, text: string): ValueDraft {
	return { values: { ...draft?.values, [name]: text }, reported: draft?.reported ?? reported }
}

// Whether the device changed one of the edited elements since the editing started.
export function changedOnDevice(draft: ValueDraft, reported: Readonly<Record<string, string>>) {
	return Object.keys(draft.values).some((name) => draft.reported[name] !== reported[name])
}

// Elements a draft writes, or the reason it cannot be applied: an unreadable number, or a write-only vector
// with an element left out.
export function draftElements(vector: IndiValueProperty, draft: ValueDraft): { readonly elements: Record<string, string | number> } | { readonly error: string } {
	const elements: Record<string, string | number> = {}

	for (const name of vector.elementNames) {
		const text = draft.values[name]

		if (text === undefined) {
			if (vector.permission === 'wo') return { error: `Type a value for ${labelOf(vector.elements[name])}; the driver does not report it.` }
			continue
		}

		if (vector.type === 'TEXT') {
			elements[name] = text
			continue
		}

		const value = parseNumberText(text)
		if (value === undefined) return { error: `${labelOf(vector.elements[name])} is not a number.` }
		elements[name] = value
	}

	return { elements }
}
