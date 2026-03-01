import { type ButtonProps, Dropdown, DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/react'
import { DEFAULT_DROPDOWN_PROPS } from '@/shared/constants'
import { SKY_OBJECT_NAME_TYPES } from '@/shared/types'
import { stopPropagationDesktopOnly } from '@/shared/util'
import { TextButton } from './TextButton'

export interface SkyObjectNameTypeDropdownProps extends Omit<ButtonProps, 'isIconOnly' | 'value'> {
	readonly value: number
	readonly onValueChange: (value: number) => void
}

const SkyObjectNameItem = (name: string, i: number) => <DropdownItem key={i - 1}>{name}</DropdownItem>

export function SkyObjectNameTypeDropdown({ value, onValueChange, size = 'sm', variant = 'light', ...props }: SkyObjectNameTypeDropdownProps) {
	return (
		<Dropdown {...DEFAULT_DROPDOWN_PROPS}>
			<DropdownTrigger>
				<TextButton {...props} label={SKY_OBJECT_NAME_TYPES[value + 1]} onPointerUp={stopPropagationDesktopOnly} size={size} variant={variant} />
			</DropdownTrigger>
			<DropdownMenu className='max-h-60 overflow-auto no-scrollbar' onAction={(key) => onValueChange(+key)} selectedKeys={new Set([`${value}`])} selectionMode='single'>
				{SKY_OBJECT_NAME_TYPES.map(SkyObjectNameItem)}
			</DropdownMenu>
		</Dropdown>
	)
}
