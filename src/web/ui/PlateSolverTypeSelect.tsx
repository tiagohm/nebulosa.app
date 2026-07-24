import { Select } from '@ui/components/Select'
import type { SelectProps } from '@ui/components/Select'
import type { PlateSolverType } from 'src/types/platesolver'

const ITEMS = ['astap', 'astrometryNet', 'novaAstrometryNet'] as const
const LABELS = ['Astap', 'Astrometry.net (offline)', 'Nova Astrometry.net'] as const

function PlateSolverTypeItem(item: PlateSolverType, i: number) {
	return <span>{LABELS[i]}</span>
}

export type PlateSolverTypeSelectProps = Omit<SelectProps<PlateSolverType>, 'children' | 'items'>

export function PlateSolverTypeSelect({ label = 'Solver', ...props }: PlateSolverTypeSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{PlateSolverTypeItem}
		</Select>
	)
}
