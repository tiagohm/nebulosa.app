import { SelectItem } from '@heroui/react'
import type { TppaStart } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function TppaDirectionSelect({ label = 'Direction', ...props }: Omit<EnumSelectProps<TppaStart['direction']>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='EAST'>East</SelectItem>
			<SelectItem key='WEST'>West</SelectItem>
		</EnumSelect>
	)
}
