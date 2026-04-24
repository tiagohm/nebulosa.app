import type { FFTFilterType } from 'nebulosa/src/image.types'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface ImageFFTFilterTypeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: FFTFilterType
	readonly onValueChange: (value: FFTFilterType) => void
	readonly disabled?: boolean
}

export function ImageFFTFilterTypeRadioGroup({ value, onValueChange, disabled, className, ...props }: ImageFFTFilterTypeRadioGroupProps) {
	return (
		<div className={tw('flex items-start justify-center gap-1 flex-col', className)} {...props}>
			<Radio disabled={disabled} label="Low-Pass" onValueChange={(value) => value && onValueChange('lowPass')} value={value === 'lowPass'} />
			<Radio disabled={disabled} label="High-Pass" onValueChange={(value) => value && onValueChange('highPass')} value={value === 'highPass'} />
		</div>
	)
}
