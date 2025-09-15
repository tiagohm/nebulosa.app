import { SelectItem } from '@heroui/react'
import type { PlateSolverType } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export interface PlateSolverSelectProps extends Omit<EnumSelectProps<PlateSolverType>, 'children'> {}

export function PlateSolverSelect({ label = 'Solver', ...props }: PlateSolverSelectProps) {
	return (
		<EnumSelect {...props} classNames={{ innerWrapper: '!pt-0', endContent: 'mb-0', value: 'pt-2' }} label={label}>
			<SelectItem key='ASTAP'>Astap</SelectItem>
			<SelectItem key='ASTROMETRY_NET'>Astrometry.net (offline)</SelectItem>
			<SelectItem key='NOVA_ASTROMETRY_NET'>Nova Astrometry.net</SelectItem>
		</EnumSelect>
	)
}
