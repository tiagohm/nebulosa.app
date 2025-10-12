import { IconButton, type IconButtonProps } from './IconButton'

export interface ToggleButtonProps extends Omit<IconButtonProps, 'variant'> {
	readonly isSelected: boolean
}

export function ToggleButton({ isSelected, ...props }: ToggleButtonProps) {
	return <IconButton {...props} variant={isSelected ? 'solid' : 'flat'} />
}
