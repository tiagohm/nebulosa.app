import { cn } from 'cn'
import { createContext, type ReactNode, useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from './Button'
import { Icon } from './Icon'

// Lets the ModalActions of a modal's content tell the nearest Modal that it closes itself from the bottom: called when
// the actions mount, it returns the call that reports their unmount. Absent outside a Modal.
const ModalActionsContext = createContext<(() => () => void) | undefined>(undefined)

export interface ModalProps {
	readonly open: boolean
	readonly onClose: () => void
	readonly title: string
	readonly className?: string
	// Keeps the panel within the viewport: the body becomes a flex column that a child with min-h-0 and
	// its own overflow can fill and scroll, instead of the whole dialog scrolling.
	readonly fit?: boolean
	readonly children: ReactNode
}

// Native modal <dialog>: the browser handles the focus trap, Esc and focus restore.
// The dialog fills the viewport and scrolls, so the panel inside it can grow freely: from a fixed distance below the top
// edge from 640 px up, so content that grows or shrinks never moves the title, and docked to the bottom edge below it,
// where a Close button ends the panel within reach of the thumb unless the content has ModalActions of its own. It wraps
// its text whatever the element it is declared in, such as a table cell that does not wrap.
export function Modal({ open, onClose, title, className, fit = false, children }: ModalProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	// A click only closes when it both starts and ends on the backdrop.
	const pressedOnBackdrop = useRef(false)
	// Number of ModalActions mounted in the content; the phone Close button shows only while there are none.
	const [actions, setActions] = useState(0)
	// Registers a ModalActions of the content, returning its unregistration; stable across renders.
	const [registerActions] = useState(() => () => {
		setActions((n) => n + 1)
		return () => setActions((n) => n - 1)
	})

	useEffect(() => {
		const dialog = dialogRef.current
		if (!dialog || open === dialog.open) return

		if (open) {
			dialog.showModal()
			dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus()
		} else {
			dialog.close()
		}
	}, [open])

	return (
		<dialog
			ref={dialogRef}
			onCancel={(e) => {
				e.preventDefault()
				onClose()
			}}
			onMouseDown={(e) => {
				pressedOnBackdrop.current = e.target === e.currentTarget
			}}
			onClick={(e) => pressedOnBackdrop.current && e.target === e.currentTarget && onClose()}
			className="fixed inset-0 m-0 box-border size-full max-h-none max-w-none overflow-y-auto overscroll-contain border-0 bg-scrim/72 p-6 font-mono whitespace-normal text-ink-100 opacity-100 backdrop-blur-xs transition-opacity duration-150 backdrop:bg-transparent open:flex max-sm:items-end max-sm:p-2 starting:open:opacity-0 motion-reduce:transition-none"
		>
			<section
				className={cn(
					'relative mx-auto mt-[8vh] mb-auto box-border flex w-full flex-col rounded-xl border border-line-100 bg-base-200 shadow-[0_24px_64px_rgb(0_0_0/0.55)] transition-transform duration-150 max-sm:mt-auto max-sm:mb-0 starting:translate-y-2 starting:scale-98 motion-reduce:transition-none',
					fit && 'max-h-full sm:max-h-[calc(100%-8vh)]',
					className,
				)}
			>
				<header className="flex items-start gap-4 px-6 pt-6">
					<h2 className="m-0 min-w-0 flex-1 text-xl leading-7 font-semibold tracking-[-0.01em] text-ink-100">{title}</h2>
					<button
						type="button"
						title="Close"
						onClick={onClose}
						className="-mt-1 -mr-2 flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-200 transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						<Icon name="close" strokeWidth={1.8} />
						<span className="sr-only">Close</span>
					</button>
				</header>
				<ModalActionsContext value={registerActions}>
					<div className={cn('px-6 pt-4 pb-6 leading-6 text-ink-200', fit && 'flex min-h-0 flex-col')}>{children}</div>
				</ModalActionsContext>
				{actions === 0 && (
					<div className="flex-none px-6 pb-6 sm:hidden">
						<Button variant="secondary" className="w-full" onClick={onClose}>
							Close
						</Button>
					</div>
				)}
			</section>
		</dialog>
	)
}

// Buttons that close a dialog's content, aligned to the end and wrapping on narrow screens; the button the dialog
// proposes comes last. While mounted, they replace the Close button the Modal adds below 640 px.
export function ModalActions({ children }: { readonly children: ReactNode }) {
	const register = useContext(ModalActionsContext)

	// Tells the Modal holding these actions that its content closes itself from the bottom.
	useLayoutEffect(() => register?.(), [register])

	return <div className="mt-5 flex flex-wrap justify-end gap-2">{children}</div>
}
