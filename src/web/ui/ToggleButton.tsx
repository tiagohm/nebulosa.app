import { Button, type ButtonProps } from '@heroui/react'

export interface ToggleButtonProps extends Omit<ButtonProps, 'variant' | 'isIconOnly'> {
	readonly isSelected: boolean
}

export function ToggleButton({ isSelected, ...props }: ToggleButtonProps) {
	return <Button {...props} isIconOnly variant={isSelected ? 'solid' : 'flat'} />
}
