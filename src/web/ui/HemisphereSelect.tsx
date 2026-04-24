import type { Hemisphere } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['NORTHERN', 'SOUTHERN'] as const
const LABELS = ['Northern', 'Southern'] as const

const HemisphereItem: SelectItemRenderer<Hemisphere> = (_, i) => <span>{LABELS[i]}</span>

export type HemisphereSelectProps = Omit<SelectProps<Hemisphere>, 'children' | 'items'>

export function HemisphereSelect({ label = 'Hemisphere', ...props }: HemisphereSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{HemisphereItem}
		</Select>
	)
}
