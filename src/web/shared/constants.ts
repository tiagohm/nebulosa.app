import type { DropdownProps, PopoverProps } from '@heroui/react'

export const DECIMAL_NUMBER_FORMAT: Readonly<Intl.NumberFormatOptions> = {
	style: 'decimal',
	minimumFractionDigits: 0,
	maximumFractionDigits: 16,
	useGrouping: true,
}

export const INTEGER_NUMBER_FORMAT: Readonly<Intl.NumberFormatOptions> = {
	style: 'decimal',
	minimumFractionDigits: 0,
	maximumFractionDigits: 0,
	useGrouping: true,
}

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
