import type { ReactNode } from 'react'
import { Icon } from '../../ui/Icon'

// Caveat of the Observing Planner that keeps its headline in view and folds its detail: the first sentence, which states
// what a result is or is not, stays visible, and the rest opens with a click, Enter, or Space on it, like any disclosure.

export interface FoldedNoteProps {
	// Headline, always shown: the one sentence the operator must not miss.
	readonly summary: ReactNode
	// Detail shown once opened.
	readonly children: ReactNode
}

// Caveat with a visible headline and folded detail.
export function FoldedNote({ summary, children }: FoldedNoteProps) {
	return (
		<details className="group text-xs leading-4 text-ink-300">
			<summary className="flex cursor-pointer list-none items-start gap-1 rounded-sm select-none hover:text-ink-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent [&::-webkit-details-marker]:hidden">
				<Icon name="stepForward" className="mt-px size-3.5 flex-none transition-transform duration-150 group-open:rotate-90 motion-reduce:transition-none" />
				<span>{summary}</span>
			</summary>
			<p className="m-0 mt-1 pl-4.5">{children}</p>
		</details>
	)
}
