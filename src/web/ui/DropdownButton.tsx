import { Dropdown, DropdownMenu, type DropdownMenuProps, DropdownTrigger } from '@heroui/react'
import clsx from 'clsx'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { TextButton, type TextButtonProps } from './TextButton'

export interface DropdownButtonProps extends Omit<TextButtonProps, 'endContent'>, Pick<DropdownMenuProps, 'children'> {}

export function DropdownButton({ size, color, isDisabled, children, className, ...props }: DropdownButtonProps) {
	return (
		<div className={clsx('inline-flex flex-row gap-0 items-center', className)}>
			<TextButton {...props} className='flex-1 rounded-l-medium rounded-r-none' color={color} isDisabled={isDisabled} size={size} />
			<Dropdown placement='bottom' showArrow>
				<DropdownTrigger>
					<IconButton className='rounded-l-none rounded-r-medium' color={color} icon={Icons.ChevronDown} isDisabled={isDisabled} size={size} variant='flat' />
				</DropdownTrigger>
				<DropdownMenu>{children}</DropdownMenu>
			</Dropdown>
		</div>
	)
}
