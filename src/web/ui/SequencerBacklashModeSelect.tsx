import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SequencerBacklash } from '#/sequencer'

const ITEMS = ['overshoot', 'inward', 'outward'] as const
const LABELS = ['Overshoot', 'Inward', 'Outward'] as const

function SequencerBacklashModeItem(item: SequencerBacklash['mode'], i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerBacklashModeSelectProps extends Omit<SelectProps<SequencerBacklash['mode']>, 'children' | 'items'> {}

export function SequencerBacklashModeSelect({ label = 'Backlash mode', ...props }: SequencerBacklashModeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerBacklashModeItem}
		</Select>
	)
}
