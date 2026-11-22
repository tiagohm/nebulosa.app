import { cn } from 'cn'
import type { ReactNode } from 'react'

// Headline of the state of a camera operation's session (Auto Focus, TPPA, DARV, Flat Wizard, Dark Library Wizard,
// Target Centering, Pointing Model Builder): the state in words, in the danger color once the session failed, and in
// the success color once it reached what it was run for when the operation says so.

interface SessionStateTextProps {
	// Whether the session ended in failure.
	readonly failed: boolean
	// Whether the session ended having reached what it was run for; false by default.
	readonly succeeded?: boolean
	// The state, with the step it is at when the operation reports one.
	readonly children: ReactNode
}

// State of a session in words.
export function SessionStateText({ failed, succeeded = false, children }: SessionStateTextProps) {
	return <p className={cn('m-0', failed ? 'text-danger' : succeeded ? 'text-success' : 'text-ink-100')}>{children}</p>
}
