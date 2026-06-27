import type { Device } from 'nebulosa/src/devices/indi/device'
import { memo } from 'react'
import { useSnapshot } from 'valtio'
import type { DeviceTypeMap } from '@/shared/types'
import { equipmentStore, type DeviceState } from '@/stores/equipment.store'
import { Dropdown, DropdownItem, type DropdownProps } from './components/Dropdown'
import { IconButton } from './components/IconButton'
import { ConnectButton } from './ConnectButton'
import { Icons, type Icon } from './Icon'

export interface DeviceDropdownProps<T extends keyof DeviceTypeMap> extends Omit<DropdownProps, 'children' | 'onAction'> {
	readonly type: T
	readonly value?: DeviceTypeMap[T]
	readonly onValueChange?: (value?: DeviceTypeMap[T]) => void
	readonly disallowNoneSelection?: boolean
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
	readonly icon?: Icon
}

function deviceStatusColor(isConnected: boolean | undefined) {
	return isConnected === undefined ? 'var(--secondary)' : isConnected ? 'var(--success)' : 'var(--danger)'
}

function DeviceItem(device: DeviceState<Device> | undefined) {
	const key = device?.id ?? 'none'

	return <DropdownItem key={key} label={device?.name ?? 'None'} startContent={<DeviceDropdownStartContent isConnected={device?.connected} />} endContent={device && <DeviceDropdownEndContent device={device} />} />
}

export function DeviceDropdown<T extends keyof DeviceTypeMap>({ type, value, onValueChange, disabled, disallowNoneSelection = false, label, showLabel = false, showLabelOnEmpty = showLabel, color, startContent, icon: Icon, ...props }: DeviceDropdownProps<T>) {
	const state = equipmentStore.state[type]
	const devices = useSnapshot(state)

	const items = new Array<DeviceState<Device> | undefined>(devices.length + (disallowNoneSelection ? 0 : 1))

	if (!disallowNoneSelection) items[0] = undefined
	for (let i = disallowNoneSelection ? 0 : 1, p = 0; p < devices.length; i++, p++) items[i] = devices[p] as DeviceState<Device>

	function handleAction(index: number) {
		if (index < 0 || index >= items.length) return

		const device = items[index]

		if (device === undefined) {
			onValueChange?.(undefined)
		} else {
			const currentDevice = state.find((e) => e.id === device.id)
			if (currentDevice) onValueChange?.(currentDevice as never)
		}
	}

	return (
		<Dropdown
			label={showLabel ? (value?.name ?? (showLabelOnEmpty ? (label ?? 'None') : undefined)) : undefined}
			color={color ?? (value === undefined ? 'secondary' : value.connected ? 'success' : 'danger')}
			disabled={disabled || items.length === 0}
			onAction={handleAction}
			startContent={startContent ?? (Icon ? <Icon /> : undefined)}
			{...props}>
			{items.map(DeviceItem)}
		</Dropdown>
	)
}

export const CameraDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'camera'>>, 'type'>) => <DeviceDropdown icon={Icons.Camera} tooltipContent="Camera" type="camera" {...props} />)

export const MountDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'mount'>>, 'type'>) => <DeviceDropdown icon={Icons.Telescope} tooltipContent="Mount" type="mount" {...props} />)

export const WheelDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'wheel'>>, 'type'>) => <DeviceDropdown icon={Icons.FilterWheel} tooltipContent="Filter Wheel" type="wheel" {...props} />)

export const FocuserDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'focuser'>>, 'type'>) => <DeviceDropdown icon={Icons.Focuser} tooltipContent="Focuser" type="focuser" {...props} />)

export const RotatorDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'rotator'>>, 'type'>) => <DeviceDropdown icon={Icons.RotateRight} tooltipContent="Rotator" type="rotator" {...props} />)

export const GuideOutputDropdown = memo((props: Omit<Partial<DeviceDropdownProps<'guideOutput'>>, 'type'>) => <DeviceDropdown icon={Icons.Pulse} tooltipContent="Guide Output" type="guideOutput" {...props} />)

const DeviceDropdownStartContent = memo(({ isConnected }: { readonly isConnected: boolean | undefined }) => <Icons.Circle color={deviceStatusColor(isConnected)} />)

interface DeviceDropdownEndContentProps {
	readonly device: DeviceState<Device>
}

const DeviceDropdownEndContent = memo(({ device }: DeviceDropdownEndContentProps) => (
	<div className="flex flex-row items-center gap-2">
		<IconButton color="secondary" icon={Icons.OpenInNew} tooltipContent="Open" onClick={() => equipmentStore.show(device)} size="sm" />
		<ConnectButton connected={device.connected} loading={device.connecting} onClick={() => equipmentStore.connect(device)} size="sm" />
	</div>
))
