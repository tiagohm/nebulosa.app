import { Select, type SelectProps } from '@ui/components/Select'
import type { MountRemoteControlProtocol } from 'src/shared/types'

const ITEMS = ['lx200', 'stellarium'] as const
const LABELS = ['LX200', 'Stellarium'] as const

function MountRemoteControlProtocolItem(item: MountRemoteControlProtocol, i: number) {
	return <span>{LABELS[i]}</span>
}

export type MountRemoteControlProtocolSelectProps = Omit<SelectProps<MountRemoteControlProtocol>, 'children' | 'items'>

export function MountRemoteControlProtocolSelect({ label = 'Protocol', ...props }: MountRemoteControlProtocolSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{MountRemoteControlProtocolItem}
		</Select>
	)
}
