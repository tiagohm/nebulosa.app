import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerExecution } from '#/sequencer'

const ITEMS = ['graceful', 'immediate'] as const
const LABELS = ['Graceful', 'Immediate'] as const

function SequencerStopModeItem(item: SequencerExecution['stopMode'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerStopModeSelectProps extends Omit<SelectProps<SequencerExecution['stopMode']>, 'children' | 'items'> {}

export function SequencerStopModeSelect({ label = 'Stop mode', ...props }: SequencerStopModeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerStopModeItem}
		</Select>
	)
}
