import { Radio, RadioGroup, type RadioGroupProps } from '@heroui/react'
import type { ImageFilterType } from '../../shared/types'

export interface ImageFilterTypeRadioGroupProps extends Omit<RadioGroupProps, 'value' | 'onValueChange'> {
	readonly value: ImageFilterType
	readonly onValueChange: (value: ImageFilterType) => void
}

export function ImageFilterTypeRadioGroup({ value, onValueChange, ...props }: ImageFilterTypeRadioGroupProps) {
	return (
		<RadioGroup {...props} onValueChange={onValueChange as never} value={value}>
			<Radio value='sharpen'>Sharpen</Radio>
			<Radio value='mean'>Mean</Radio>
			<Radio value='blur'>Blur</Radio>
			<Radio value='gaussianBlur'>Gaussian Blur</Radio>
		</RadioGroup>
	)
}
