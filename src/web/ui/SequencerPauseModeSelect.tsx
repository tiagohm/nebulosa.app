import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerExecution } from '#/sequencer'

const ITEMS = ['afterCurrentAction', 'afterCurrentExposure', 'immediate'] as const
const LABELS = ['After current action', 'After current exposure', 'Immediate'] as const

function SequencerPauseModeItem(item: SequencerExecution['pauseMode'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerPauseModeSelectProps extends Omit<SelectProps<SequencerExecution['pauseMode']>, 'children' | 'items'> {}

export function SequencerPauseModeSelect({ label = 'Pause mode', ...props }: SequencerPauseModeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerPauseModeItem}
		</Select>
	)
}
