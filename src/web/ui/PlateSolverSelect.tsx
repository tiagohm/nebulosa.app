import type { PlateSolverType } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['ASTAP', 'ASTROMETRY_NET', 'NOVA_ASTROMETRY_NET'] as const
const LABELS = ['Astap', 'Astrometry.net (offline)', 'Nova Astrometry.net'] as const

const PlateSolverItem: SelectItemRenderer<PlateSolverType> = (_, i) => <span>{LABELS[i]}</span>

export type PlateSolverSelectProps = Omit<SelectProps<PlateSolverType>, 'children' | 'items'>

export function PlateSolverSelect({ label = 'Solver', ...props }: PlateSolverSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{PlateSolverItem}
		</Select>
	)
}
