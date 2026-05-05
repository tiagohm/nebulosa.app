import { type ClassValue, tv, type VariantProps } from 'tailwind-variants'
import { tw } from '@/shared/util'

const linkStyles = tv({
	slots: {
		base: 'inline-block min-w-0 text-center transition',
		anchor: 'inline-block max-w-full min-w-0 truncate outline-none transition',
	},
	variants: {
		size: {
			sm: {
				base: 'text-xs',
			},
			md: {
				base: 'text-sm',
			},
			lg: {
				base: 'text-base',
			},
		},
		color: {
			default: {
				base: '[--color-variant:var(--color-neutral-500)] text-neutral-500 hover:text-neutral-300',
			},
			primary: {
				base: '[--color-variant:var(--primary)] text-(--color-variant) hover:text-lighter-(--color-variant)/80',
			},
			secondary: {
				base: '[--color-variant:var(--secondary)] text-(--color-variant) hover:text-lighter-(--color-variant)/80',
			},
			success: {
				base: '[--color-variant:var(--success)] text-(--color-variant) hover:text-lighter-(--color-variant)/80',
			},
			danger: {
				base: '[--color-variant:var(--danger)] text-(--color-variant) hover:text-lighter-(--color-variant)/80',
			},
			warning: {
				base: '[--color-variant:var(--warning)] text-(--color-variant) hover:text-lighter-(--color-variant)/80',
			},
		},
		fullWidth: {
			true: {
				base: 'w-full',
			},
			false: {
				base: 'w-auto',
			},
		},
		underline: {
			true: {
				anchor: 'underline underline-offset-2',
			},
		},
		disabled: {
			true: {
				base: 'cursor-not-allowed opacity-40 pointer-events-none',
			},
			false: {
				base: 'cursor-pointer',
			},
		},
		readOnly: {
			true: {
				base: 'cursor-default opacity-90 pointer-events-none',
			},
		},
	},
	defaultVariants: {
		size: 'sm',
		color: 'default',
		fullWidth: true,
		disabled: false,
	},
})

type LinkVariants = VariantProps<typeof linkStyles>
type AnchorTarget = React.ComponentPropsWithRef<'a'>['target']
type AnchorRel = React.ComponentPropsWithRef<'a'>['rel']

export interface LinkClassNames {
	readonly base?: ClassValue
	readonly anchor?: ClassValue
}

export interface LinkProps extends Omit<React.ComponentPropsWithRef<'a'>, 'color'>, LinkVariants {
	readonly classNames?: LinkClassNames
	readonly disabled?: boolean
	readonly label?: React.ReactNode
	readonly readOnly?: boolean
}

// Normalizes rel tokens for links that open outside the current tab.
function secureRel(target: AnchorTarget, rel: AnchorRel) {
	const tokens = new Set((rel ?? '').split(/\s+/).filter(Boolean))

	if (target === '_blank') {
		tokens.add('noreferrer')
		tokens.add('noopener')
	}

	return tokens.size === 0 ? undefined : [...tokens].join(' ')
}

// Render a compact external link with variant-aware shared styling.
export function Link({ label, className, classNames, children, color, disabled = false, fullWidth, href, readOnly = false, ref, rel, size, target = '_blank', underline, ...props }: LinkProps) {
	const blocked = disabled || readOnly
	const linkTarget = blocked ? undefined : target
	const styles = linkStyles({ color, disabled, fullWidth, readOnly: !disabled && readOnly, size, underline })

	return (
		<span className={tw(styles.base(), className, classNames?.base)}>
			<a {...props} className={tw(styles.anchor(), classNames?.anchor)} href={blocked ? undefined : href} ref={ref} rel={secureRel(linkTarget, rel)} target={linkTarget}>
				{children ?? label}
			</a>
		</span>
	)
}
