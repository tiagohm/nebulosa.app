import { Popover, PopoverContent, type PopoverContentProps, type PopoverProps, PopoverTrigger, Tooltip } from '@heroui/react'
import { DEFAULT_POPOVER_PROPS } from '../shared/constants'
import { IconButton, type IconButtonProps } from './IconButton'

export interface PopoverButtonProps extends Omit<IconButtonProps, 'endContent'>, Pick<PopoverProps, 'placement' | 'isOpen' | 'onOpenChange'>, Pick<PopoverContentProps, 'children'> {
	readonly tooltipContent?: React.ReactNode
}

export function PopoverButton({ tooltipContent, placement = 'bottom', isOpen, onOpenChange, children, ...props }: PopoverButtonProps) {
	return (
		<Popover isOpen={isOpen} onOpenChange={onOpenChange} {...DEFAULT_POPOVER_PROPS}>
			<Tooltip content={tooltipContent} placement={placement} showArrow>
				<div className='max-w-fit'>
					<PopoverTrigger>
						<IconButton {...props} />
					</PopoverTrigger>
				</div>
			</Tooltip>
			<PopoverContent>{children}</PopoverContent>
		</Popover>
	)
}
