import type { DeviceSummary, OperationRecord } from 'api'
import { cn } from 'cn'
import { type ReactNode, useState } from 'react'
import { Button, type ButtonProps } from '../ui/Button'
import { Modal } from '../ui/Modal'
import type { ActivityTone } from './groups'

// Small building blocks shared by the Equipment Control panels: a labeled reading, a command button that
// asks for confirmation first, the tone of an activity, and the description of an operation outcome.

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

export interface ReadoutProps {
	// Name of the reading.
	readonly label: string
	// Value as reported by the device, with its unit.
	readonly children: ReactNode
}

// Label and value of one reading reported by a device.
export function Readout({ label, children }: ReadoutProps) {
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="flex-none text-ink-300">{label}</span>
			<span className="min-w-0 text-right font-mono text-[13px] break-all text-ink-100">{children}</span>
		</div>
	)
}

export interface ConfirmButtonProps extends Omit<ButtonProps, 'onClick'> {
	// Title of the confirmation dialog, phrased as a question.
	readonly title: string
	// What the command does and why it deserves a second look.
	readonly message: ReactNode
	// Label of the button that runs the command.
	readonly confirmLabel: string
	// Runs the command once confirmed.
	readonly onConfirm: () => void
}

// Button that opens a confirmation dialog and runs its command only once confirmed. Used for commands that
// redefine a reference (sync, set home, set park) or start a long physical search.
export function ConfirmButton({ title, message, confirmLabel, onConfirm, size = 'sm', variant = 'secondary', ...props }: ConfirmButtonProps) {
	const [open, setOpen] = useState(false)

	return (
		<>
			<Button size={size} variant={variant} {...props} onClick={() => setOpen(true)} />
			<Modal open={open} onClose={() => setOpen(false)} title={title} className="max-w-md">
				<div className="m-0 text-[13px] leading-5 text-ink-200">{message}</div>
				<div className="mt-5 flex justify-end gap-2">
					<Button size="sm" variant="secondary" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						size="sm"
						data-autofocus
						onClick={() => {
							setOpen(false)
							onConfirm()
						}}
					>
						{confirmLabel}
					</Button>
				</div>
			</Modal>
		</>
	)
}

export interface NoticeProps {
	// Whether the notice reports an error.
	readonly error?: boolean
	// Text of the notice.
	readonly children: ReactNode
}

// One line of explanation under a control, or an error in the danger color.
export function Notice({ error = false, children }: NoticeProps) {
	return <p className={cn('m-0 text-xs leading-4', error ? 'text-danger' : 'text-ink-300')}>{children}</p>
}

// Row of command buttons that wraps on narrow panels.
export function Actions({ children }: { readonly children: ReactNode }) {
	return <div className="flex flex-wrap items-center gap-2">{children}</div>
}

// Props of the controls of one interface of a device.
export interface InterfaceProps {
	// Interface controlled, on the watched connection.
	readonly device: DeviceSummary
}
