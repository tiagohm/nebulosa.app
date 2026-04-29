import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'
import { Icons } from '../Icon'
import { Tooltip, type TooltipPlacement } from './Tooltip'

const buttonStyles = tv({
	slots: {
		base: ['inline-flex min-w-0 items-center justify-center gap-2 rounded-lg font-normal transition select-none', 'focus-visible:outline-none focus-visible:ring-0'],
		startContent: 'flex shrink-0 items-center justify-center',
		loadingIcon: 'shrink-0 spin',
		label: 'min-w-0 truncate text-center w-full',
		endContent: 'flex shrink-0 items-center justify-center',
	},
	variants: {
		variant: {
			solid: {
				base: 'bg-(--color-variant) text-white hover:bg-(--color-variant)/90 active:bg-(--color-variant)/85',
			},
			outline: {
				base: 'border border-(--color-variant) text-(--color-variant) bg-transparent hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			},
			ghost: {
				base: 'text-(--color-variant) bg-transparent hover:bg-(--color-variant)/20 active:bg-(--color-variant)/15',
			},
			flat: {
				base: 'text-(--color-variant) bg-(--color-variant)/20 hover:bg-(--color-variant)/15 active:bg-(--color-variant)/10',
			},
		},
		size: {
			sm: {
				base: 'h-8 min-w-8 px-2 text-sm',
				startContent: 'text-sm',
				loadingIcon: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
			},
			md: {
				base: 'h-10 min-w-10 px-2 text-sm',
				startContent: 'text-sm',
				loadingIcon: 'text-sm',
				label: 'text-sm',
				endContent: 'text-sm',
			},
			lg: {
				base: 'h-11 min-w-11 px-2 text-base',
				startContent: 'text-base',
				loadingIcon: 'text-base',
				label: 'text-base',
				endContent: 'text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				base: '[--color-variant:var(--primary)]',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)]',
			},
			success: {
				base: '[--color-variant:var(--success)]',
			},
			danger: {
				base: '[--color-variant:var(--danger)]',
			},
			warning: {
				base: '[--color-variant:var(--warning)]',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
		},
	},
	defaultVariants: {
		variant: 'flat',
		size: 'md',
		color: 'primary',
	},
})

type ButtonVariants = VariantProps<typeof buttonStyles>

export interface ButtonClassNames {
	readonly base?: ClassValue
	readonly startContent?: ClassValue
	readonly loadingIcon?: ClassValue
	readonly label?: ClassValue
	readonly endContent?: ClassValue
}

export interface ButtonProps extends Omit<React.ComponentPropsWithRef<'div'>, 'color' | 'readOnly'>, ButtonVariants {
	readonly classNames?: ButtonClassNames
	readonly label?: React.ReactNode
	readonly loading?: boolean
	readonly disabled?: boolean
	readonly readOnly?: boolean
	readonly startContent?: React.ReactNode
	readonly endContent?: React.ReactNode
	readonly tooltipContent?: React.ReactNode
	readonly tooltipDisabled?: boolean
	readonly tooltipPlacement?: TooltipPlacement
	readonly hideChildrenOnLoading?: boolean
}

// Render the shared button surface with variant-aware color styling.
export function Button({ children, className, classNames, color, disabled = false, endContent, fullWidth, hideChildrenOnLoading, label, loading = false, readOnly = false, ref, size, startContent, tabIndex, tooltipContent, tooltipDisabled, tooltipPlacement, variant, ...props }: ButtonProps) {
	const styles = buttonStyles({ variant, size, color, fullWidth })
	const hasChildren = children !== undefined && children !== null
	const content = hasChildren ? children : label
	const blocked = disabled || loading || readOnly
	const stateClassName = disabled ? 'cursor-not-allowed opacity-40 pointer-events-none' : loading ? 'cursor-progress opacity-40 pointer-events-none' : readOnly ? 'cursor-default opacity-90 pointer-events-none' : 'cursor-pointer'
	const showContent = !(loading && hideChildrenOnLoading)
	const labelContent = showContent && content !== undefined && content !== null ? hasChildren ? content : <span className={tw(styles.label(), classNames?.label)}>{content}</span> : undefined

	return (
		<Tooltip content={tooltipContent} disabled={blocked || tooltipDisabled} placement={tooltipPlacement}>
			<div {...props} className={tw(styles.base(), stateClassName, className, classNames?.base)} ref={ref} role="button" tabIndex={blocked ? undefined : (tabIndex ?? 0)}>
				{/* Swap the leading content for a spinner while loading. */}
				{loading ? <Icons.Loading className={tw(styles.loadingIcon(), classNames?.loadingIcon)} /> : startContent !== undefined && startContent !== null && <span className={tw(styles.startContent(), classNames?.startContent)}>{startContent}</span>}
				{labelContent}
				{endContent !== undefined && endContent !== null && <span className={tw(styles.endContent(), classNames?.endContent)}>{endContent}</span>}
			</div>
		</Tooltip>
	)
}
