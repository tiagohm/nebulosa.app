import { Button, ButtonGroup, type ButtonGroupProps, type ButtonProps, Dropdown, DropdownMenu, type DropdownMenuProps, DropdownTrigger } from '@heroui/react'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface DropdownButtonProps<T extends string = string> extends Omit<ButtonGroupProps, 'children' | 'variant'> {
	readonly label: React.ReactNode
	readonly size?: ButtonProps['size']
	readonly buttonProps?: Omit<ButtonProps, 'children' | 'size'>
	readonly dropdownButtonProps?: Omit<ButtonProps, 'children' | 'size' | 'isIconOnly'>
	readonly dropdownMenuProps?: Omit<DropdownMenuProps, 'children' | 'disallowEmptySelection' | 'onSelectionChange' | 'selectedKeys' | 'selectionMode'>
	readonly value: T
	readonly onValueChange?: (value: T) => void
	readonly children: DropdownMenuProps['children']
}

export function DropdownButton<T extends string = string>({ buttonProps, label, size, dropdownButtonProps, dropdownMenuProps, value, onValueChange, children, ...props }: DropdownButtonProps<T>) {
	return (
		<ButtonGroup {...props} variant='flat'>
			<Button {...buttonProps} size={size}>
				{label}
			</Button>
			<Dropdown placement='bottom-end'>
				<DropdownTrigger>
					<IconButton {...dropdownButtonProps} icon={Icons.ChevronDown} size={size} />
				</DropdownTrigger>
				<DropdownMenu {...dropdownMenuProps} disallowEmptySelection onSelectionChange={(value) => onValueChange?.((value as Set<string>).values().next().value as never)} selectedKeys={new Set([value])} selectionMode='single'>
					{children}
				</DropdownMenu>
			</Dropdown>
		</ButtonGroup>
	)
}
