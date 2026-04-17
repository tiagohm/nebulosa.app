import clsx from 'clsx'
import type * as React from 'react'
import { tv, type VariantProps } from 'tailwind-variants'
import { Icons } from '../Icon'
import { Tooltip, type TooltipPlacement } from './Tooltip'

const buttonStyles = tv({
	base: ['inline-flex items-center justify-between gap-2 rounded-md font-normal cursor-pointer', 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2', 'disabled:pointer-events-none disabled:opacity-50'],
	variants: {
		variant: {
			solid: ' text-white',
			outline: 'border border-default bg-transparent hover:bg-default/5',
			ghost: 'hover:bg-default/5',
		},
		size: {
			sm: 'h-8 px-3 text-sm',
			md: 'h-10 px-4 text-sm',
			lg: 'h-11 px-6 text-base',
		},
		color: {
			primary: 'bg-blue-600 hover:bg-blue-600/90',
			secondary: 'bg-purple-600 hover:bg-purple-600/90',
			success: 'bg-green-600 hover:bg-green-600/90',
			danger: 'bg-red-600 hover:bg-red-600/90',
			warning: 'bg-amber-600 hover:bg-amber-600/90',
		},
		fullWidth: {
			true: 'w-full',
		},
	},
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

export function Button({ className, variant, size, color, fullWidth, disabled, label, loading, startContent, endContent, tooltipContent, tooltipDisabled, tooltipPlacement, children, ref, ...props }: ButtonProps) {
	return (
		<Tooltip content={tooltipContent} disabled={tooltipDisabled} placement={tooltipPlacement}>
			<div className={buttonStyles({ variant, size, color, fullWidth, className: clsx(className, { 'opacity-50 pointer-events-none': disabled || loading === true }) })} ref={ref} {...props}>
				{loading === true ? <Icons.Loading className='spin' /> : startContent}
				{label ?? children}
				{endContent}
			</div>
		</Tooltip>
	)
}
