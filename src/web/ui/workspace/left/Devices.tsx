import type { DeviceType } from 'nebulosa/src/devices/indi/device'
import { memo } from 'react'
import { equipmentStore } from 'src/web/stores/equipment.store'
import { workspaceStore } from 'src/web/stores/workspace.store'
import { useSnapshot } from 'valtio'
import { List, ListItem, type ListItemProps } from '../../components/List'
import { ConnectButton } from '../../ConnectButton'
import { Icons } from '../../Icon'

export const Devices = memo(() => (
	<div className="flex flex-col gap-2 p-3">
		<DeviceList type="camera" />
		<DeviceList type="mount" />
		<DeviceList type="wheel" title="FILTER WHEEL" />
		<DeviceList type="focuser" />
		<DeviceList type="rotator" />
		<DeviceList type="flatPanel" title="FLAT PANEL" />
		<DeviceList type="cover" />
		<DeviceList type="guideOutput" title="GUIDE OUTPUT" />
		<DeviceList type="thermometer" />
	</div>
))

interface DeviceListProps {
	readonly type: DeviceType
	readonly title?: string
}

const DeviceList = memo(({ type, title }: DeviceListProps) => {
	const { length } = useSnapshot(equipmentStore.state[type])

	const devices = equipmentStore.state[type]

	function handleAction(index: number) {
		workspaceStore.openDevice(devices[index])
	}

	return (
		<div className="mb-3 flex w-full flex-col flex-wrap items-center justify-center gap-2">
			<span className="text-sm font-bold uppercase">{title ?? type}</span>
			<List fullWidth itemCount={length} itemHeight={36} onAction={handleAction} emptyContent="No devices">
				{(i) => <DeviceItem key={devices[i].id} type={type} index={i} />}
			</List>
		</div>
	)
})

interface DeviceItemProps extends Omit<ListItemProps, 'children'> {
	readonly type: DeviceType
	readonly index: number
}

function DeviceItem({ type, index, ...props }: DeviceItemProps) {
	const device = equipmentStore.state[type][index]
	const { connected, name } = useSnapshot(device)

	const EndContent = (
		<div className="flex flex-row items-center justify-center gap-1">
			<ConnectButton connected={connected} onClick={() => equipmentStore.connect(device)} size="sm" />
		</div>
	)

	return <ListItem endContent={EndContent} startContent={<Icons.Circle className="size-[0.8em]" color={connected ? 'var(--success)' : 'var(--danger)'} />} className="min-w-full cursor-pointer" label={name} {...props} />
}
