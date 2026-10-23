import type { ComponentProps } from 'react'
import { tv, type VariantProps } from 'tailwind-variants'

const button = tv({
	base: 'inline-flex cursor-pointer items-center justify-center gap-2 border border-transparent font-medium whitespace-break-spaces transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:border-transparent disabled:bg-base-300 disabled:text-ink-300',
	variants: {
		variant: {
			primary: 'bg-accent text-on-accent hover:bg-accent-hover',
			secondary: 'border-line-200 bg-transparent text-ink-100 hover:border-ink-300 hover:bg-base-300',
			ghost: 'bg-transparent text-accent hover:bg-accent-subtle',
		},
		size: {
			sm: 'rounded-sm px-3 py-1 text-[13px] leading-5',
			md: 'rounded-md px-4 py-2 text-sm leading-5',
		},
	},
	defaultVariants: {
		variant: 'primary',
		size: 'md',
	},
})

export interface ButtonProps extends ComponentProps<'button'>, VariantProps<typeof button> {}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
	return <button type={type} className={button({ variant, size, className })} {...props} />
}
