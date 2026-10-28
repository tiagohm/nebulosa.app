import { cn } from 'cn'
import type { ReactNode } from 'react'
import { useSnapshot } from 'valtio'
import { Icon } from '../ui/Icon'
import { type InspectorSectionId, inspectorSections, setInspectorSectionOpen } from './inspector'

// Section of the Object Inspector that expands and collapses, with the look of a panel section: its heading is the
// toggle, and a one-line summary beside it tells what the section holds while it is collapsed. Whether it is
// expanded lives in the tab's inspector state (inspector.ts), so it survives a new selection, a clock tick, or a
// remount.

export interface CollapsibleSectionProps {
	// Section, which keys its expanded state.
	readonly id: InspectorSectionId
	// Heading.
	readonly title: string
	// One-line summary shown beside the heading while collapsed; absent when there is nothing to summarize.
	readonly summary?: string
	// Content.
	readonly children: ReactNode
}

// Collapsible section of the Object Inspector.
export function CollapsibleSection({ id, title, summary, children }: CollapsibleSectionProps) {
	const open = useSnapshot(inspectorSections)[id]

	return (
		<details open={open} onToggle={(e) => e.currentTarget.open !== open && setInspectorSectionOpen(inspectorSections, id, e.currentTarget.open)} className="border-b border-line-100 px-4 py-3 last:border-b-0">
			<summary className="flex cursor-pointer list-none items-center gap-2 select-none focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<Icon name="stepForward" className={cn('size-3.5 flex-none text-ink-300 transition-transform duration-150 motion-reduce:transition-none', open && 'rotate-90')} />
				<h3 className="m-0 flex-none text-[11px] font-medium tracking-[0.08em] text-ink-300 uppercase">{title}</h3>
				{!open && summary && <span className="ml-auto min-w-0 truncate text-xs text-ink-200">{summary}</span>}
			</summary>
			<div className="mt-2 flex flex-col gap-2 text-[13px] leading-5 text-ink-200">{children}</div>
		</details>
	)
}
