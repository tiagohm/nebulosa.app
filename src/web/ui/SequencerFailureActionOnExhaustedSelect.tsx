import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerFailureAction } from '#/sequencer'

const ITEMS = ['skip', 'pause', 'suspend', 'stop', 'fail'] as const
const LABELS = ['Skip', 'Pause', 'Suspend', 'Stop', 'Fail'] as const

function SequencerFailureActionOnExhaustedItem(item: Exclude<SequencerFailureAction, 'retry'>, i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerFailureActionOnExhaustedProps extends Omit<SelectProps<Exclude<SequencerFailureAction, 'retry'>>, 'children' | 'items'> {}

export function SequencerFailureActionOnExhaustedSelect({ label = 'Action on exhausted', ...props }: SequencerFailureActionOnExhaustedProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerFailureActionOnExhaustedItem}
		</Select>
	)
}
