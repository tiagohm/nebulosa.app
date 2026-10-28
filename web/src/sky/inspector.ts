import { proxy } from 'valtio'

// Expanded state of the collapsible sections of the Object Inspector, shared by every object: a section expanded or
// collapsed for one object stays so for the next one with that section. Position and Visibility start expanded, the
// others collapsed, so the panel opens on where the object is and whether it can be seen. The state lives as long as
// the tab; nothing is persisted.

// Collapsible sections of the Object Inspector, the Sun's included.
export type InspectorSectionId = 'position' | 'visibility' | 'catalog' | 'smallBody' | 'activeRegions' | 'twilight' | 'eclipse' | 'seasons' | 'physical'

// Whether each section is expanded.
export type InspectorSections = Record<InspectorSectionId, boolean>

// Initial state: only Position and Visibility are expanded.
export function initialInspectorSections(): InspectorSections {
	return { position: true, visibility: true, catalog: false, smallBody: false, activeRegions: false, twilight: false, eclipse: false, seasons: false, physical: false }
}

// Expanded sections of the tab.
export const inspectorSections = proxy<InspectorSections>(initialInspectorSections())

// Expands or collapses a section.
export function setInspectorSectionOpen(state: InspectorSections, section: InspectorSectionId, open: boolean) {
	state[section] = open
}
