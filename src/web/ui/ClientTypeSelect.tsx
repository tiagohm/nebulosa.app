import { SelectItem } from '@heroui/react'
import type { ClientType } from 'nebulosa/src/indi.device'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function ClientTypeSelect({ label = 'Type', ...props }: Omit<EnumSelectProps<ClientType>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='INDI'>INDI</SelectItem>
			<SelectItem key='ALPACA'>Alpaca</SelectItem>
		</EnumSelect>
	)
}
