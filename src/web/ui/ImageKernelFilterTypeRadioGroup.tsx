import type { ImageKernelFilterType } from '../../shared/types'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface ImageKernelFilterTypeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: ImageKernelFilterType
	readonly onValueChange: (value: ImageKernelFilterType) => void
	readonly disabled?: boolean
}

export function ImageKernelFilterTypeRadioGroup({ value, onValueChange, disabled, className, ...props }: ImageKernelFilterTypeRadioGroupProps) {
	return (
		<div className={tw('flex items-start justify-center gap-1 flex-col', className)} {...props}>
			<Radio disabled={disabled} label='Sharpen' onValueChange={(value) => value && onValueChange('sharpen')} value={value === 'sharpen'} />
			<Radio disabled={disabled} label='Mean' onValueChange={(value) => value && onValueChange('mean')} value={value === 'mean'} />
			<Radio disabled={disabled} label='Blur' onValueChange={(value) => value && onValueChange('blur')} value={value === 'blur'} />
			<Radio disabled={disabled} label='Gaussian Blur' onValueChange={(value) => value && onValueChange('gaussianBlur')} value={value === 'gaussianBlur'} />
		</div>
	)
}
