import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
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
		<details open={open} onToggle={(e) => e.currentTarget.open !== open && setSectionOpen(collapsibleSections, id, e.currentTarget.open)} className="border-b border-line-100 px-4 py-3 last:border-b-0">
			<summary className="flex cursor-pointer list-none items-center gap-2 select-none focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<Icon name="stepForward" className={cn('size-3.5 flex-none text-ink-300 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')} />
				<h3 className="m-0 flex-none text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{title}</h3>
				{!open && summary && <span className="ml-auto min-w-0 truncate text-xs text-ink-200">{summary}</span>}
			</summary>
			<div className="mt-2 flex flex-col gap-2 text-[13px] leading-5 text-ink-200">{children}</div>
		</details>
	)
}
