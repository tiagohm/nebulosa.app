import { Dropdown, DropdownMenu, type DropdownMenuProps, DropdownTrigger } from '@heroui/react'
import { DEFAULT_DROPDOWN_PROPS } from '@/shared/constants'
import { stopPropagationDesktopOnly, tw } from '@/shared/util'
import { Button, type ButtonProps } from './components/Button'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface DropdownButtonProps extends Omit<ButtonProps, 'endContent' | 'children'>, Pick<DropdownMenuProps, 'children' | 'onAction'> {}

export function DropdownButton({ size, color, disabled, children, className, onAction, ...props }: DropdownButtonProps) {
	return (
		<div className={tw('inline-flex flex-row gap-0 items-center', className)}>
			<Button {...props} className='flex-1 rounded-l-medium rounded-r-none' color={color} disabled={disabled} size={size} />
			<Dropdown {...DEFAULT_DROPDOWN_PROPS}>
				<DropdownTrigger>
					<IconButton className='rounded-l-none rounded-r-medium' color={color} icon={Icons.ChevronDown} isDisabled={disabled} onPointerUp={stopPropagationDesktopOnly} size={size} variant='flat' />
				</DropdownTrigger>
				<DropdownMenu onAction={onAction}>{children}</DropdownMenu>
			</Dropdown>
		</div>
	)
}
