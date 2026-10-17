import { cn } from 'cn'
import { ROLE_STATUS_LABELS, type RoleStatus } from './equipment'

// Display of a role's operational state: its label in the state's color, so the state never depends on
// color alone.

// Text color of each role status.
const ROLE_STATUS_COLORS: Readonly<Record<RoleStatus, string>> = {
	notSelected: 'text-ink-300',
	unavailable: 'text-ink-300',
	disconnected: 'text-ink-200',
	connecting: 'text-accent',
	connected: 'text-success',
	disconnecting: 'text-accent',
	error: 'text-danger',
}

export interface RoleStatusTextProps {
	// State to show.
	readonly status: RoleStatus
	// Extra classes, such as the font size.
	readonly className?: string
}

// Colored label of a role status.
export function RoleStatusText({ status, className }: RoleStatusTextProps) {
	return <span className={cn(ROLE_STATUS_COLORS[status], className)}>{ROLE_STATUS_LABELS[status]}</span>
}
