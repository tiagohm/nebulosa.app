import type { Icon } from '../Icon'
import { Button, type ButtonProps } from './Button'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'label' | 'startContent'> {
	readonly icon: Icon
	readonly iconSize?: string | number
}

// Renders a compact action surface whose visible content is the provided icon.
export function IconButton({ icon: Icon, variant = 'ghost', rounded = true, iconSize, ...props }: IconButtonProps) {
	return <Button {...props} rounded={rounded} startContent={<Icon size={iconSize} />} variant={variant} />
}
