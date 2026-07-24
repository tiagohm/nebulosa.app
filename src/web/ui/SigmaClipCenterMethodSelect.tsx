import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { SigmaClipCenterMethod } from 'nebulosa/src/imaging/processing/computation'

const ITEMS = ['mean', 'median'] as const
const LABELS = ['Mean', 'Median'] as const

function SigmaClipCenterMethodItem(item: SigmaClipCenterMethod, i: number) {
	return <span>{LABELS[i]}</span>
}

export type SigmaClipCenterMethodSelectProps = Omit<SelectProps<SigmaClipCenterMethod>, 'children' | 'items'>

export function SigmaClipCenterMethodSelect({ label = 'Center method', ...props }: SigmaClipCenterMethodSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SigmaClipCenterMethodItem}
		</Select>
	)
}
