import { cn } from 'cn'
import type { ReactNode } from 'react'
import { SectionHeading } from '../../ui/SectionHeading'

// Section of the SPICE Kernel Library tool: a flat group of the workspace under an uppercase heading, with its controls
// beside the heading, separated from the section before it by a line rather than drawn as a card.

interface LibrarySectionProps {
	// Heading of the section.
	readonly title: string
	// Controls shown beside the heading, wrapping below it when they do not fit, such as filters.
	readonly aside?: ReactNode
	// Extra classes, such as `flex-1` to fill the column.
	readonly className?: string
	// Content.
	readonly children: ReactNode
}

// Flat titled section.
export function LibrarySection({ title, aside, className, children }: LibrarySectionProps) {
	return (
		<section className={cn('flex min-w-0 flex-col gap-3 border-t border-line-100 pt-4 first:border-t-0 first:pt-0', className)}>
			<div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-2">
				<SectionHeading as="h2">{title}</SectionHeading>
				{aside}
			</div>
			{children}
		</section>
	)
}
