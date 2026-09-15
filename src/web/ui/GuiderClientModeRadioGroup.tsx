import { Radio } from '@ui/components/Radio'
import { cn } from 'cn'
import type { GuiderClientMode } from '#/guider'

export interface GuiderClientModeRadioGroupProps extends React.ComponentProps<'div'> {
	readonly value: GuiderClientMode
	readonly onValueChange: (value: GuiderClientMode) => void
	readonly horizontal?: boolean
	readonly disabled?: boolean
}

export function GuiderClientModeRadioGroup({ value, onValueChange, horizontal, disabled, className, ...props }: GuiderClientModeRadioGroupProps) {
	return (
		<div className={cn('flex gap-2', horizontal ? 'flex-row items-center justify-center' : 'flex-col items-start justify-center', className)} {...props}>
			<Radio disabled={disabled} label="PHD2" onValueChange={(value) => value && onValueChange('remote')} value={value === 'remote'} />
			<Radio disabled={disabled} label="Local" onValueChange={(value) => value && onValueChange('local')} value={value === 'local'} />
		</div>
	)
}
