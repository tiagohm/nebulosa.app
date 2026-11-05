import { cn } from 'cn'
import type { ReactNode } from 'react'

// Heading of a group of controls or data: small uppercase muted text, the one section heading of panels, dialogs,
// settings pages, and tools.

interface SectionHeadingProps {
	// Heading level in the document outline: h2 for a page section, h3 (the default) inside a panel or a dialog.
	readonly as?: 'h2' | 'h3'
	// Extra classes, such as its spacing in the layout.
	readonly className?: string
	// Heading text.
	readonly children: ReactNode
}

// Heading of a section.
export function SectionHeading({ as: Heading = 'h3', className, children }: SectionHeadingProps) {
	return <Heading className={cn('m-0 text-xs leading-4 font-medium tracking-[0.08em] text-ink-300 uppercase', className)}>{children}</Heading>
}
