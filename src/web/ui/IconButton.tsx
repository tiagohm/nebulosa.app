import { tw } from '@/shared/util'
import { Button, type ButtonProps } from './components/Button'
import type { Icon } from './Icon'

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
	readonly icon: Icon
	readonly label?: string
	readonly iconSize?: string | number
	readonly isRounded?: boolean
}

export function IconButton({ icon: Icon, className, label, size = 'md', variant = 'ghost', iconSize, isRounded, ...props }: IconButtonProps) {
	return (
		<Button className={tw('inline-flex flex-row items-center gap-1', isRounded && 'rounded-full', className)} {...props} size={size} variant={variant}>
			<Icon size={iconSize} />
			{label && <span>{label}</span>}
		</Button>
	)
}
