import type { SigmaClipDispersionMethod } from 'nebulosa/src/image.types'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['std', 'mad'] as const
const LABELS = ['Std Dev', 'MAD'] as const

function SigmaClipDispersionMethodItem(item: SigmaClipDispersionMethod, i: number) {
	return <span>{LABELS[i]}</span>
}

export type SigmaClipDispersionMethodSelectProps = Omit<SelectProps<SigmaClipDispersionMethod>, 'children' | 'items'>

export function SigmaClipDispersionMethodSelect({ label = 'Dispersion method', ...props }: SigmaClipDispersionMethodSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SigmaClipDispersionMethodItem}
		</Select>
	)
}
