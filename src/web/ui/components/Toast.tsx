import { useEffect, useSyncExternalStore } from 'react'
import { tv } from 'tailwind-variants'
import { dismissToast, readToasts, subscribeToasts, TOAST_PLACEMENTS, type ToastPlacement, type ToastProviderDefaults, type ToastRecord, toast, updateToastDefaults } from '@/shared/toast'
import { stopPropagation, tw } from '@/shared/util'
import { Icons } from '../Icon'

const toastStyles = tv({
	slots: {
		toast: 'pointer-events-auto flex w-full items-center gap-3 rounded-lg shadow-black/40 backdrop-blur-sm transition bg-neutral-900/95 text-neutral-100',
		startContent: 'flex shrink-0 items-center justify-center text-(--color-variant)',
		content: 'min-w-0 flex-1',
		title: 'min-w-0 font-bold leading-none text-(--color-variant)',
		description: 'min-w-0 whitespace-pre-wrap text-neutral-200',
		endContent: 'flex shrink-0 items-center gap-1 text-(--color-variant)',
		closeButton: 'flex shrink-0 items-center justify-center rounded-md outline-none transition cursor-pointer text-(--color-variant) hover:bg-(--color-variant)/10',
	},
	variants: {
		size: {
			sm: {
				toast: 'px-3 py-2',
				startContent: 'text-sm',
				title: 'text-xs',
				description: 'mt-1 text-xs',
				endContent: 'text-sm',
				closeButton: 'size-7 text-sm',
			},
			md: {
				toast: 'px-4 py-3',
				startContent: 'text-base',
				title: 'text-sm',
				description: 'mt-1 text-sm',
				endContent: 'text-base',
				closeButton: 'size-8 text-base',
			},
			lg: {
				toast: 'px-5 py-4',
				startContent: 'text-lg',
				title: 'text-base',
				description: 'mt-1 text-base',
				endContent: 'text-lg',
				closeButton: 'size-9 text-lg',
			},
		},
		color: {
			primary: {
				toast: '[--color-variant:var(--primary)]',
			},
			secondary: {
				toast: '[--color-variant:var(--secondary)]',
			},
			success: {
				toast: '[--color-variant:var(--success)]',
			},
			warning: {
				toast: '[--color-variant:var(--warning)]',
			},
			danger: {
				toast: '[--color-variant:var(--danger)]',
			},
		},
	},
	defaultVariants: {
		color: 'primary',
		size: 'md',
	},
})

const toastViewportClasses: Record<ToastPlacement, string> = {
	'top-start': 'left-0 top-0 items-start',
	top: 'left-1/2 top-0 -translate-x-1/2 items-center',
	'top-end': 'right-0 top-0 items-end',
	'bottom-start': 'bottom-0 left-0 flex-col-reverse items-start',
	bottom: 'bottom-0 left-1/2 flex-col-reverse -translate-x-1/2 items-center',
	'bottom-end': 'bottom-0 right-0 flex-col-reverse items-end',
}

export interface ToastProviderProps extends ToastProviderDefaults {
	readonly children?: React.ReactNode
	readonly maxVisible?: number
}

// Renders a single toast item and owns its auto-dismiss timer.
function ToastItem({ className, color, delay, description, endContent, id, onClose, size, startContent, title, ...props }: ToastRecord) {
	const styles = toastStyles({ color, size })
	const closeButtonVisible = onClose !== undefined || delay <= 0

	// Dismisses the toast once its timeout elapses.
	useEffect(() => {
		if (delay <= 0) return

		const timer = window.setTimeout(() => {
			dismissToast(id, true)
		}, delay)

		return () => {
			window.clearTimeout(timer)
		}
	}, [delay, id])

	// Dismisses the toast without bubbling into the toast root handlers.
	function handleClose(event: React.PointerEvent<HTMLButtonElement>) {
		event.stopPropagation()
		dismissToast(id, false)
	}

	return (
		<div {...props} className={tw(styles.toast(), className, props.onPointerUp !== undefined || props.onClick !== undefined ? 'cursor-pointer' : undefined)}>
			{startContent !== undefined && startContent !== null && <div className={tw(styles.startContent())}>{startContent}</div>}
			<div className={tw(styles.content())}>
				{title !== undefined && title !== null && <div className={tw(styles.title())}>{title}</div>}
				{description !== undefined && description !== null && <div className={tw(styles.description(), (title === undefined || title === null) && 'mt-0')}>{description}</div>}
			</div>
			{endContent !== undefined && endContent !== null && <div className={tw(styles.endContent())}>{endContent}</div>}
			{closeButtonVisible && (
				<button className={tw(styles.closeButton())} onClick={stopPropagation} onPointerDown={handleClose} onPointerUp={stopPropagation} type="button">
					<Icons.Close />
				</button>
			)}
		</div>
	)
}

// Renders the toast stack for a single placement bucket.
function ToastViewport({ maxVisible, placement, toasts }: { readonly maxVisible?: number; readonly placement: ToastPlacement; readonly toasts: readonly ToastRecord[] }) {
	const visibleToasts = maxVisible !== undefined && maxVisible > 0 ? toasts.slice(0, maxVisible) : toasts

	if (visibleToasts.length === 0) return null

	return (
		<div className={tw('pointer-events-none fixed z-10000002 flex flex-col w-[min(calc(100vw-1rem),24rem)] max-w-full gap-2 p-2 sm:p-4', toastViewportClasses[placement])}>
			{visibleToasts.map((toast) => (
				<ToastItem key={toast.id} {...toast} />
			))}
		</div>
	)
}

// Renders the shared toast view layer and updates the global provider defaults.
export function ToastProvider({ children, maxVisible, ...defaults }: ToastProviderProps) {
	const toasts = useSyncExternalStore(subscribeToasts, readToasts, readToasts)

	// Keeps the global toast defaults aligned with the mounted provider props.
	useEffect(() => {
		updateToastDefaults(defaults)
	})

	return (
		<>
			{children}
			{TOAST_PLACEMENTS.map((placement) => (
				<ToastViewport key={placement} maxVisible={maxVisible} placement={placement} toasts={toasts.filter((toast) => toast.placement === placement)} />
			))}
		</>
	)
}

export { toast }
