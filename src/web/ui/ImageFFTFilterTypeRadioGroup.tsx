import { Radio, RadioGroup, type RadioGroupProps } from '@heroui/react'
import type { FFTFilterType } from 'nebulosa/src/image.types'

export interface ImageFFTFilterTypeRadioGroupProps extends Omit<RadioGroupProps, 'value' | 'onValueChange'> {
	readonly value: FFTFilterType
	readonly onValueChange: (value: FFTFilterType) => void
}

export function ImageFFTFilterTypeRadioGroup({ value, onValueChange, ...props }: ImageFFTFilterTypeRadioGroupProps) {
	return (
		<RadioGroup {...props} onValueChange={onValueChange as never} value={value}>
			<Radio value='lowPass'>Low-Pass</Radio>
			<Radio value='highPass'>High-Pass</Radio>
		</RadioGroup>
	)
}
