import { SelectItem } from '@heroui/react'
import type { Hemisphere } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function HemisphereSelect({ label = 'Hemisphere', ...props }: Omit<EnumSelectProps<Hemisphere>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='NORTHERN'>Northern</SelectItem>
			<SelectItem key='SOUTHERN'>Southern</SelectItem>
		</EnumSelect>
	)
}
