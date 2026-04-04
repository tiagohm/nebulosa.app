import { Radio, RadioGroup, type RadioGroupProps } from '@heroui/react'
import type { ImageKernelFilterType } from '../../shared/types'

export interface ImageKernelFilterTypeRadioGroupProps extends Omit<RadioGroupProps, 'value' | 'onValueChange'> {
	readonly value: ImageKernelFilterType
	readonly onValueChange: (value: ImageKernelFilterType) => void
}

export function ImageKernelFilterTypeRadioGroup({ value, onValueChange, ...props }: ImageKernelFilterTypeRadioGroupProps) {
	return (
		<RadioGroup {...props} onValueChange={onValueChange as never} value={value}>
			<Radio value='sharpen'>Sharpen</Radio>
			<Radio value='mean'>Mean</Radio>
			<Radio value='blur'>Blur</Radio>
			<Radio value='gaussianBlur'>Gaussian Blur</Radio>
		</RadioGroup>
	)
}
