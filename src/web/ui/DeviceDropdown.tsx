import { Button, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import * as Tabler from '@tabler/icons-react'
import { useMemo } from 'react'
import type { Device } from 'src/shared/types'
import type { DeepReadonly } from 'utility-types'

export interface DeviceDropdownProps<T extends Device = Device> {
	readonly items: readonly (DeepReadonly<T> | undefined)[]
	readonly value?: DeepReadonly<T>
	readonly onValueChange?: (value?: T) => void
	readonly icon: React.ComponentType<{ size?: number }>
	readonly allowNone?: boolean
}

export function DeviceDropdown<T extends Device = Device>({ items, value, onValueChange, allowNone = true, icon: Icon }: DeviceDropdownProps<T>) {
	const menu = useMemo(() => (allowNone ? [undefined, ...items] : items), [items, allowNone])

	return (
		<Dropdown showArrow>
			<DropdownTrigger>
				<Button className='rounded-full' color={value === undefined ? 'secondary' : value.connected ? 'success' : 'danger'} isIconOnly size='sm' variant='light'>
					<Icon size={18} />
				</Button>
			</DropdownTrigger>
			<DropdownMenu>
				{menu.map((item) => (
					<DropdownItem
						endContent={value?.name === item?.name ? <Tabler.IconCheck color='#17C964' size={12} /> : undefined}
						key={item?.name || 'none'}
						onPointerUp={() => onValueChange?.(item as never)}
						startContent={<Tabler.IconCircleFilled color={!item ? '#9353D3' : item.connected ? '#17C964' : '#F31260'} size={12} />}>
						{item?.name || 'None'}
					</DropdownItem>
				))}
			</DropdownMenu>
		</Dropdown>
	)
}
