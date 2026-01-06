import { Popover, PopoverContent, PopoverTrigger } from '@heroui/react'
import clsx from 'clsx'
import { Icons } from './Icon'
import { IconButton } from './IconButton'
import { TextButton, type TextButtonProps } from './TextButton'

export interface PopupButtonProps extends Omit<TextButtonProps, 'endContent'> {
	readonly children: React.ReactNode
}

export function PopupButton({ size, color, children, className, ...props }: PopupButtonProps) {
	return (
		<div className={clsx('inline-flex flex-row gap-0 items-center', className)}>
			<TextButton {...props} className='flex-1 rounded-l-medium rounded-r-none' color={color} size={size} />
			<Popover placement='bottom' showArrow>
				<PopoverTrigger>
					<IconButton className='rounded-l-none rounded-r-medium' color={color} icon={Icons.ChevronDown} size={size} variant='flat' />
				</PopoverTrigger>
				<PopoverContent>{children}</PopoverContent>
			</Popover>
		</div>
	)
}
