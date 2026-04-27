import clsx from 'clsx'
import type * as React from 'react'
import { tv, type VariantProps } from 'tailwind-variants'
import { Icons } from '../Icon'
import { Tooltip, type TooltipPlacement } from './Tooltip'

const buttonStyles = tv({
	base: ['inline-flex items-center justify-center gap-2 rounded-lg font-normal cursor-pointer', 'focus-visible:outline-none focus-visible:ring-0', 'disabled:pointer-events-none disabled:opacity-50'],
	variants: {
		variant: {
			solid: 'bg-(--color-variant) text-white hover:bg-(--color-variant)/90 active:bg-(--color-variant)/85',
			outline: 'border border-(--color-variant) text-(--color-variant) bg-transparent hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			ghost: 'text-(--color-variant) bg-transparent hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			flat: 'text-(--color-variant) bg-(--color-variant)/20 hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
		},
		size: {
			sm: 'h-8 min-w-8 px-2 text-sm',
			md: 'h-10 min-w-10 px-2 text-sm',
			lg: 'h-11 min-w-11 px-2 text-base',
		},
		color: {
			default: '[--color-variant:var(--color-neutral-500)]',
			primary: '[--color-variant:var(--primary)]',
			secondary: '[--color-variant:var(--secondary)]',
			success: '[--color-variant:var(--success)]',
			danger: '[--color-variant:var(--danger)]',
			warning: '[--color-variant:var(--warning)]',
		},
		fullWidth: {
			true: 'w-full',
		},
	},
	defaultVariants: {
		variant: 'flat',
		size: 'md',
		color: 'primary',
	},
})

type ButtonVariants = VariantProps<typeof buttonStyles>

export interface ButtonProps extends Omit<React.ComponentPropsWithRef<'div'>, 'color'>, ButtonVariants {
	readonly label?: React.ReactNode
	readonly loading?: boolean
	readonly disabled?: boolean
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly tooltipContent?: React.ReactNode
	readonly tooltipDisabled?: boolean
	readonly tooltipPlacement?: TooltipPlacement
	readonly hideChildrenOnLoading?: boolean
}

// Render the shared button surface with variant-aware color styling.
export function Button({ className, variant, size, color, fullWidth, disabled, label, loading, startContent, endContent, tooltipContent, tooltipDisabled, tooltipPlacement, children, hideChildrenOnLoading, ref, ...props }: ButtonProps) {
	return (
		<Tooltip content={tooltipContent} disabled={tooltipDisabled} placement={tooltipPlacement}>
			<div className={buttonStyles({ variant, size, color, fullWidth, className: clsx(className, { 'opacity-40 pointer-events-none': disabled || loading === true }) })} ref={ref} role="button" tabIndex={0} {...props}>
				{/* Swap the leading content for a spinner while loading. */}
				{loading === true ? <Icons.Loading className="spin" /> : startContent}
				{loading === true && hideChildrenOnLoading === true ? undefined : (label ?? children)}
				{endContent}
			</div>
		</Tooltip>
	)
}
