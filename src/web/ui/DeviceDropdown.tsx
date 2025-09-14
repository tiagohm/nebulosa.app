import { type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { useMemo } from 'react'
import type { Device } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { Api } from '@/shared/api'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

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
					<DropdownItem endContent={value?.name === item?.name ? <DeviceDropdownEndContent device={item!} /> : undefined} key={item?.name || 'none'} onPointerUp={() => onValueChange(item as never)} startContent={<Icons.Circle color={!item ? '#9353D3' : item.connected ? '#17C964' : '#F31260'} size={12} />}>
						{item?.name || 'None'}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}

export interface DeviceDropdownEndContentProps {
	readonly device: Device
}

export function DeviceDropdownEndContent({ device }: DeviceDropdownEndContentProps) {
	function handlePointerUp(event: React.PointerEvent) {
		event.stopPropagation()
		return device.connected ? Api.Indi.disconnect(device) : Api.Indi.connect(device)
	}

	return (
		<div className='flex flex-row items-center gap-2'>
			<IconButton color={device.connected ? 'danger' : 'primary'} icon={device.connected ? Icons.Close : Icons.Connect} iconSize={12} onPointerUp={handlePointerUp} variant='light' />
			<Icons.Check color='#17C964' size={12} />
		</div>
	)
}
