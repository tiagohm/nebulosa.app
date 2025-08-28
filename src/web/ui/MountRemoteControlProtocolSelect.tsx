import { SelectItem } from '@heroui/react'
import type { MountRemoteControlProtocol } from 'src/shared/types'
import { EnumSelect, type EnumSelectProps } from './EnumSelect'

export function MountRemoteControlProtocolSelect({ label = 'Protocol', ...props }: Omit<EnumSelectProps<MountRemoteControlProtocol>, 'children'>) {
	return (
		<EnumSelect {...props} label={label}>
			<SelectItem key='LX200'>LX200</SelectItem>
			<SelectItem key='STELLARIUM'>Stellarium</SelectItem>
		</EnumSelect>
	)
}
