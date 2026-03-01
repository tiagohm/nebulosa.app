import { Dropdown, DropdownItem, DropdownMenu, DropdownTrigger, Tooltip, type TooltipProps } from '@heroui/react'
import { useMolecule } from 'bunshi/react'
import type { Device } from 'nebulosa/src/indi.device'
import { memo, useMemo } from 'react'
import type { DeepReadonly } from 'utility-types'
import { useSnapshot } from 'valtio'
import { type EquipmentDevice, EquipmentMolecule } from '@/molecules/indi/equipment'
import { DEFAULT_DROPDOWN_PROPS } from '@/shared/constants'
import type { DeviceTypeMap } from '@/shared/types'
import { stopPropagationDesktopOnly, tw } from '@/shared/util'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'
import { IconButton, type IconButtonProps } from './IconButton'

export interface DeviceDropdownProps<T extends keyof DeviceTypeMap> extends Pick<IconButtonProps, 'icon' | 'label' | 'color' | 'size' | 'iconSize' | 'variant' | 'endContent'> {
	readonly type: T
	readonly value?: DeepReadonly<DeviceTypeMap[T]>
	readonly onValueChange?: (value?: DeviceTypeMap[T]) => void
	readonly isDisabled?: boolean
	readonly disallowNoneSelection?: boolean
	readonly tooltipContent?: React.ReactNode
	readonly tooltipPlacement?: TooltipProps['placement']
	readonly label?: string
	readonly showLabel?: boolean
	readonly showLabelOnEmpty?: boolean
}

export function DeviceDropdown<T extends keyof DeviceTypeMap>({ type, value, onValueChange, isDisabled, disallowNoneSelection = false, label, showLabel = false, showLabelOnEmpty = showLabel, icon, color, tooltipContent, tooltipPlacement = 'bottom', ...props }: DeviceDropdownProps<T>) {
	const equipment = useMolecule(EquipmentMolecule)
	const state = equipment.state[type]
	const devices = useSnapshot(state)
	const items = useMemo(() => (disallowNoneSelection ? devices : [undefined, ...devices]), [devices, disallowNoneSelection])

	function handleOnAction(key: React.Key) {
		onValueChange?.(key === 'none' ? undefined : (state.find((e) => e.id === key) as never))
	}

	return (
		<Dropdown isDisabled={isDisabled || items.length === 0} {...DEFAULT_DROPDOWN_PROPS}>
			<Tooltip content={tooltipContent} isDisabled={isDisabled || items.length === 0} placement={tooltipPlacement} showArrow>
				<div className='max-w-fit'>
					<DropdownTrigger>
						<IconButton
							{...props}
							color={color ?? (value === undefined ? 'secondary' : value.connected ? 'success' : 'danger')}
							icon={icon}
							isDisabled={isDisabled || items.length === 0}
							label={showLabel ? (value?.name ?? (showLabelOnEmpty ? label || 'None' : undefined)) : undefined}
							onPointerUp={stopPropagationDesktopOnly}
						/>
					</DropdownTrigger>
				</div>
			</Tooltip>
			<DropdownMenu onAction={handleOnAction}>
				{items.map((item) => (
					<DropdownItem
						className={tw('min-h-11', { 'bg-green-900/30': value?.name === item?.name })}
						endContent={<DeviceDropdownEndContent device={item} onConnect={equipment.connect} onShow={equipment.show} />}
						key={item?.id || 'none'}
						startContent={<DeviceDropdownStartContent isConnected={item?.connected} />}>
						{item?.name || 'None'}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}

export const CameraDropdown = memo(({ icon = Icons.Camera, tooltipContent = 'Camera', ...props }: Omit<Partial<DeviceDropdownProps<'CAMERA'>>, 'type'>) => {
	return <DeviceDropdown {...props} icon={icon} tooltipContent={tooltipContent} type='CAMERA' />
})

export const MountDropdown = memo(({ icon = Icons.Telescope, tooltipContent = 'Mount', ...props }: Omit<Partial<DeviceDropdownProps<'MOUNT'>>, 'type'>) => {
	return <DeviceDropdown {...props} icon={icon} tooltipContent={tooltipContent} type='MOUNT' />
})

export const WheelDropdown = memo(({ icon = Icons.FilterWheel, tooltipContent = 'Filter Wheel', ...props }: Omit<Partial<DeviceDropdownProps<'WHEEL'>>, 'type'>) => {
	return <DeviceDropdown {...props} icon={icon} tooltipContent={tooltipContent} type='WHEEL' />
})

export const FocuserDropdown = memo(({ icon = Icons.Focuser, tooltipContent = 'Focuser', ...props }: Omit<Partial<DeviceDropdownProps<'FOCUSER'>>, 'type'>) => {
	return <DeviceDropdown {...props} icon={icon} tooltipContent={tooltipContent} type='FOCUSER' />
})

export const RotatorDropdown = memo(({ icon = Icons.RotateRight, tooltipContent = 'Rotator', ...props }: Omit<Partial<DeviceDropdownProps<'ROTATOR'>>, 'type'>) => {
	return <DeviceDropdown {...props} icon={icon} tooltipContent={tooltipContent} type='ROTATOR' />
})

const DeviceDropdownStartContent = memo(({ isConnected }: { readonly isConnected: boolean | undefined }) => {
	return <Icons.Circle color={isConnected === undefined ? '#9353D3' : isConnected ? '#17C964' : '#F31260'} size={12} />
})

interface DeviceDropdownEndContentProps {
	readonly device?: EquipmentDevice<Device>
	readonly onConnect: (device: Device) => void
	readonly onShow: (device: Device) => void
}

function DeviceDropdownEndContent({ device, onConnect, onShow }: DeviceDropdownEndContentProps) {
	function handleConnectPointerUp(event: React.PointerEvent) {
		stopPropagationDesktopOnly(event)
		onConnect(device!)
	}

	function handleShowPointerUp(event: React.PointerEvent) {
		stopPropagationDesktopOnly(event)
		onShow(device!)
	}

	return (
		<div className='flex flex-row items-center gap-2'>
			{device && <IconButton color='secondary' icon={Icons.OpenInNew} iconSize={12} isRounded onPointerUp={handleShowPointerUp} size='sm' />}
			{device && <ConnectButton iconSize={12} isConnected={device.connected} isLoading={device?.connecting} isRounded onPointerUp={handleConnectPointerUp} size='sm' />}
		</div>
	)
}
