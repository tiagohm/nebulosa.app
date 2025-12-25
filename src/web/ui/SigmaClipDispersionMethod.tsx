import { SelectItem } from '@heroui/react'
import type { SigmaClipDispersionMethod } from 'nebulosa/src/image.types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function SigmaClipDispersionMethodSelect({ label = 'Dispersion method', ...props }: Omit<EnumSelectProps<SigmaClipDispersionMethod>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='std'>Std Dev</SelectItem>
			<SelectItem key='mad'>MAD</SelectItem>
		</EnumSelect>
	)
}
