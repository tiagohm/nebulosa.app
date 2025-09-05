import { type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { useMemo } from 'react'
import type { Device } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'
import { Icons } from './Icon'

export interface DeviceDropdownProps<T extends Device = Device> {
	readonly isDisabled?: boolean
	readonly items: readonly (DeepReadonly<T> | undefined)[]
	readonly value?: DeepReadonly<T>
	readonly onValueChange?: (value?: T) => void
	readonly children: (value: DeepReadonly<T> | undefined, color: ButtonProps['color'], isDisabled: boolean | undefined) => React.ReactNode
	readonly allowEmpty?: boolean
}

export function DeviceDropdown<T extends Device = Device>({ isDisabled, items, value, onValueChange, allowEmpty = true, children }: DeviceDropdownProps<T>) {
	const menu = useMemo(() => {
		return allowEmpty ? [undefined, ...items] : items
	}, [items, allowEmpty])

	return (
		<Dropdown isDisabled={isDisabled || menu.length === 0} showArrow>
			<DropdownTrigger>{children(value, value === undefined ? 'secondary' : value.connected ? 'success' : 'danger', isDisabled || menu.length === 0)}</DropdownTrigger>
			<DropdownMenu>
				{menu.map((item) => (
					<DropdownItem endContent={value?.name === item?.name ? <Icons.Check color='#17C964' size={12} /> : undefined} key={item?.name || 'none'} onPointerUp={() => onValueChange?.(item as never)} startContent={<Icons.Circle color={!item ? '#9353D3' : item.connected ? '#17C964' : '#F31260'} size={12} />}>
						{item?.name || 'None'}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}
