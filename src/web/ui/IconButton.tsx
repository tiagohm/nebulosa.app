import { Button, type ButtonProps } from './components/Button'
import type { Icon } from './Icon'

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
	readonly icon: Icon
	readonly iconSize?: string | number
}

export function IconButton({ icon: Icon, variant = 'ghost', rounded = true, iconSize, ...props }: IconButtonProps) {
	return <Button startContent={<Icon size={iconSize} />} rounded={rounded} variant={variant} {...props} />
}
