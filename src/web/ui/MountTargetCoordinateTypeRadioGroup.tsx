import { Radio, RadioGroup, type RadioGroupProps } from '@heroui/react'
import type { MountTargetCoordinateType } from 'nebulosa/src/indi.device'

export interface MountTargetCoordinateTypeRadioGroupProps extends Omit<RadioGroupProps, 'orientation' | 'value' | 'onValueChange' | 'children'> {
	readonly value: MountTargetCoordinateType
	readonly onValueChange: (value: MountTargetCoordinateType) => void
}

export function MountTargetCoordinateTypeRadioGroup({ value, onValueChange, ...props }: MountTargetCoordinateTypeRadioGroupProps) {
	return (
		<RadioGroup {...props} onValueChange={(value) => onValueChange(value as never)} orientation='horizontal' value={value}>
			<Radio value='J2000'>J2000</Radio>
			<Radio value='JNOW'>JNOW</Radio>
			<Radio value='ALTAZ'>HOR</Radio>
			<Radio value='ECLIPTIC'>ECL</Radio>
			<Radio value='GALACTIC'>GAL</Radio>
		</RadioGroup>
	)
}
