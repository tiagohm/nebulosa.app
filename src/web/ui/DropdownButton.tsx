import { Dropdown, DropdownMenu, type DropdownMenuProps, DropdownTrigger } from '@heroui/react'
import { stopPropagationDesktopOnly, tw } from '@/shared/util'
import { Button, type ButtonProps } from './components/Button'
import { Icons } from './Icon'
import { IconButton } from './IconButton'

export interface DropdownButtonProps extends Omit<ButtonProps, 'endContent' | 'children'>, Pick<DropdownMenuProps, 'children' | 'onAction'> {}

export function DropdownButton({ size, color, disabled, children, className, onAction, ...props }: DropdownButtonProps) {
	return (
		<div className={tw('inline-flex flex-row gap-0 items-center', className)}>
			<Button {...props} className="rounded-l-medium flex-1 rounded-r-none" color={color} disabled={disabled} size={size} />
			<Dropdown>
				<DropdownTrigger>
					<IconButton className="rounded-r-medium rounded-l-none" color={color} disabled={disabled} icon={Icons.ChevronDown} onPointerUp={stopPropagationDesktopOnly} size={size} variant="flat" />
				</DropdownTrigger>
				<DropdownMenu onAction={onAction}>{children}</DropdownMenu>
			</Dropdown>
		</div>
	)
}
