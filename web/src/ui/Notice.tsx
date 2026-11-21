import { cn } from 'cn'
import type { ReactNode } from 'react'

// Short explanation under a control or a section, muted, or an error in the danger color: the one secondary text line
// of panels, inspectors, dialogs, and tools.

export interface NoticeProps {
	// Whether the notice reports an error.
	readonly error?: boolean
	// Whether the notice asks for attention, such as a value that is only approximate, when nothing failed.
	readonly warning?: boolean
	// Extra classes, such as a measure that keeps a long explanation readable in a wide column.
	readonly className?: string
	// Text of the notice.
	readonly children: ReactNode
}

// One line of explanation, a warning, or an error.
export function Notice({ error = false, warning = false, className, children }: NoticeProps) {
	return <p className={cn('m-0 text-xs leading-4 text-pretty', error ? 'text-danger' : warning ? 'text-warning' : 'text-ink-300', className)}>{children}</p>
}
