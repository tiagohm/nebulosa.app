import type { PlateSolverType } from 'src/shared/types'
import { Select, type SelectProps } from './components/Select'

const ITEMS = ['ASTAP', 'ASTROMETRY_NET', 'NOVA_ASTROMETRY_NET'] as const
const LABELS = ['Astap', 'Astrometry.net (offline)', 'Nova Astrometry.net'] as const

function PlateSolverItem(item: PlateSolverType, i: number) {
	return <span>{LABELS[i]}</span>
}

export type PlateSolverSelectProps = Omit<SelectProps<PlateSolverType>, 'children' | 'items'>

export function PlateSolverSelect({ label = 'Solver', ...props }: PlateSolverSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{PlateSolverItem}
		</Select>
	)
}
