import { Button, ButtonGroup, type ButtonGroupProps, type ButtonProps } from '@heroui/react'
import type { TargetCoordinateType } from 'src/shared/types'

export interface TargetCoordinateTypeButtonGroupProps extends ButtonGroupProps, Pick<ButtonProps, 'color'> {
	readonly variant?: Exclude<ButtonProps['variant'], 'solid'>
	readonly value: TargetCoordinateType
	readonly buttonProps?: Omit<ButtonProps, 'onPointerUp' | 'size' | 'variant' | 'color'>
	readonly onValueChange: (type: TargetCoordinateType) => void
}

export function TargetCoordinateTypeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', buttonProps, ...props }: TargetCoordinateTypeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<Button {...buttonProps} color={color} onPointerUp={() => onValueChange('J2000')} size='sm' variant={value === 'J2000' ? 'solid' : variant}>
				J2000
			</Button>
			<Button {...buttonProps} color={color} onPointerUp={() => onValueChange('JNOW')} size='sm' variant={value === 'JNOW' ? 'solid' : variant}>
				JNOW
			</Button>
			<Button {...buttonProps} color={color} onPointerUp={() => onValueChange('ALTAZ')} size='sm' variant={value === 'ALTAZ' ? 'solid' : variant}>
				ALT/AZ
			</Button>
		</ButtonGroup>
	)
}
