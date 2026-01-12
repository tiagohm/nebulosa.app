import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Tooltip, type TooltipProps } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { Device } from 'nebulosa/src/indi.device'
import { useMemo } from 'react'
import type { DeepReadonly } from 'utility-types'
import { useSnapshot } from 'valtio'
import { EquipmentMolecule } from '@/molecules/indi/equipment'
import type { DeviceTypeMap } from '@/shared/types'
import { stopPropagation } from '@/shared/util'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface DeviceDropdownProps<T extends keyof DeviceTypeMap> extends Pick<IconButtonProps, 'label' | 'color' | 'size' | 'iconSize' | 'variant' | 'endContent'> {
	readonly type: T
	readonly value?: DeepReadonly<DeviceTypeMap[T]>
	readonly onValueChange: (value?: DeviceTypeMap[T]) => void
	readonly isDisabled?: boolean
	readonly allowNoneSelection?: boolean
	readonly tooltipContent?: React.ReactNode
	readonly tooltipPlacement?: TooltipProps['placement']
	readonly icon?: IconButtonProps['icon']
	readonly label?: string
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

const DEVICES = {
	CAMERA: { icon: Icons.Camera, label: 'Camera' },
	MOUNT: { icon: Icons.Telescope, label: 'Mount' },
	FOCUSER: { icon: Icons.Focuser, label: 'Focuser' },
	WHEEL: { icon: Icons.FilterWheel, label: 'Filter Wheel' },
	ROTATOR: { icon: Icons.RotateRight, label: 'Rotator' },
	FLAT_PANEL: { icon: Icons.Camera, label: 'Flat Panel' },
	COVER: { icon: Icons.Camera, label: 'Cover' },
	THERMOMETER: { icon: Icons.Thermometer, label: 'Thermometer' },
	GUIDE_OUTPUT: { icon: Icons.Camera, label: 'Guide Output' },
	DEW_HEATER: { icon: Icons.Camera, label: 'Dew Heater' },
} as const

export function DeviceDropdown<T extends keyof DeviceTypeMap>({ type, value, onValueChange, isDisabled, allowNoneSelection = true, label, showLabel, showLabelOnEmpty = showLabel, icon, color, tooltipContent, tooltipPlacement = 'bottom', ...props }: DeviceDropdownProps<T>) {
	const equipment = useMolecule(EquipmentMolecule)
	const state = equipment.state[type]
	const devices = useSnapshot(state)
	const items = useMemo(() => (allowNoneSelection ? [undefined, ...devices] : devices), [devices, allowNoneSelection])

	function handleOnAction(key: React.Key) {
		onValueChange?.(key === 'none' ? undefined : (state.find((e) => e.id === key) as never))
	}

	return (
		<Dropdown isDisabled={isDisabled || items.length === 0} showArrow>
			<Tooltip content={tooltipContent || DEVICES[type].label} isDisabled={isDisabled || items.length === 0} placement={tooltipPlacement} showArrow>
				<div className='max-w-fit'>
					<DropdownTrigger onPointerUp={stopPropagation}>
						<IconButton
							{...props}
							color={color ?? (value === undefined ? 'secondary' : value.connected ? 'success' : 'danger')}
							icon={icon ?? DEVICES[type].icon}
							isDisabled={isDisabled || items.length === 0}
							label={showLabel ? (value?.name ?? (showLabelOnEmpty ? label || 'None' : undefined)) : undefined}
						/>
					</DropdownTrigger>
				</div>
			</Tooltip>
			<DropdownMenu onAction={handleOnAction}>
				{items.map((item) => (
					<DropdownItem endContent={<DeviceDropdownEndContent device={item} isSelected={value?.name === item?.name} />} key={item?.id || 'none'} startContent={<Icons.Circle color={!item ? '#9353D3' : item.connected ? '#17C964' : '#F31260'} size={12} />}>
						{item?.name || label || 'None'}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}

export interface DeviceDropdownEndContentProps {
	readonly device?: Device
	readonly isSelected?: boolean
}

export function DeviceDropdownEndContent({ device, isSelected }: DeviceDropdownEndContentProps) {
	const equipment = useMolecule(EquipmentMolecule)

	function handleConnectPointerUp(event: React.PointerEvent) {
		event.stopPropagation()
		equipment.connect(device!)
	}

	function handleShowPointerUp(event: React.PointerEvent) {
		event.stopPropagation()
		equipment.show(device!.type, device!)
	}

	return (
		<div className='flex flex-row items-center gap-2'>
			{device && <IconButton color='secondary' icon={Icons.OpenInNew} iconSize={12} isRounded onPointerUp={handleShowPointerUp} size='sm' />}
			{device && <ConnectButton iconSize={12} isConnected={device.connected} isRounded onPointerUp={handleConnectPointerUp} size='sm' />}
			{isSelected && <Icons.Check className='me-2' color='#17C964' size={12} />}
		</div>
	)
}
