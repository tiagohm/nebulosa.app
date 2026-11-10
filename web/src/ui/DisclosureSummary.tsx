import { cn } from 'cn'
import type { ReactNode } from 'react'
import { Icon } from './Icon'
import { SectionHeading } from './SectionHeading'

// Heading row of a native disclosure, the one look of every <details> of the app: a chevron that turns while it is open,
// the section heading, and optional content after it, such as a summary of what it holds. The <details> holding it
// carries the `group/disclosure` class, which turns the chevron. It is reached with Tab and toggled with Enter or Space, like any
// summary.

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
		<summary className={cn('flex cursor-pointer list-none items-center gap-2 select-none focus-visible:outline-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden', className)}>
			<Icon name="stepForward" className="size-3.5 flex-none text-ink-300 transition-transform duration-150 group-open/disclosure:rotate-90 motion-reduce:transition-none" />
			<SectionHeading className="flex-none">{title}</SectionHeading>
			{children}
		</summary>
	)
}
