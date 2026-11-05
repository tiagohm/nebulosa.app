import { cn } from 'cn'
import type { ReactNode } from 'react'

// Short explanation under a control or a section, muted, or an error in the danger color: the one secondary text line
// of panels, inspectors, dialogs, and tools.

export interface NoticeProps {
	// Whether the notice reports an error.
	readonly error?: boolean
	// Text of the notice.
	readonly children: ReactNode
}

// One line of explanation, or an error.
export function Notice({ error = false, children }: NoticeProps) {
	return <p className={cn('m-0 text-xs leading-4', error ? 'text-danger' : 'text-ink-300')}>{children}</p>
}
