import { ButtonGroup, type ButtonGroupProps } from '@heroui/react'
import type { TargetCoordinateType } from 'src/shared/types'
import { TextButton, type TextButtonProps } from './TextButton'

export interface TargetCoordinateTypeButtonGroupProps extends ButtonGroupProps, Pick<TextButtonProps, 'color'> {
	readonly variant?: Exclude<TextButtonProps['variant'], 'solid'>
	readonly value: TargetCoordinateType
	readonly buttonProps?: Omit<TextButtonProps, 'onPointerUp' | 'size' | 'variant' | 'color' | 'label'>
	readonly onValueChange: (type: TargetCoordinateType) => void
}

export function TargetCoordinateTypeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', buttonProps, ...props }: TargetCoordinateTypeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<TextButton {...buttonProps} color={color} label='J2000' onPointerUp={() => onValueChange('J2000')} size='sm' variant={value === 'J2000' ? 'solid' : variant} />
			<TextButton {...buttonProps} color={color} label='JNOW' onPointerUp={() => onValueChange('JNOW')} size='sm' variant={value === 'JNOW' ? 'solid' : variant} />
			<TextButton {...buttonProps} color={color} label='ALT/AZ' onPointerUp={() => onValueChange('ALTAZ')} size='sm' variant={value === 'ALTAZ' ? 'solid' : variant} />
		</ButtonGroup>
	)
}
