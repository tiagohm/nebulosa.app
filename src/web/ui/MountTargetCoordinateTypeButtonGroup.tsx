import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { MountTargetCoordinateType } from 'nebulosa/src/indi.device'
import { TextButton, type TextButtonProps } from './TextButton'

export interface MountTargetCoordinateTypeButtonGroupProps extends ButtonGroupProps, Pick<TextButtonProps, 'color'> {
	readonly variant?: Exclude<TextButtonProps['variant'], 'solid'>
	readonly value: MountTargetCoordinateType
	readonly buttonProps?: Omit<TextButtonProps, 'onPointerUp' | 'size' | 'variant' | 'color' | 'label'>
	readonly onValueChange: (type: MountTargetCoordinateType) => void
}

export function MountTargetCoordinateTypeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', buttonProps, ...props }: MountTargetCoordinateTypeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<TextButton {...buttonProps} color={color} label='J2000' onPointerUp={() => onValueChange('J2000')} size='sm' variant={value === 'J2000' ? 'solid' : variant} />
			<TextButton {...buttonProps} color={color} label='JNOW' onPointerUp={() => onValueChange('JNOW')} size='sm' variant={value === 'JNOW' ? 'solid' : variant} />
			<TextButton {...buttonProps} color={color} label='ALT/AZ' onPointerUp={() => onValueChange('ALTAZ')} size='sm' variant={value === 'ALTAZ' ? 'solid' : variant} />
		</ButtonGroup>
	)
}
