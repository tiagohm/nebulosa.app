import type { StarDetectionType } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['ASTAP', 'NEBULOSA'] as const
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
