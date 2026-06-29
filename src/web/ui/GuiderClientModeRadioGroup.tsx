import type { GuiderClientMode } from 'src/shared/types'
import { tw } from '../shared/util'
import { Radio } from './components/Radio'

export interface GuiderClientModeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: GuiderClientMode
	readonly onValueChange: (value: GuiderClientMode) => void
	readonly horizontal?: boolean
	readonly disabled?: boolean
}

export function GuiderClientModeRadioGroup({ value, onValueChange, horizontal, disabled, className, ...props }: GuiderClientModeRadioGroupProps) {
	return (
		<div className={tw('flex gap-1', horizontal ? 'flex-row items-center justify-center' : 'flex-col items-start justify-center', className)} {...props}>
			<Radio disabled={disabled} label="PHD2" onValueChange={(value) => value && onValueChange('remote')} value={value === 'remote'} />
			<Radio disabled={disabled} label="Local" onValueChange={(value) => value && onValueChange('local')} value={value === 'local'} />
		</div>
	)
}
