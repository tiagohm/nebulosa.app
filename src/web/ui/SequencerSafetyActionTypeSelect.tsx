import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerSafetyAction } from '#/sequencer'

const ITEMS = ['abortCapture', 'stopGuiding', 'stopTracking', 'closeCover', 'parkMount', 'parkDome', 'closeDome', 'warmCamera', 'switch', 'custom'] as const
const LABELS = ['Abort capture', 'Stop guiding', 'Stop tracking', 'Close cover', 'Park mount', 'Park dome', 'Close dome', 'Warm camera', 'Switch', 'Custom'] as const

function SequencerSafetyActionTypeItem(item: SequencerSafetyAction['type'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerSafetyActionTypeSelectProps extends Omit<SelectProps<SequencerSafetyAction['type']>, 'children' | 'items'> {}

export function SequencerSafetyActionTypeSelect({ label = 'Type', ...props }: SequencerSafetyActionTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerSafetyActionTypeItem}
		</Select>
	)
}
