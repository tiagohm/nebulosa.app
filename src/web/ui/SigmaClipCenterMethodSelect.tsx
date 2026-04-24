import type { SigmaClipCenterMethod } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['mean', 'median'] as const
const LABELS = ['Mean', 'Median'] as const

const SigmaClipCenterMethodItem: SelectItemRenderer<SigmaClipCenterMethod> = (_, i) => <span>{LABELS[i]}</span>

export type SigmaClipCenterMethodSelectProps = Omit<SelectProps<SigmaClipCenterMethod>, 'children' | 'items'>

export function SigmaClipCenterMethodSelect({ label = 'Center method', ...props }: SigmaClipCenterMethodSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SigmaClipCenterMethodItem}
		</Select>
	)
}
