import { Select, type SelectProps } from '@ui/components/Select'
import type { FrameType } from 'nebulosa/src/devices/indi/device'

const ITEMS = ['LIGHT', 'DARK', 'FLAT', 'BIAS'] as const
const LABELS = ['Light', 'Dark', 'Flat', 'Bias'] as const

function FrameTypeItem(item: FrameType, i: number) {
	return <span>{LABELS[i]}</span>
}

export type FrameTypeSelectProps = Omit<SelectProps<FrameType>, 'children' | 'items'>

export function FrameTypeSelect({ label = 'Frame Type', ...props }: FrameTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{FrameTypeItem}
		</Select>
	)
}
