import type * as React from 'react'
import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const badgeStyles = tv({
	slots: {
		base: 'relative inline-flex w-fit max-w-full align-middle',
		badge: 'absolute z-10 flex shrink-0 items-center justify-center rounded-full bg-(--color-variant) text-white leading-none shadow-sm pointer-events-none select-none',
		label: 'min-w-0 truncate font-medium leading-none',
	},
	variants: {
		size: {
			sm: {
				badge: 'h-4 min-w-4 px-1 text-[10px]',
				label: 'max-w-16',
			},
			md: {
				badge: 'h-5 min-w-5 px-1.5 text-xs',
				label: 'max-w-20',
			},
			lg: {
				badge: 'h-6 min-w-6 px-2 text-sm',
				label: 'max-w-24',
			},
		},
		color: {
			default: {
				badge: '[--color-variant:var(--color-neutral-500)]',
			},
			primary: {
				badge: '[--color-variant:var(--primary)]',
			},
			secondary: {
				badge: '[--color-variant:var(--secondary)]',
			},
			success: {
				badge: '[--color-variant:var(--success)]',
			},
			danger: {
				badge: '[--color-variant:var(--danger)]',
			},
			warning: {
				badge: '[--color-variant:var(--warning)]',
			},
		},
		placement: {
			'top-end': {
				badge: 'top-0 right-0 translate-x-1/2 -translate-y-1/2',
			},
			'top-start': {
				badge: 'top-0 left-0 -translate-x-1/2 -translate-y-1/2',
			},
			'bottom-end': {
				badge: 'right-0 bottom-0 translate-x-1/2 translate-y-1/2',
			},
			'bottom-start': {
				badge: 'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
			},
		},
	},
	defaultVariants: {
		size: 'md',
		color: 'primary',
		placement: 'top-end',
	},
})

const badgeDotStyles = tv({
	base: 'min-w-0 p-0',
	variants: {
		size: {
			sm: 'size-2',
			md: 'size-2.5',
			lg: 'size-3',
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

export interface BadgeClassNames {
	readonly base?: ClassValue
	readonly badge?: ClassValue
	readonly label?: ClassValue
}

type BadgeVariants = VariantProps<typeof badgeStyles>

export interface BadgeProps extends Omit<React.ComponentPropsWithRef<'div'>, 'color'>, BadgeVariants {
	readonly classNames?: BadgeClassNames
	readonly label?: React.ReactNode
	readonly visible?: boolean
}

// Detects whether the badge should render text or collapse to a dot.
function hasBadgeLabel(label: React.ReactNode) {
	return label !== undefined && label !== null && label !== false && label !== true && label !== ''
}

// Render a positioned badge around child content or a standalone dot indicator.
export function Badge({ children, className, classNames, color, label, placement, ref, size, visible = true, ...props }: BadgeProps) {
	const hasChildren = children !== undefined && children !== null

	if (!hasChildren && !visible) return null

	const labeled = hasBadgeLabel(label)
	const styles = badgeStyles({ color, placement, size })
	const dotClassName = labeled ? undefined : badgeDotStyles({ size })
	const standaloneClassName = hasChildren ? undefined : 'static translate-x-0 translate-y-0'

	return (
		<div {...props} className={tw(styles.base(), className, classNames?.base)} ref={ref}>
			{children}
			{visible && <span className={tw(styles.badge(), dotClassName, standaloneClassName, classNames?.badge)}>{labeled && <span className={tw(styles.label(), classNames?.label)}>{label}</span>}</span>}
		</div>
	)
}
