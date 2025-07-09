import { Button, ButtonGroup, type ButtonGroupProps, type ButtonProps } from '@heroui/react'
import type { TargetCoordinateType } from 'src/shared/types'

export interface TargetCoordinateTypeButtonGroupProps extends ButtonGroupProps, Pick<ButtonProps, 'color'> {
	readonly variant?: Exclude<ButtonProps['variant'], 'solid'>
	readonly value: TargetCoordinateType
	readonly onValueChange: (type: TargetCoordinateType) => void
}

export function TargetCoordinateTypeButtonGroup({ value, onValueChange, color = 'primary', variant = 'light', ...props }: TargetCoordinateTypeButtonGroupProps) {
	return (
		<ButtonGroup {...props}>
			<Button color={color} onPointerUp={() => onValueChange('J2000')} size='sm' variant={value === 'J2000' ? 'solid' : variant}>
				J2000
			</Button>
			<Button color={color} onPointerUp={() => onValueChange('JNOW')} size='sm' variant={value === 'JNOW' ? 'solid' : variant}>
				JNOW
			</Button>
			<Button color={color} onPointerUp={() => onValueChange('ALTAZ')} size='sm' variant={value === 'ALTAZ' ? 'solid' : variant}>
				ALT/AZ
			</Button>
		</ButtonGroup>
	)
}
