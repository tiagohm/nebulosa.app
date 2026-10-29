import { proxy } from 'valtio'

// Expanded state of the collapsible sections of the contextual panels (CollapsibleSection), keyed by section id and
// shared by every object, document, and camera tab that shows the section: a section expanded or collapsed once stays
// so wherever it appears next. Only the sections the operator toggled are stored; any other shows the default its
// panel gives it. The state lives as long as the tab; nothing is persisted.

// Whether each section the operator toggled is expanded, by section id.
export type CollapsibleSections = Record<string, boolean>

// Expanded sections of the tab.
export const collapsibleSections = proxy<CollapsibleSections>({})

// Returns whether a section is expanded: as the operator left it, else its default.
export function sectionOpen(state: Readonly<CollapsibleSections>, id: string, defaultOpen: boolean): boolean {
	return state[id] ?? defaultOpen
}

// Expands or collapses a section.
export function setSectionOpen(state: CollapsibleSections, id: string, open: boolean) {
	state[id] = open
}
