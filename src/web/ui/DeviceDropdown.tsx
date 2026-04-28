import { useMolecule } from 'bunshi/react'
import type { Device } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import type { Atom } from 'src/shared/types'
import { useSnapshot } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from '@/molecules/indi/equipment'
import type { DeviceTypeMap } from '@/shared/types'
import { stopPropagation } from '@/shared/util'
import { Dropdown, type DropdownProps } from './components/Dropdown'
import { ListItem } from './components/List'
import { ConnectButton } from './ConnectButton'
import { Icons, type Icon } from './Icon'
import { IconButton } from './IconButton'

export interface DeviceDropdownProps<T extends keyof DeviceTypeMap> extends DropdownProps {
	readonly type: T
	readonly value?: DeviceTypeMap[T]
	readonly onValueChange?: (value?: DeviceTypeMap[T]) => void
	readonly disallowNoneSelection?: boolean
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
	readonly icon?: Icon
}

function DeviceItem(item: Device | undefined, onPointerDown: React.PointerEventHandler, equipment: Atom<typeof EquipmentMolecule>) {
	const key = item?.id ?? 'none'
	return <ListItem key={key} data-id={key} onPointerDown={onPointerDown} label={item?.name || 'None'} description={<DeviceDropdownStartContent isConnected={item?.connected} />} endContent={<DeviceDropdownEndContent device={item} onConnect={equipment.connect} onShow={equipment.show} />} />
}

export function DeviceDropdown<T extends keyof DeviceTypeMap>({ type, value, onValueChange, disabled, disallowNoneSelection = false, label, showLabel = false, showLabelOnEmpty = showLabel, color, startContent, icon: Icon, ...props }: DeviceDropdownProps<T>) {
	const equipment = useMolecule(EquipmentMolecule)
	const state = equipment.state[type]
	const devices = useSnapshot(state)

	function handleAction(event: React.PointerEvent<HTMLElement>) {
		const id = event.currentTarget.dataset.id
		onValueChange?.(id === 'none' ? undefined : (state.find((e) => e.id === id) as never))
	}

	const items = new Array<React.ReactNode>(devices.length + (disallowNoneSelection ? 0 : 1))

	if (!disallowNoneSelection) items[0] = DeviceItem(undefined, handleAction, equipment)
	for (let i = disallowNoneSelection ? 0 : 1, p = 0; i < devices.length; i++, p++) items[i] = DeviceItem(devices[p], handleAction, equipment)

	return (
		<Dropdown
			label={showLabel ? (value?.name ?? (showLabelOnEmpty ? label || 'None' : undefined)) : undefined}
			color={color ?? (value === undefined ? 'secondary' : value.connected ? 'success' : 'danger')}
			disabled={disabled || items.length === 0}
			startContent={startContent ?? (Icon ? <Icon /> : undefined)}
			{...props}>
			{items}
		</Dropdown>
	)
}

export const CameraDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'CAMERA'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Camera" type="CAMERA" {...props} />
})

export const MountDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'MOUNT'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Mount" type="MOUNT" {...props} />
})

export const WheelDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'WHEEL'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Filter Wheel" type="WHEEL" {...props} />
})

export const FocuserDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'FOCUSER'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Focuser" type="FOCUSER" {...props} />
})

export const RotatorDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'ROTATOR'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Rotator" type="ROTATOR" {...props} />
})

export const GuideOutputDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'GUIDE_OUTPUT'>>, 'type'>) => {
	return <DeviceDropdown tooltipContent="Guide Output" type="GUIDE_OUTPUT" {...props} />
})

const DeviceDropdownStartContent = memo(({ isConnected }: { readonly isConnected: boolean | undefined }) => {
	return <Icons.Circle color={isConnected === undefined ? '#9353D3' : isConnected ? '#17C964' : '#F31260'} />
})

interface DeviceDropdownEndContentProps {
	readonly device?: EquipmentDevice<Device>
	readonly onConnect: (device: Device) => void
	readonly onShow: (device: Device) => void
}

function DeviceDropdownEndContent({ device, onConnect, onShow }: DeviceDropdownEndContentProps) {
	function handleConnectPointerUp(event: React.PointerEvent) {
		stopPropagation(event)
		onConnect(device!)
	}

	function handleShowPointerUp(event: React.PointerEvent) {
		stopPropagation(event)
		onShow(device!)
	}

	return (
		<div className="flex flex-row items-center gap-2">
			{device && <IconButton color="secondary" icon={Icons.OpenInNew} iconSize={12} isRounded onPointerUp={handleShowPointerUp} />}
			{device && <ConnectButton isConnected={device.connected} loading={device?.connecting} onPointerUp={handleConnectPointerUp} />}
		</div>
	)
}
