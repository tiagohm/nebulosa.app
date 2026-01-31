import { IconButton, type IconButtonProps } from './IconButton'

export interface ToggleButtonProps extends Omit<IconButtonProps, 'variant'> {
	readonly isSelected?: boolean
	readonly onValueChange?: (value: boolean) => void
	readonly offVariant?: IconButtonProps['variant']
	readonly onVariant?: IconButtonProps['variant']
}

export function ToggleButton({ isSelected, onPointerUp, onValueChange, offVariant = 'flat', onVariant = 'solid', ...props }: ToggleButtonProps) {
	return <IconButton {...props} onPointerUp={(event) => onPointerUp?.(event) ?? onValueChange?.(!isSelected)} variant={isSelected ? onVariant : offVariant} />
}
