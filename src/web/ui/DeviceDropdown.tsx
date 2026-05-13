import { useMolecule } from 'bunshi/react'
import type { Device } from 'nebulosa/src/indi.device'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from '@/molecules/indi/equipment'
import type { DeviceTypeMap } from '@/shared/types'
import { stopPropagation } from '@/shared/util'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'
import { IconButton } from './components/IconButton'
import { ConnectButton } from './ConnectButton'
import { Icons, type Icon } from './Icon'

export interface DeviceDropdownProps<T extends keyof DeviceTypeMap> extends DropdownProps {
	readonly type: T
	readonly value?: DeviceTypeMap[T]
	readonly onValueChange?: (value?: DeviceTypeMap[T]) => void
	readonly disallowNoneSelection?: boolean
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
	readonly icon?: Icon
}

function DeviceItem(item: Device | undefined, onClick: React.MouseEventHandler) {
	const key = item?.id ?? 'none'
	return <DropdownItem key={key} data-id={key} onClick={onClick} label={item?.name || 'None'} startContent={<DeviceDropdownStartContent isConnected={item?.connected} />} endContent={<DeviceDropdownEndContent device={item} />} />
}

export function DeviceDropdown<T extends keyof DeviceTypeMap>({ type, value, onValueChange, disabled, disallowNoneSelection = false, label, showLabel = false, showLabelOnEmpty = showLabel, color, startContent, icon: Icon, ...props }: DeviceDropdownProps<T>) {
	const equipment = useMolecule(EquipmentMolecule)
	const state = equipment.state[type]
	const devices = useSnapshot(state)

	function handleAction(event: React.MouseEvent<HTMLElement>) {
		const id = event.currentTarget.dataset.id
		onValueChange?.(id === 'none' ? undefined : (state.find((e) => e.id === id) as never))
	}

	const items = new Array<React.ReactNode>(devices.length + (disallowNoneSelection ? 0 : 1))

	if (!disallowNoneSelection) items[0] = DeviceItem(undefined, handleAction)
	for (let i = disallowNoneSelection ? 0 : 1, p = 0; p < devices.length; i++, p++) items[i] = DeviceItem(devices[p], handleAction)

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

export const CameraDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'CAMERA'>>, 'type'>) => <DeviceDropdown icon={Icons.Camera} tooltipContent="Camera" type="CAMERA" {...props} />)

export const MountDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'MOUNT'>>, 'type'>) => <DeviceDropdown icon={Icons.Telescope} tooltipContent="Mount" type="MOUNT" {...props} />)

export const WheelDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'WHEEL'>>, 'type'>) => <DeviceDropdown icon={Icons.FilterWheel} tooltipContent="Filter Wheel" type="WHEEL" {...props} />)

export const FocuserDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'FOCUSER'>>, 'type'>) => <DeviceDropdown icon={Icons.Focuser} tooltipContent="Focuser" type="FOCUSER" {...props} />)

export const RotatorDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'ROTATOR'>>, 'type'>) => <DeviceDropdown icon={Icons.RotateRight} tooltipContent="Rotator" type="ROTATOR" {...props} />)

export const GuideOutputDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'GUIDE_OUTPUT'>>, 'type'>) => <DeviceDropdown icon={Icons.Pulse} tooltipContent="Guide Output" type="GUIDE_OUTPUT" {...props} />)

const DeviceDropdownStartContent = memo(({ isConnected }: { readonly isConnected: boolean | undefined }) => <Icons.Circle color={isConnected === undefined ? '#9353D3' : isConnected ? '#17C964' : '#F31260'} />)

interface DeviceDropdownEndContentProps {
	readonly device?: EquipmentDevice<Device>
}

const DeviceDropdownEndContent = memo(({ device }: DeviceDropdownEndContentProps) => {
	const equipment = useMolecule(EquipmentMolecule)

	function handleConnectPointerUp(event: React.PointerEvent) {
		stopPropagation(event)
		void equipment.connect(device!)
	}

	function handleShowPointerUp(event: React.PointerEvent) {
		stopPropagation(event)
		equipment.show(device!)
	}

	return (
		<div className="flex flex-row items-center gap-2">
			{device && <IconButton color="secondary" icon={Icons.OpenInNew} tooltipContent="Open" onPointerUp={handleShowPointerUp} size="sm" />}
			{device && <ConnectButton connected={device.connected} loading={device?.connecting} onPointerUp={handleConnectPointerUp} size="sm" />}
		</div>
	)
})
