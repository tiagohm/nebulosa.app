import type { ComponentProps } from 'react'
import { tv } from 'tailwind-variants'
import { Icon, type IconName } from './Icon'

// Compact square button showing only an icon, for toolbars and panel headers. The label is the tooltip
// and is also read by assistive technology through visually hidden text.

// Styles of the button, plain or pressed (a toggle that is on).
const iconButton = tv({
	base: 'relative flex size-8 flex-none cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent p-0 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:text-ink-300 disabled:hover:bg-transparent motion-reduce:transition-none',
	variants: {
		pressed: {
			true: 'bg-accent-subtle text-accent hover:bg-accent-subtle',
			false: 'text-ink-200 hover:bg-base-300 hover:text-ink-100',
		},
	},
	defaultVariants: { pressed: false },
})

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'title'> {
	// Icon to draw.
	readonly icon: IconName
	// Action name, shown as the tooltip and read as the button's text.
	readonly label: string
	// Whether a toggle is on; plain buttons leave it unset.
	readonly pressed?: boolean
}

// Icon-only button with a tooltip.
export function IconButton({ icon, label, pressed, className, type = 'button', ...props }: IconButtonProps) {
	return (
		<button type={type} title={label} className={iconButton({ pressed, className })} {...props}>
			<Icon name={icon} className="size-[18px]" />
			<span className="sr-only">{label}</span>
		</button>
	)
}
