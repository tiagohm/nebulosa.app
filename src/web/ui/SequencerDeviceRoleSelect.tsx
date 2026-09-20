import { MultiSelect } from '@ui/components/MultiSelect'
import type { MultiSelectProps } from '@ui/components/MultiSelect'
import type { SequencerDeviceRole } from '#/sequencer'

const ITEMS = ['camera', 'mount', 'wheel', 'focuser', 'rotator', 'guideCamera', 'guideOutput', 'cover', 'flatPanel', 'dome'] as const
const LABELS = ['Camera', 'Mount', 'Wheel', 'Focuser', 'Rotator', 'Guide camera', 'Guide output', 'Cover', 'Flat panel', 'Dome'] as const

function SequencerDeviceRoleItem(item: SequencerDeviceRole, index: number) {
	return <span>{LABELS[index]}</span>
}

export type SequencerDeviceRoleSelectProps = Omit<MultiSelectProps<SequencerDeviceRole>, 'children' | 'items'>

export function SequencerDeviceRoleSelect({ label = 'Devices', ...props }: SequencerDeviceRoleSelectProps) {
	return (
		<MultiSelect clearable items={ITEMS} label={label} {...props}>
			{SequencerDeviceRoleItem}
		</MultiSelect>
	)
}
