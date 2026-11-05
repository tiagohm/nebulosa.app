import { cn } from 'cn'
import type { ReactNode } from 'react'

// Headline of the state of a camera operation's session (Auto Focus, TPPA, DARV, Flat Wizard, Dark Library Wizard,
// Target Centering, Pointing Model Builder): the state in words, in the danger color once the session failed.

interface SessionStateTextProps {
	// Whether the session ended in failure.
	readonly failed: boolean
	// The state, with the step it is at when the operation reports one.
	readonly children: ReactNode
}

// State of a session in words.
export function SessionStateText({ failed, children }: SessionStateTextProps) {
	return <p className={cn('m-0', failed ? 'text-danger' : 'text-ink-100')}>{children}</p>
}
