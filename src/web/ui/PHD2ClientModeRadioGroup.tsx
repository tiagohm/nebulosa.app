import type { PHD2ClientMode } from 'src/shared/types'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface PHD2ClientModeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: PHD2ClientMode
	readonly onValueChange: (value: PHD2ClientMode) => void
	readonly horizontal?: boolean
	readonly disabled?: boolean
}

export function PHD2ClientModeRadioGroup({ value, onValueChange, horizontal, disabled, className, ...props }: PHD2ClientModeRadioGroupProps) {
	return (
		<div className={tw('flex gap-1', horizontal ? 'flex-row items-center justify-center' : 'flex-col items-start justify-center', className)} {...props}>
			<Radio disabled={disabled} label="Remote" onValueChange={(value) => value && onValueChange('REMOTE')} value={value === 'REMOTE'} />
			<Radio disabled={disabled} label="Internal" onValueChange={(value) => value && onValueChange('INTERNAL')} value={value === 'INTERNAL'} />
		</div>
	)
}
