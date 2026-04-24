import type { MountRemoteControlProtocol } from 'src/shared/types'
import { Select, type SelectItemRenderer, type SelectProps } from './components/Select'

const ITEMS = ['LX200', 'STELLARIUM'] as const
const LABELS = ['LX200', 'Stellarium'] as const

const MountRemoteControlProtocolItem: SelectItemRenderer<MountRemoteControlProtocol> = (_, i) => <span>{LABELS[i]}</span>

export type MountRemoteControlProtocolSelectProps = Omit<SelectProps<MountRemoteControlProtocol>, 'children' | 'items'>

export function MountRemoteControlProtocolSelect({ label = 'Protocol', ...props }: MountRemoteControlProtocolSelectProps) {
	return (
		<Select items={ITEMS} label={label} {...props}>
			{MountRemoteControlProtocolItem}
		</Select>
	)
}
