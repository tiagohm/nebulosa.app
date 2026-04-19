import type { DropdownProps, PopoverProps } from '@heroui/react'

export const DEFAULT_POPOVER_PROPS: Partial<PopoverProps> = {
	shouldCloseOnBlur: false,
	placement: 'bottom',
	showArrow: true,
}

export const DEFAULT_DROPDOWN_PROPS: Partial<DropdownProps> = {
	shouldCloseOnBlur: false,
	placement: 'bottom',
	showArrow: true,
}
