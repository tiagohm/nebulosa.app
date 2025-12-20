import { IconButton, type IconButtonProps } from './IconButton'

export interface ToggleButtonProps extends Omit<IconButtonProps, 'variant'> {
	readonly isSelected: boolean
	readonly offVariant?: IconButtonProps['variant']
	readonly onVariant?: IconButtonProps['variant']
}

export function ToggleButton({ isSelected, offVariant = 'flat', onVariant = 'solid', ...props }: ToggleButtonProps) {
	return <IconButton {...props} variant={isSelected ? onVariant : offVariant} />
}
