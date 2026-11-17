import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { SectionHeading } from './SectionHeading'

// Heading row of a native disclosure, the one look of every <details> of the app: a chevron that turns while it is open,
// the section heading, and optional content after it, such as a summary of what it holds. The chevron follows only the
// <details> it is the summary of, so a disclosure nested in an open one keeps its own. It is reached with Tab and
// toggled with Enter or Space, like any summary. It owns the vertical padding of its row, so the whole band toggles,
// 35 px tall and 43.75 px on phones; the <details> pads only its sides, and its
// content pulls up (-mt-1) to keep the gap below the heading of a padded row.

export interface DisclosureSummaryProps {
	// Heading.
	readonly title: ReactNode
	// Extra classes, such as its padding in the layout.
	readonly className?: string
	// Content after the heading, such as a summary shown while collapsed.
	readonly children?: ReactNode
}

// Toggle of a disclosure.
export function DisclosureSummary({ title, className, children }: DisclosureSummaryProps) {
	return (
		<summary className={cn('flex cursor-pointer list-none items-center gap-2 py-3 select-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent max-sm:min-h-12.5 [&::-webkit-details-marker]:hidden', className)}>
			<Icon name="stepForward" className="size-3.5 flex-none text-ink-300 transition-transform duration-150 [details[open]>summary>&]:rotate-90 motion-reduce:transition-none" />
			<SectionHeading className="flex-none">{title}</SectionHeading>
			{children}
		</summary>
	)
}
