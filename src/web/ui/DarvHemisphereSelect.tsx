import { Select, type SelectProps } from '@ui/components/Select'
import type { DarvHemisphere } from 'src/types/darv'

const ITEMS = ['northern', 'southern'] as const
const LABELS = ['Northern', 'Southern'] as const

function DarvHemisphereItem(item: DarvHemisphere, i: number) {
	return <span>{LABELS[i]}</span>
}

export type DarvHemisphereSelectProps = Omit<SelectProps<DarvHemisphere>, 'children' | 'items'>

export function DarvHemisphereSelect({ label = 'Hemisphere', ...props }: DarvHemisphereSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{DarvHemisphereItem}
		</Select>
	)
}
