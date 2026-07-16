import { Button, type ButtonProps } from '@ui/components/Button'
import type { Icon } from '@ui/Icon'

export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'label' | 'startContent'> {
	readonly icon: Icon
	readonly iconSize?: string | number
	readonly iconColor?: string
}

// Renders a compact action surface whose visible content is the provided icon.
export function IconButton({ icon: Icon, variant = 'ghost', rounded = true, iconSize, iconColor, ...props }: IconButtonProps) {
	return <Button {...props} rounded={rounded} startContent={<Icon size={iconSize} color={iconColor} />} variant={variant} />
}
