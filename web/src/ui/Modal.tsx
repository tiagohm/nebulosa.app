import { cn } from 'cn'
import { type ReactNode, useEffect, useRef } from 'react'
import { Icon } from './Icon'

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
// The dialog fills the viewport and scrolls, so the panel inside it can grow freely.
export function Modal({ open, onClose, title, className, fit = false, children }: ModalProps) {
	const dialogRef = useRef<HTMLDialogElement>(null)
	// A click only closes when it both starts and ends on the backdrop.
	const pressedOnBackdrop = useRef(false)

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
			className="fixed inset-0 m-0 box-border size-full max-h-none max-w-none overflow-y-auto overscroll-contain border-0 bg-[rgb(10_10_9/0.72)] p-6 font-mono text-ink-100 opacity-100 backdrop-blur-[3px] transition-opacity duration-150 backdrop:bg-transparent open:flex max-sm:items-end max-sm:p-2 starting:open:opacity-0 motion-reduce:transition-none"
		>
			<section className={cn('relative m-auto box-border flex w-full flex-col rounded-xl border border-line-100 bg-base-200 shadow-[0_24px_64px_rgb(0_0_0/0.55)] transition-transform duration-150 max-sm:mb-0 starting:translate-y-2 starting:scale-98 motion-reduce:transition-none', fit && 'max-h-full', className)}>
				<header className="flex items-start gap-4 px-6 pt-6">
					<h2 className="m-0 min-w-0 flex-1 text-xl leading-7 font-semibold tracking-[-0.01em] text-ink-100">{title}</h2>
					<button
						type="button"
						onClick={onClose}
						className="-mt-1 -mr-2 flex size-8 flex-none cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 text-ink-200 transition-colors duration-150 hover:bg-base-300 hover:text-ink-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
					>
						<Icon name="close" strokeWidth={1.8} />
					</button>
				</header>
				<div className={cn('px-6 pt-4 pb-6 text-[15px] leading-6 text-ink-200', fit && 'flex min-h-0 flex-col')}>{children}</div>
			</section>
		</dialog>
	)
}
