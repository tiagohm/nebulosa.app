import type { DeviceSummary, OperationRecord } from 'api'
import type { ReactNode } from 'react'
import { DisclosureSummary } from '../ui/DisclosureSummary'
import type { ActivityTone } from './groups'

// Small building blocks shared by the Equipment Control panels: the tone of an activity, the description of an
// operation outcome, the props of the controls of a device interface, and the collapsed section that keeps the commands
// redefining a reference (sync, set home, set park, site and clock, backlash) apart from the everyday ones. The notes,
// button rows, and confirmed commands they show are the shared primitives of `ui/`.

// Text color of each activity tone.
export const TONE_COLORS: Readonly<Record<ActivityTone, string>> = {
	off: 'text-ink-300',
	idle: 'text-ink-200',
	active: 'text-accent',
	warning: 'text-danger',
}

// Description of each reason a device operation fails, completing "failed: …".
export const FAILURE_REASONS: Readonly<Record<NonNullable<OperationRecord['reason']>, string>> = {
	busy: 'the device was busy',
	aborted: 'it was stopped',
	disconnected: 'the device disconnected',
	removed: 'the device was removed',
	timeout: 'the device did not finish in time',
	alert: 'the driver reported an error',
	commandFailed: 'the command could not be confirmed',
	unexpectedState: 'the device refused it in its current state',
}

// Props of the controls of one interface of a device.
export interface InterfaceProps {
	// Interface controlled, on the watched connection.
	readonly device: DeviceSummary
}

export interface CollapsedSectionProps {
	// Heading of the section.
	readonly title: string
	// One-line summary shown beside the heading, such as the state of what it configures.
	readonly summary?: string
	// Whether the section opens by itself, such as while it holds an error that blocks the device; the operator can
	// still close it.
	readonly open?: boolean
	// Content of the section.
	readonly children: ReactNode
}

// Panel section closed by default, for the configuration of a device that a night rarely changes.
export function CollapsedSection({ title, summary, open, children }: CollapsedSectionProps) {
	return (
		<details open={open} className="border-b border-line-100 px-4">
			<DisclosureSummary title={title}>{summary && <span className="ml-auto min-w-0 truncate text-sm leading-5 text-ink-300">{summary}</span>}</DisclosureSummary>
			<div className="-mt-1 flex flex-col gap-2 pb-3 text-sm leading-5 text-ink-200">{children}</div>
		</details>
	)
}
