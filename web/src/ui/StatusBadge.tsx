import { tv } from 'tailwind-variants'

// Status pill: a state in words with a color, never a color alone.

// Tone of a badge.
export type StatusTone = 'muted' | 'neutral' | 'active' | 'success' | 'warning' | 'danger'

// Text color of each tone, for list items.
export const TONE_TEXT: Readonly<Record<StatusTone, string>> = { muted: 'text-ink-300', neutral: 'text-ink-200', active: 'text-accent', success: 'text-success', warning: 'text-warning', danger: 'text-danger' }

// Styles of a status badge for each tone.
const badge = tv({
	slots: {
		root: 'inline-flex h-6 flex-none items-center gap-1.5 rounded-full max-w-fit border px-2.5 text-xs leading-none whitespace-nowrap',
		dot: 'size-1.5 rounded-full',
	},
	variants: {
		tone: {
			muted: { root: 'border-dashed border-line-100 text-ink-300', dot: 'hidden' },
			neutral: { root: 'border-line-100 text-ink-200', dot: 'border border-ink-200' },
			active: { root: 'border-accent/50 text-accent', dot: 'animate-pulse bg-accent' },
			success: { root: 'border-success/50 text-success', dot: 'bg-success' },
			warning: { root: 'border-warning/60 text-warning', dot: 'bg-warning' },
			danger: { root: 'border-danger/60 text-danger', dot: 'bg-danger' },
		},
	},
})

// Badge of a tone and label.
export function StatusBadge({ tone, label }: { readonly tone: StatusTone; readonly label: string }) {
	const { root, dot } = badge({ tone })

	return (
		<span className={root()}>
			<span className={dot()} />
			{label}
		</span>
	)
}
