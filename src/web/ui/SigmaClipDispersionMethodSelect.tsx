import type { SigmaClipDispersionMethod } from 'nebulosa/src/image.types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['std', 'mad'] as const
const LABELS = ['Std Dev', 'MAD'] as const

const SigmaClipDispersionMethodItem: SelectItemRenderer<SigmaClipDispersionMethod> = (_, i) => <span>{LABELS[i]}</span>

export type SigmaClipDispersionMethodSelectProps = Omit<SelectProps<SigmaClipDispersionMethod>, 'children' | 'items'>

export function SigmaClipDispersionMethodSelect({ label = 'Dispersion method', ...props }: SigmaClipDispersionMethodSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{SigmaClipDispersionMethodItem}
		</Select>
	)
}
