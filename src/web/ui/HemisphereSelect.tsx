import type { Hemisphere } from 'src/shared/types'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['northern', 'southern'] as const
const LABELS = ['Northern', 'Southern'] as const

function HemisphereItem(item: Hemisphere, i: number) {
	return <span>{LABELS[i]}</span>
}

export type HemisphereSelectProps = Omit<SelectProps<Hemisphere>, 'children' | 'items'>

export function HemisphereSelect({ label = 'Hemisphere', ...props }: HemisphereSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{HemisphereItem}
		</Select>
	)
}
