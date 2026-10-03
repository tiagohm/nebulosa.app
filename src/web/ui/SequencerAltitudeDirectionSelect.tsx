import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'

const ITEMS = ['rising', 'setting'] as const
const LABELS = ['Rising', 'Setting'] as const

export type SequencerAltitudeDirection = (typeof ITEMS)[number]

function SequencerAltitudeDirectionItem(item: SequencerAltitudeDirection, i: number) {
	return <span>{LABELS[i]}</span>
}

export interface SequencerAltitudeDirectionSelectProps extends Omit<SelectProps<SequencerAltitudeDirection>, 'children' | 'items'> {}

export function SequencerAltitudeDirectionSelect({ label = 'Direction', ...props }: SequencerAltitudeDirectionSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SequencerAltitudeDirectionItem}
		</Select>
	)
}
