import type { FrameType } from 'nebulosa/src/indi.device'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['LIGHT', 'DARK', 'FLAT', 'BIAS'] as const
const LABELS = ['Light', 'Dark', 'Flat', 'Bias'] as const

const FrameTypeItem: SelectItemRenderer<FrameType> = (_, i) => <span>{LABELS[i]}</span>

export type FrameTypeSelectProps = Omit<SelectProps<FrameType>, 'children' | 'items'>

export function FrameTypeSelect({ label = 'Frame Type', ...props }: FrameTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{FrameTypeItem}
		</Select>
	)
}
