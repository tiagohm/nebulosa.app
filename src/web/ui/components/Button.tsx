import clsx from 'clsx'
import type * as React from 'react'
import { tv, type VariantProps } from 'tailwind-variants'
import { Icons } from '../Icon'
import { Tooltip, type TooltipPlacement } from './Tooltip'

const buttonStyles = tv({
	base: ['inline-flex items-center justify-between gap-2 rounded-lg font-normal cursor-pointer', 'focus-visible:outline-none focus-visible:ring-0', 'disabled:pointer-events-none disabled:opacity-50'],
	variants: {
		variant: {
			solid: '',
			outline: 'border bg-transparent',
			ghost: 'bg-transparent',
			flat: '',
		},
		size: {
			sm: 'h-8 px-3 text-sm',
			md: 'h-10 px-4 text-sm',
			lg: 'h-11 px-6 text-base',
		},
		color: {
			primary: '',
			secondary: '',
			success: '',
			danger: '',
			warning: '',
		},
		fullWidth: {
			true: 'w-full',
		},
	},
	compoundVariants: [
		// Keep solid colors isolated so outline, ghost, and flat do not inherit filled backgrounds.
		{ variant: 'solid', color: 'primary', class: 'bg-blue-600 text-white hover:bg-blue-600/90 active:bg-blue-600/85' },
		{ variant: 'solid', color: 'secondary', class: 'bg-indigo-600 text-white hover:bg-indigo-600/90 active:bg-indigo-600/85' },
		{ variant: 'solid', color: 'success', class: 'bg-green-600 text-white hover:bg-green-600/90 active:bg-green-600/85' },
		{ variant: 'solid', color: 'danger', class: 'bg-red-600 text-white hover:bg-red-600/90 active:bg-red-600/85' },
		{ variant: 'solid', color: 'warning', class: 'bg-amber-600 text-white hover:bg-amber-600/90 active:bg-amber-600/85' },
		{ variant: 'outline', color: 'primary', class: 'border-blue-600 text-blue-600 hover:bg-blue-600/20 active:bg-blue-600/15' },
		{ variant: 'outline', color: 'secondary', class: 'border-indigo-600 text-indigo-600 hover:bg-indigo-600/20 active:bg-indigo-600/15' },
		{ variant: 'outline', color: 'success', class: 'border-green-600 text-green-600 hover:bg-green-600/20 active:bg-green-600/15' },
		{ variant: 'outline', color: 'danger', class: 'border-red-600 text-red-600 hover:bg-red-600/20 active:bg-red-600/15' },
		{ variant: 'outline', color: 'warning', class: 'border-amber-600 text-amber-600 hover:bg-amber-600/20 active:bg-amber-600/15' },
		{ variant: 'ghost', color: 'primary', class: 'text-blue-600 hover:bg-blue-600/20 active:bg-blue-600/15' },
		{ variant: 'ghost', color: 'secondary', class: 'text-indigo-600 hover:bg-indigo-600/20 active:bg-indigo-600/15' },
		{ variant: 'ghost', color: 'success', class: 'text-green-600 hover:bg-green-600/20 active:bg-green-600/15' },
		{ variant: 'ghost', color: 'danger', class: 'text-red-600 hover:bg-red-600/20 active:bg-red-600/15' },
		{ variant: 'ghost', color: 'warning', class: 'text-amber-600 hover:bg-amber-600/20 active:bg-amber-600/15' },
		{ variant: 'flat', color: 'primary', class: 'bg-blue-600/15 text-blue-700 hover:bg-blue-600/20 active:bg-blue-600/15' },
		{ variant: 'flat', color: 'secondary', class: 'bg-indigo-600/15 text-indigo-700 hover:bg-indigo-600/20 active:bg-indigo-600/15' },
		{ variant: 'flat', color: 'success', class: 'bg-green-600/15 text-green-700 hover:bg-green-600/20 active:bg-green-600/15' },
		{ variant: 'flat', color: 'danger', class: 'bg-red-600/15 text-red-700 hover:bg-red-600/20 active:bg-red-600/15' },
		{ variant: 'flat', color: 'warning', class: 'bg-amber-600/15 text-amber-700 hover:bg-amber-600/20 active:bg-amber-600/15' },
	],
	defaultVariants: {
		variant: 'solid',
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
}

// Render the shared button surface with variant-aware color styling.
export function Button({ className, variant, size, color, fullWidth, disabled, label, loading, startContent, endContent, tooltipContent, tooltipDisabled, tooltipPlacement, children, ref, ...props }: ButtonProps) {
	return (
		<Tooltip content={tooltipContent} disabled={tooltipDisabled} placement={tooltipPlacement}>
			<div className={buttonStyles({ variant, size, color, fullWidth, className: clsx(className, { 'opacity-50 pointer-events-none': disabled || loading === true }) })} ref={ref} {...props}>
				{/* Swap the leading content for a spinner while loading. */}
				{loading === true ? <Icons.Loading className='spin' /> : startContent}
				{label ?? children}
				{endContent}
			</div>
		</Tooltip>
	)
}
