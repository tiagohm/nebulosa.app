import { type ReactNode, useState } from 'react'
import { Button, type ButtonProps } from './Button'
import { Modal, ModalActions } from './Modal'

// Button whose command runs only once a dialog confirms it, for commands that redefine a reference (sync, set home, set
// park), discard work, or start a long physical search.

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

// Button that opens a confirmation dialog and runs its command only once confirmed; Cancel or closing the dialog runs
// nothing.
export function ConfirmButton({ title, message, confirmLabel, onConfirm, size = 'md', variant = 'secondary', ...props }: ConfirmButtonProps) {
	const [open, setOpen] = useState(false)

	return (
		<>
			<Button size={size} variant={variant} {...props} onClick={() => setOpen(true)} />
			<Modal open={open} onClose={() => setOpen(false)} title={title} className="max-w-md">
				<div className="m-0 text-sm leading-5 text-ink-200">{message}</div>
				<ModalActions>
					<Button variant="secondary" onClick={() => setOpen(false)}>
						Cancel
					</Button>
					<Button
						data-autofocus
						onClick={() => {
							setOpen(false)
							onConfirm()
						}}
					>
						{confirmLabel}
					</Button>
				</ModalActions>
			</Modal>
		</>
	)
}
