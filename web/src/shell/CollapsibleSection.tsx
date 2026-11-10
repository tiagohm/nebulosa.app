import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { DisclosureSummary } from '../ui/DisclosureSummary'
import { Notice } from '../ui/Notice'
import { collapsibleSections, sectionOpen, setSectionOpen } from './collapsible'

// Section of a contextual panel that expands and collapses: its heading is the toggle, and a one-line summary beside
// it tells what the section holds while it is collapsed. Important sections start expanded, advanced or secondary ones
// collapsed. Whether it is expanded lives in the tab's section state (collapsible.ts), so it survives a new selection,
// a new frame, a tool switch, or a remount.

export interface CollapsibleSectionProps {
	// Section identifier, which keys its expanded state; namespaced by panel, such as "sky.position".
	readonly id: string
	// Heading.
	readonly title: string
	// One-line summary shown beside the heading while collapsed; absent when there is nothing to summarize.
	readonly summary?: string
	// Whether the section starts expanded, before the operator toggles it; true by default.
	readonly defaultOpen?: boolean
	// Content.
	readonly children: ReactNode
}

// Collapsible titled group of controls inside a contextual panel.
export function CollapsibleSection({ id, title, summary, defaultOpen = true, children }: CollapsibleSectionProps) {
	const open = sectionOpen(useSnapshot(collapsibleSections), id, defaultOpen)

	return (
		<details open={open} onToggle={(e) => e.currentTarget.open !== open && setSectionOpen(collapsibleSections, id, e.currentTarget.open)} className="group/disclosure border-b border-line-100 px-4 py-3 last:border-b-0">
			<DisclosureSummary title={title}>{!open && summary && <span className="ml-auto min-w-0 truncate text-xs text-ink-200">{summary}</span>}</DisclosureSummary>
			<div className="mt-2 flex flex-col gap-2 text-sm leading-5 text-ink-200">{children}</div>
		</details>
	)
}

// Section shown in place of a panel's content while it loads: the id and title of the section that will hold it, so its
// expanded state carries over, and a Loading line.
export function LoadingSection({ id, title }: { readonly id: string; readonly title: string }) {
	return (
		<CollapsibleSection id={id} title={title}>
			<Notice>Loading…</Notice>
		</CollapsibleSection>
	)
}
