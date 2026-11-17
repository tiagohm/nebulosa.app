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
	// Whether the command destroys something that cannot be recovered, which draws its confirming button in the danger tone.
	readonly destructive?: boolean
}

// Button that opens a confirmation dialog and runs its command only once confirmed; Cancel or closing the dialog runs
// nothing. The dialog opens with Cancel focused, so a stray Enter or Space never runs the command: confirming takes a
// deliberate move to the confirm button.
export function ConfirmButton({ title, message, confirmLabel, onConfirm, destructive = false, size = 'md', variant = 'secondary', ...props }: ConfirmButtonProps) {
	const [open, setOpen] = useState(false)

	return (
		<>
			<Button size={size} variant={variant} {...props} onClick={() => setOpen(true)} />
			<Modal open={open} onClose={() => setOpen(false)} title={title} className="max-w-md">
				<div className="m-0 text-sm leading-5 text-ink-200">{message}</div>
				<ModalActions>
					<Button variant="secondary" onClick={() => setOpen(false)} data-autofocus>
						Cancel
					</Button>
					<Button
						variant={destructive ? 'danger' : 'primary'}
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
