import { tv } from 'tailwind-variants'
import type { ToolStatus } from './tools'

// Badge with a tool's implementation status, so a planned tool is never mistaken for an operational one.

// Display text of each implementation status.
const TOOL_STATUS_LABELS: Readonly<Record<ToolStatus, string>> = {
	available: 'Available',
	planned: 'Coming Soon',
}

// Styles of the badge by status.
const statusBadge = tv({
	base: 'flex-none rounded-full border px-2 py-px text-[10px] leading-4 font-medium tracking-[0.04em] uppercase',
	variants: {
		status: {
			available: 'border-success/40 text-success',
			planned: 'border-line-100 text-ink-300',
		},
	},
})

export interface ToolStatusBadgeProps {
	// Status to show.
	readonly status: ToolStatus
}

// Status badge of a tool.
export function ToolStatusBadge({ status }: ToolStatusBadgeProps) {
	return <span className={statusBadge({ status })}>{TOOL_STATUS_LABELS[status]}</span>
}
