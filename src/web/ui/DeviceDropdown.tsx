import { type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { useMemo } from 'react'
import type { Device } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { Api } from '@/shared/api'
import { ConnectButton } from './ConnectButton'
import { Icons } from './Icon'

export interface DeviceDropdownProps<T extends Device = Device> {
	readonly isDisabled?: boolean
	readonly items: readonly (DeepReadonly<T> | undefined)[]
	readonly value?: DeepReadonly<T>
	readonly onValueChange: (value?: T) => void
	readonly children: (value: DeepReadonly<T> | undefined, color: ButtonProps['color'], isDisabled: boolean | undefined) => React.ReactNode
	readonly allowEmpty?: boolean
}

export function DeviceDropdown<T extends Device = Device>({ isDisabled, items, value, onValueChange, allowEmpty = true, children }: DeviceDropdownProps<T>) {
	const menu = useMemo(() => {
		return allowEmpty ? [undefined, ...items] : items
	}, [items, allowEmpty])

	const DropdownTriggerContent = useMemo(() => {
		const color = value === undefined ? 'secondary' : value.connected ? 'success' : 'danger'
		return children(value, color, isDisabled || menu.length === 0)
	}, [children, value, isDisabled, menu])

	return (
		<Dropdown isDisabled={isDisabled || menu.length === 0} showArrow>
			<DropdownTrigger>{DropdownTriggerContent}</DropdownTrigger>
			<DropdownMenu>
				{menu.map((item) => (
					<DropdownItem endContent={<DeviceDropdownEndContent device={item} isSelected={value?.name === item?.name} />} key={item?.name || 'none'} onPointerUp={() => onValueChange(item as never)} startContent={<Icons.Circle color={!item ? '#9353D3' : item.connected ? '#17C964' : '#F31260'} size={12} />}>
						{item?.name || 'None'}
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
	function handlePointerUp(event: React.PointerEvent) {
		event.stopPropagation()

		return device!.connected ? Api.Indi.disconnect(device!) : Api.Indi.connect(device!)
	}

	return (
		<div className='flex flex-row items-center gap-2'>
			{device && <ConnectButton iconSize={12} isConnected={device.connected} onPointerUp={handlePointerUp} size='sm' />}
			{isSelected && <Icons.Check className='me-2' color='#17C964' size={12} />}
		</div>
	)
}
