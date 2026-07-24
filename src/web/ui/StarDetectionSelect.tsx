import { Select } from '@ui/components/Select'
import type { SelectItemRenderer, SelectProps } from '@ui/components/Select'
import type { StarDetectionType } from 'src/types/stardetection'

const ITEMS = ['astap', 'nebulosa'] as const
const LABELS = ['Astap', 'Nebulosa'] as const

const StarDetectionItem: SelectItemRenderer<StarDetectionType> = (_, i) => <span>{LABELS[i]}</span>

export type StarDetectionSelectProps = Omit<SelectProps<StarDetectionType>, 'children' | 'items'>

export function StarDetectionSelect({ label = 'Detector', ...props }: StarDetectionSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{StarDetectionItem}
		</Select>
	)
}
