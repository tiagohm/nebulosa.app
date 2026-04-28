import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { stopPropagation, tw } from '@/shared/util'
import { Icons } from '../Icon'

const chipStyles = tv({
	slots: {
		base: 'inline-flex max-w-full items-center gap-1.5 rounded-full border align-top whitespace-nowrap select-none transition',
		startContent: 'flex shrink-0 items-center justify-center',
		label: 'min-w-0 truncate font-medium leading-none',
		endContent: 'flex shrink-0 items-center justify-center',
		closeButton: 'flex shrink-0 items-center justify-center rounded-full outline-none transition cursor-pointer',
	},
	variants: {
		size: {
			sm: {
				base: 'min-h-6 px-2',
				startContent: 'text-xs',
				label: 'text-xs',
				endContent: 'text-xs',
				closeButton: 'size-4 text-xs',
			},
			md: {
				base: 'min-h-7 px-2.5',
				startContent: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
				closeButton: 'size-5 text-sm',
			},
			lg: {
				base: 'min-h-8 px-3',
				startContent: 'text-base',
				label: 'text-base',
				endContent: 'text-base',
				closeButton: 'size-6 text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			primary: {
				base: '[--color-variant:var(--primary)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			success: {
				base: '[--color-variant:var(--success)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			danger: {
				base: '[--color-variant:var(--danger)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
			warning: {
				base: '[--color-variant:var(--warning)] border-(--color-variant)/30 bg-(--color-variant)/15 text-(--color-variant)',
				startContent: 'text-(--color-variant)',
				label: 'text-(--color-variant)',
				endContent: 'text-(--color-variant)',
				closeButton: 'text-(--color-variant) hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
	},
})

export interface ChipClassNames {
	readonly base?: ClassValue
	readonly startContent?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
	readonly closeButton?: ClassValue
}

type ChipVariants = VariantProps<typeof chipStyles>

export interface ChipProps extends Omit<React.ComponentPropsWithRef<'div'>, 'children' | 'color' | 'onClose'>, ChipVariants {
	readonly children?: React.ReactNode
	readonly classNames?: ChipClassNames
	readonly label?: React.ReactNode
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly onClose?: (event: React.MouseEvent<HTMLButtonElement>) => void
}

// Render a compact, color-aware chip with optional adornments and close action.
export function Chip({ children, className, classNames, color, disabled = false, endContent, label, onClose, readOnly = false, ref, size, startContent, ...props }: ChipProps) {
	const content = children ?? label
	const styles = chipStyles({ color, size })
	const hasRootInteraction = props.onClick !== undefined || props.onPointerDown !== undefined || props.onPointerUp !== undefined || props.onDoubleClick !== undefined || props.onContextMenu !== undefined
	const stateClassName = disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : readOnly ? 'cursor-default opacity-90 pointer-events-none' : hasRootInteraction ? 'cursor-pointer' : 'cursor-default'

	// Reports close requests without letting the event bubble into the chip root.
	function handleClose(event: React.PointerEvent<HTMLButtonElement>) {
		event.stopPropagation()
		if (disabled || readOnly || onClose === undefined) return
		onClose(event)
	}

	return (
		<div {...props} className={tw(styles.base(), stateClassName, className, classNames?.base)} ref={ref}>
			{startContent !== undefined && startContent !== null && <span className={tw(styles.startContent(), classNames?.startContent)}>{startContent}</span>}
			{content !== undefined && content !== null && <span className={tw(styles.label(), classNames?.label)}>{content}</span>}
			{endContent !== undefined && endContent !== null && <span className={tw(styles.endContent(), classNames?.endContent)}>{endContent}</span>}
			{onClose !== undefined && (
				<button className={tw(styles.closeButton(), classNames?.closeButton)} onClick={stopPropagation} onPointerDown={handleClose} onPointerUp={stopPropagation} type="button">
					<Icons.Close />
				</button>
			)}
		</div>
	)
}
