import { Button, type ButtonProps } from '@heroui/react'
import type { Icon } from './Icon'

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
	readonly icon: Icon
	readonly label?: string
	readonly iconSize?: string | number
	readonly isRounded?: boolean
}

export function IconButton({ icon: Icon, className, label, isIconOnly = true, size = 'md', variant = 'light', iconSize, isRounded: rounded, ...props }: IconButtonProps) {
	return (
		<Button className={`${rounded ? 'rounded-full' : ''} inline-flex flex-row items-center gap-1 ${className}`} {...props} isIconOnly={!label && isIconOnly} size={size} variant={variant}>
			<Icon size={iconSize} />
			{label && <span>{label}</span>}
		</Button>
	)
}
