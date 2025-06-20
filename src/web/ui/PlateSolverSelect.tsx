import { Select, SelectItem, type SelectProps } from '@heroui/react'
import type { PlateSolverType } from 'src/api/types'

export interface PlateSolverSelectProps extends Omit<SelectProps, 'value' | 'onValueChange' | 'size' | 'disallowEmptySelection' | 'children' | 'selectionMode'> {
	value: PlateSolverType
	onValueChange: (value: PlateSolverType) => void
}

export function PlateSolverSelect({ label = 'Solver', value, onValueChange, ...props }: PlateSolverSelectProps) {
	return (
		<Select {...props} disallowEmptySelection label={label} onSelectionChange={(value) => onValueChange((value as Set<string>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single' size='sm'>
			<SelectItem key='ASTAP'>Astap</SelectItem>
			<SelectItem key='ASTROMETRY_NET'>Astrometry.net (offline)</SelectItem>
			<SelectItem key='NOVA_ASTROMETRY_NET'>Nova Astrometry.net</SelectItem>
		</Select>
	)
}
