import type { StackingImportCandidate, StackingRole } from 'api'

// Presentation helpers of Image Stacking: labels and texts of what the server answers, and which candidates of an import
// a commit would add. Nothing here decides a role or a filter; the server does.

// Sections of the tool.
export const STACKING_SECTIONS = ['filters', 'frames'] as const

// Section of the tool.
export type StackingSection = (typeof STACKING_SECTIONS)[number]

// Label of each section.
export const SECTION_LABELS: Readonly<Record<StackingSection, string>> = { filters: 'Filters', frames: 'Frames' }

// Label of each role.
export const ROLE_LABELS: Readonly<Record<StackingRole, string>> = { light: 'Light', unclassified: 'Unclassified' }

// Text of a total integration time in seconds: hours and minutes, or minutes and seconds below one hour.
export function integrationText(seconds: number) {
	const total = Math.round(seconds)
	if (total < 3600) return `${Math.floor(total / 60)} min ${total % 60} s`
	return `${Math.floor(total / 3600)} h ${Math.floor((total % 3600) / 60)} min`
}

// Text of a group key: its name, or Unassigned for the lights without a filter.
export function groupLabel(key: string, name: string) {
	return key === '' ? 'Unassigned' : name
}

// What a candidate of an import is, for its review.
export function candidateText(candidate: StackingImportCandidate) {
	if (candidate.error !== undefined) return candidate.error
	if (candidate.rejected !== undefined) return candidate.rejected
	if (candidate.known) return 'Already in this project'
	return candidate.role === undefined ? 'Unknown' : ROLE_LABELS[candidate.role]
}

// Returns whether a candidate can enter a project.
export function candidateUsable(candidate: StackingImportCandidate) {
	return candidate.error === undefined && candidate.rejected === undefined && !candidate.known && candidate.role !== undefined
}

// Counts the candidates a commit adds: lights, and unclassified files either declared lights or kept unclassified.
export function committedCounts(candidates: readonly StackingImportCandidate[], declared: ReadonlySet<string>) {
	let lights = 0
	let unclassified = 0

	for (const candidate of candidates) {
		if (!candidateUsable(candidate)) continue
		if (candidate.role === 'light' || declared.has(candidate.path)) lights++
		else unclassified++
	}

	return { lights, unclassified }
}
